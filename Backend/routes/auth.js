/**
 * ============================================================
 *  routes/auth.js
 *  Pure MetaMask Authentication — no email / password
 * ============================================================
 *
 *  GET  /api/auth/nonce/:address  — Generate nonce for wallet signature
 *  POST /api/auth/register        — Create account with wallet signature
 *  POST /api/auth/login           — Authenticate via wallet signature
 *  GET  /api/auth/me              — Get current user profile (JWT)
 *  GET  /api/auth/public-key/:address — Lookup NaCl public key
 *  GET  /api/auth/sign-message    — Returns the fixed NaCl key-derivation message
 *
 *  NaCl keypair is generated CLIENT-SIDE. The private key is
 *  encrypted with a MetaMask signature-derived key before being
 *  sent to the server. The server NEVER sees the raw NaCl private key.
 */

const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const { ethers } = require("ethers");

const {
  generateNonce,
  createUser,
  getUserByEthereumAddress,
  getUserByEthereumAddressFull,
  getUserById,
  updateNonce,
  setPendingNonce,
  getPendingNonce,
  clearPendingNonce,
} = require("../services/userStore");
const { verifyToken } = require("../middleware/authMiddleware");

// Fixed message for MetaMask signature → NaCl key derivation (unchanged)
const SIGN_MESSAGE = "MediRecord: Unlock encryption keys";

// Format nonce into a human-readable challenge message
function nonceMessage(nonce) {
  return `Sign this message to verify your identity on MediRecord.\n\nNonce: ${nonce}`;
}

// ─────────────────────────────────────────────
//  GET /api/auth/nonce/:address
// ─────────────────────────────────────────────

/**
 * @caller  Frontend (before login or register)
 *
 * Returns a fresh random nonce for the given wallet address.
 * If the user exists, the nonce is stored in the DB.
 * If the user doesn't exist yet (pre-registration), the nonce
 * is stored in an in-memory map.
 */
router.get("/nonce/:address", async (req, res) => {
  try {
    const { address } = req.params;
    if (!address) {
      return res.status(400).json({ error: "Ethereum address is required" });
    }

    const nonce = generateNonce();

    // Check if user exists
    const existingUser = await getUserByEthereumAddress(address);
    if (existingUser) {
      // Store nonce in DB
      await updateNonce(address, nonce);
    } else {
      // Store nonce in memory (pre-registration)
      setPendingNonce(address, nonce);
    }

    res.json({ nonce, message: nonceMessage(nonce) });
  } catch (error) {
    console.error("[Auth] Nonce generation error:", error.message);
    res.status(500).json({ error: "Failed to generate nonce." });
  }
});

// ─────────────────────────────────────────────
//  POST /api/auth/register
// ─────────────────────────────────────────────

/**
 * @caller  PATIENT, DOCTOR, or DIAGNOSTICS (self-registration)
 *
 * Request body:
 * {
 *   "ethereumAddress":          "0x123...",
 *   "role":                     "patient",
 *   "signature":                "0xabc...",         ← signs the nonce
 *   "naclPublicKey":            "base64...",        ← generated client-side
 *   "encryptedNaclPrivateKey":  "hex...",           ← encrypted with SIGN_MESSAGE signature
 *   "naclKeyIv":                "hex...",
 *   "naclKeyAuthTag":           "hex..."
 * }
 */
router.post("/register", async (req, res) => {
  try {
    const {
      ethereumAddress, role, signature,
      naclPublicKey, encryptedNaclPrivateKey, naclKeyIv, naclKeyAuthTag,
    } = req.body;

    // ── Validation ──
    if (!ethereumAddress || !signature) {
      return res.status(400).json({ error: "Missing required fields: ethereumAddress, signature" });
    }
    if (!naclPublicKey || !encryptedNaclPrivateKey || !naclKeyIv || !naclKeyAuthTag) {
      return res.status(400).json({ error: "Missing NaCl key fields. Generate keys client-side first." });
    }

    const validRoles = ["patient", "doctor", "diagnostics"];
    const userRole = validRoles.includes(role) ? role : "patient";

    // ── Check if already registered ──
    const existing = await getUserByEthereumAddress(ethereumAddress);
    if (existing) {
      return res.status(409).json({ error: "Wallet address already registered" });
    }

    // ── Verify signature against pending nonce ──
    const pendingNonce = getPendingNonce(ethereumAddress);
    if (!pendingNonce) {
      return res.status(400).json({ error: "No nonce found. Request a nonce first via GET /auth/nonce/:address" });
    }

    const recoveredAddress = ethers.verifyMessage(nonceMessage(pendingNonce), signature);
    if (recoveredAddress.toLowerCase() !== ethereumAddress.toLowerCase()) {
      return res.status(401).json({ error: "Signature verification failed" });
    }

    // ── Clear pending nonce & generate a fresh one for future logins ──
    clearPendingNonce(ethereumAddress);
    const freshNonce = generateNonce();

    // ── Store in DB ──
    const userId = await createUser({
      ethereumAddress,
      role: userRole,
      naclPublicKey,
      encryptedNaclPrivateKey,
      naclKeyIv,
      naclKeyAuthTag,
      nonce: freshNonce,
    });

    console.log(`[Auth] Registered user: ${ethereumAddress} (${userRole}) id=${userId}`);

    res.status(201).json({
      success: true,
      message: "Registration successful",
      user: {
        id: userId,
        role: userRole,
        ethereumAddress,
        naclPublicKey,
      },
    });
  } catch (error) {
    console.error("[Auth] Registration error (details hidden for security)");
    res.status(500).json({ error: "Internal server error during registration." });
  }
});

// ─────────────────────────────────────────────
//  POST /api/auth/login
// ─────────────────────────────────────────────

/**
 * @caller  PATIENT, DOCTOR, or DIAGNOSTICS
 *
 * Request body:
 * {
 *   "ethereumAddress": "0x123...",
 *   "signature":       "0xabc..."    ← signs the stored nonce
 * }
 *
 * Response includes JWT + encrypted NaCl private key (for client-side
 * decryption using the SIGN_MESSAGE signature).
 */
router.post("/login", async (req, res) => {
  try {
    const { ethereumAddress, signature } = req.body;

    if (!ethereumAddress || !signature) {
      return res.status(400).json({ error: "Missing required fields: ethereumAddress, signature" });
    }

    // ── 1. Look up user ──
    const user = await getUserByEthereumAddressFull(ethereumAddress);
    if (!user) {
      return res.status(401).json({ error: "Wallet not registered. Please register first." });
    }

    // ── 2. Verify signature against stored nonce ──
    const recoveredAddress = ethers.verifyMessage(nonceMessage(user.nonce), signature);
    if (recoveredAddress.toLowerCase() !== ethereumAddress.toLowerCase()) {
      return res.status(401).json({ error: "Signature verification failed" });
    }

    // ── 3. Rotate nonce (replay protection) ──
    const freshNonce = generateNonce();
    await updateNonce(ethereumAddress, freshNonce);

    // ── 4. Generate JWT ──
    const token = jwt.sign(
      { id: user.id, ethereumAddress: user.ethereum_address, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    console.log(`[Auth] Login: ${ethereumAddress} (${user.role})`);

    // ── 5. Return token + encrypted NaCl private key data ──
    res.json({
      success: true,
      message: "Login successful",
      token,
      signMessage: SIGN_MESSAGE,
      user: {
        id: user.id,
        role: user.role,
        naclPublicKey: user.nacl_public_key,
        ethereumAddress: user.ethereum_address,
        // Encrypted NaCl private key — client decrypts with SIGN_MESSAGE signature
        encryptedNaclPrivateKey: user.encrypted_nacl_private_key,
        naclKeyIv: user.nacl_key_iv,
        naclKeyAuthTag: user.nacl_key_auth_tag,
      },
    });
  } catch (error) {
    console.error("[Auth] Login error (details hidden for security)");
    res.status(500).json({ error: "Internal server error during login." });
  }
});

// ─────────────────────────────────────────────
//  GET /api/auth/me
// ─────────────────────────────────────────────

router.get("/me", verifyToken, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        role: user.role,
        naclPublicKey: user.nacl_public_key,
        ethereumAddress: user.ethereum_address,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    console.error("[Auth] /me error:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────
//  GET /api/auth/public-key/:address
// ─────────────────────────────────────────────

router.get("/public-key/:address", verifyToken, async (req, res) => {
  try {
    const { address } = req.params;
    if (!address) {
      return res.status(400).json({ error: "Ethereum address is required" });
    }

    const user = await getUserByEthereumAddress(address);
    if (!user) {
      return res.status(404).json({ error: "No user found with that Ethereum address" });
    }

    res.json({
      success: true,
      user: {
        role: user.role,
        naclPublicKey: user.nacl_public_key,
        ethereumAddress: user.ethereum_address,
      },
    });
  } catch (error) {
    console.error("[Auth] Public key lookup error:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

// ─────────────────────────────────────────────
//  GET /api/auth/sign-message
// ─────────────────────────────────────────────

/**
 * Returns the fixed message that users must sign with MetaMask
 * to derive their encryption key; ensures client + server agree.
 */
router.get("/sign-message", (req, res) => {
  res.json({ signMessage: SIGN_MESSAGE });
});

module.exports = router;

/**
 * ============================================================
 *  routes/auth.js
 *  Stateless MetaMask Authentication — No SQL, No Nonces
 * ============================================================
 *
 *  POST /api/auth/login           — Authenticate via timestamp + wallet signature
 *  GET  /api/auth/public-key/:address — Lookup NaCl public key (from blockchain)
 *  GET  /api/auth/sign-message    — Returns the fixed NaCl key-derivation message
 *
 *  User identity is stored ON-CHAIN. Registration happens directly
 *  from the frontend to the smart contract (no backend involved).
 *
 *  Login uses a TIMESTAMP-BASED challenge:
 *    1. Frontend generates a timestamp and signs it with MetaMask.
 *    2. Backend verifies the signature and checks timestamp freshness (< 2 min).
 *    3. Backend fetches user profile from the blockchain.
 *    4. Backend issues a JWT.
 */

const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const { ethers } = require("ethers");

const {
  getUserFromChain,
  getUserPublicKeyFromChain,
} = require("../services/blockchain");
const { verifyToken } = require("../middleware/authMiddleware");

// Fixed message for MetaMask signature → NaCl key derivation (unchanged)
const SIGN_MESSAGE = "MediRecord: Unlock encryption keys";

// Maximum age for a timestamp-based login challenge (in seconds)
const MAX_CHALLENGE_AGE_SECONDS = 120; // 2 minutes

// Format timestamp into a challenge message (must match frontend)
function challengeMessage(timestamp) {
  return `Sign this message to verify your identity on MediRecord.\n\nTimestamp: ${timestamp}`;
}

// ─────────────────────────────────────────────
//  POST /api/auth/login
// ─────────────────────────────────────────────

/**
 * @caller  PATIENT, DOCTOR, or DIAGNOSTICS
 *
 * Request body:
 * {
 *   "ethereumAddress": "0x123...",
 *   "signature":       "0xabc...",    ← signs the timestamp challenge
 *   "timestamp":       1713025200     ← unix seconds
 * }
 *
 * Response includes JWT + encrypted NaCl private key (fetched from blockchain).
 */
router.post("/login", async (req, res) => {
  try {
    const { ethereumAddress, signature, timestamp } = req.body;

    if (!ethereumAddress || !signature || !timestamp) {
      return res.status(400).json({ error: "Missing required fields: ethereumAddress, signature, timestamp" });
    }

    // ── 1. Verify timestamp freshness (prevent replay attacks) ──
    const now = Math.floor(Date.now() / 1000);
    const age = now - Number(timestamp);
    if (age < 0 || age > MAX_CHALLENGE_AGE_SECONDS) {
      return res.status(401).json({ error: "Login challenge expired. Please try again." });
    }

    // ── 2. Verify signature against the challenge message ──
    const message = challengeMessage(timestamp);
    const recoveredAddress = ethers.verifyMessage(message, signature);
    if (recoveredAddress.toLowerCase() !== ethereumAddress.toLowerCase()) {
      return res.status(401).json({ error: "Signature verification failed" });
    }

    // ── 3. Fetch user profile from blockchain ──
    const user = await getUserFromChain(ethereumAddress);
    if (!user) {
      return res.status(401).json({ error: "Wallet not registered. Please register first." });
    }

    // ── 4. Generate JWT ──
    const token = jwt.sign(
      { ethereumAddress: user.ethereum_address, role: user.role },
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
        role: user.role,
        naclPublicKey: user.naclPublicKey,
        ethereumAddress: user.ethereum_address,
        // Encrypted NaCl private key — client decrypts with SIGN_MESSAGE signature
        encryptedNaclPrivateKey: user.encryptedPrivateKey,
        naclKeyIv: user.iv,
        naclKeyAuthTag: user.authTag,
      },
    });
  } catch (error) {
    console.error("[Auth] Login error:", error.message);
    res.status(500).json({ error: "Internal server error during login." });
  }
});

// ─────────────────────────────────────────────
//  GET /api/auth/me
// ─────────────────────────────────────────────

router.get("/me", verifyToken, async (req, res) => {
  try {
    const user = await getUserFromChain(req.user.ethereumAddress);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      success: true,
      user: {
        role: user.role,
        naclPublicKey: user.naclPublicKey,
        ethereumAddress: user.ethereum_address,
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

    const naclPublicKey = await getUserPublicKeyFromChain(address);
    if (!naclPublicKey) {
      return res.status(404).json({ error: "No user found with that Ethereum address" });
    }

    // Also fetch role for compatibility
    const user = await getUserFromChain(address);

    res.json({
      success: true,
      user: {
        role: user ? user.role : "unknown",
        naclPublicKey: naclPublicKey,
        ethereumAddress: address,
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

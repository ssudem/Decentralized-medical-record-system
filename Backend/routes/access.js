/**
 * ============================================================
 *  routes/access.js
 *  POST /api/access/grant   — Re-encrypt AES key for a doctor (NaCl)
 *  POST /api/access/revoke  — Remove doctor's key entry
 *  GET  /api/access/keys/:cid/:address — Fetch encrypted AES key
 * ============================================================
 *
 *  The client now decrypts the AES key locally (using session key
 *  or NaCl private key) and sends the plaintext AES key to the
 *  server, which re-encrypts it with the doctor's NaCl public key.
 */

const express = require("express");
const router = express.Router();
const nacl = require("tweetnacl");
const naclUtil = require("tweetnacl-util");

const { encryptAESKeyWithNaCl } = require("../utils/crypto");

const {
  storeEncryptedKey,
  getEncryptedKey,
  removeKeysForUser,
} = require("../services/keyStore");

const { checkPermission } = require("../services/blockchain");

// ─────────────────────────────────────────────
//  POST /api/access/grant — Re-encrypt AES key for Doctor
// ─────────────────────────────────────────────

/**
 * @caller  PATIENT
 *
 * The patient decrypts the AES key client-side (via session key or NaCl key)
 * and sends the plaintext AES key along with the doctor's NaCl public key.
 * The server encrypts the AES key for the doctor using nacl.box.
 *
 * Request body:
 * {
 *   "cid":                "Qm...",
 *   "patientAddress":     "0x...",
 *   "doctorAddress":      "0x...",
 *   "decryptedAESKey":    "base64...",      ← plaintext AES key (sent over HTTPS)
 *   "doctorNaClPublicKey": "base64...",     ← doctor's NaCl public key
 *   "operation":          "diabetes_check"
 * }
 */
router.post("/grant", async (req, res) => {
  const {
    cid,
    patientAddress,
    doctorAddress,
    decryptedAESKey,
    doctorNaClPublicKey,
    operation,
  } = req.body;

  try {
    // ── Validation ──
    if (!cid || !patientAddress || !doctorAddress || !decryptedAESKey || !doctorNaClPublicKey || !operation) {
      return res.status(400).json({
        error: "Missing required fields: cid, patientAddress, doctorAddress, decryptedAESKey, doctorNaClPublicKey, operation",
      });
    }

    // ── 1. Verify on-chain permission ──
    const hasPermission = await checkPermission(patientAddress, doctorAddress, operation);
    if (!hasPermission) {
      return res.status(403).json({
        error: "On-chain permission not found or expired. Patient must call grantAccess() on the smart contract first.",
      });
    }

    // ── 2. NaCl-encrypt AES key for doctor ──
    const aesKeyBuffer = Buffer.from(decryptedAESKey, "base64");
    const doctorPubKeyBytes = naclUtil.decodeBase64(doctorNaClPublicKey);

    // Use an ephemeral NaCl keypair for each grant operation
    const ephemeralKeyPair = nacl.box.keyPair();

    const { encryptedKey, nonce } = encryptAESKeyWithNaCl(
      aesKeyBuffer,
      doctorPubKeyBytes,
      ephemeralKeyPair.secretKey
    );

    // ── 3. Store in DB (with sender = ephemeral public key) ──
    await storeEncryptedKey(
      cid,
      doctorAddress,
      encryptedKey,
      nonce,
      naclUtil.encodeBase64(ephemeralKeyPair.publicKey)
    );

    console.log(`[Access] Granted key for CID ${cid} to doctor ${doctorAddress}`);

    res.json({
      success: true,
      message: `AES key encrypted and stored for doctor ${doctorAddress}`,
    });
  } catch (error) {
    console.error("[Access] Grant error (details hidden for security)");
    res.status(500).json({ error: "Internal server error during access grant." });
  }
});

// ─────────────────────────────────────────────
//  POST /api/access/revoke — Remove Doctor's Key
// ─────────────────────────────────────────────

router.post("/revoke", async (req, res) => {
  try {
    const { cid, doctorAddress } = req.body;

    if (!cid || !doctorAddress) {
      return res.status(400).json({
        error: "Missing required fields: cid, doctorAddress",
      });
    }

    await removeKeysForUser(cid, doctorAddress);

    console.log(`[Access] Revoked key for CID ${cid} from doctor ${doctorAddress}`);

    res.json({
      success: true,
      message: `Encrypted AES key removed for doctor ${doctorAddress} on CID ${cid}`,
    });
  } catch (error) {
    console.error("[Access] Revoke error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
//  GET /api/access/keys/:cid/:address
// ─────────────────────────────────────────────

/**
 * Returns the NaCl-encrypted AES key + nonce + sender public key.
 * The caller decrypts client-side using their NaCl private key.
 */
router.get("/keys/:cid/:address", async (req, res) => {
  try {
    const { cid, address } = req.params;
    const { operation, patientAddress } = req.query;

    const keyData = await getEncryptedKey(cid, address);

    if (!keyData) {
      return res.status(404).json({
        error: `No encrypted AES key found for CID ${cid} and address ${address}`,
      });
    }

    // If operation & patientAddress are provided → DOCTOR request → re-verify permission
    if (operation && patientAddress) {
      const hasPermission = await checkPermission(patientAddress, address, operation);
      if (!hasPermission) {
        await removeKeysForUser(cid, address);
        console.log(`[Access] Permission expired for ${address} on CID ${cid} — key deleted`);
        return res.status(403).json({
          error: "Permission expired. Encrypted AES key has been removed.",
        });
      }
    }

    res.json({
      cid,
      address,
      encryptedAESKey: keyData.encrypted_aes_key,
      nonce: keyData.nonce,
      senderPublicKey: keyData.sender_address,
    });
  } catch (error) {
    console.error("[Access] Key retrieval error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

/**
 * ============================================================
 *  routes/access.js
 *  POST /api/access/grant     — Store pre-encrypted AES key for a doctor
 *  POST /api/access/store-key — Store pre-encrypted AES key (generic)
 *  POST /api/access/revoke    — Remove doctor's key entry
 *  GET  /api/access/keys/:cid/:address — Fetch encrypted AES key
 * ============================================================
 *
 *  The client encrypts the AES key locally using NaCl box with the
 *  sender's actual private key, then sends the encrypted key to the
 *  server for storage. The sender_address stored is the sender's
 *  real NaCl public key (not an ephemeral/server-generated one).
 */

const express = require("express");
const router = express.Router();

const {
  storeEncryptedKey,
  getEncryptedKey,
  removeKeysForUser,
} = require("../services/keyStore");

const { checkPermission } = require("../services/blockchain");

// ─────────────────────────────────────────────
//  POST /api/access/grant — Store pre-encrypted AES key for Doctor
// ─────────────────────────────────────────────

/**
 * @caller  PATIENT (frontend)
 *
 * The patient decrypts the AES key client-side, then re-encrypts it
 * for the doctor using nacl.box with the patient's own NaCl private key.
 * The server receives the pre-encrypted key and stores it directly.
 * sender_address = patient's actual NaCl public key.
 *
 * Request body:
 * {
 *   "cid":                  "Qm...",
 *   "patientAddress":       "0x...",
 *   "doctorAddress":        "0x...",
 *   "encryptedAESKey":      "base64...",   ← NaCl-encrypted AES key (encrypted on frontend)
 *   "nonce":                "base64...",   ← NaCl nonce
 *   "senderNaClPublicKey":  "base64...",   ← patient's actual NaCl public key
 *   "operation":            "diabetes_check"
 * }
 */
router.post("/grant", async (req, res) => {
  const {
    cid,
    patientAddress,
    doctorAddress,
    encryptedAESKey,
    nonce,
    senderNaClPublicKey,
    operation,
  } = req.body;

  try {
    // ── Validation ──
    if (!cid || !patientAddress || !doctorAddress || !encryptedAESKey || !nonce || !senderNaClPublicKey || !operation) {
      return res.status(400).json({
        error: "Missing required fields: cid, patientAddress, doctorAddress, encryptedAESKey, nonce, senderNaClPublicKey, operation",
      });
    }

    // ── 1. Verify on-chain permission ──
    const hasPermission = await checkPermission(patientAddress, doctorAddress, operation);
    if (!hasPermission) {
      return res.status(403).json({
        error: "On-chain permission not found or expired. Patient must call grantAccess() on the smart contract first.",
      });
    }

    // ── 2. Store pre-encrypted key (sender = patient's actual NaCl pubkey) ──
    await storeEncryptedKey(
      cid,
      doctorAddress,
      encryptedAESKey,
      nonce,
      senderNaClPublicKey
    );

    console.log(`[Access] Granted key for CID ${cid} to doctor ${doctorAddress} (sender: patient ${patientAddress})`);

    res.json({
      success: true,
      message: `AES key stored for doctor ${doctorAddress}`,
    });
  } catch (error) {
    console.error("[Access] Grant error (details hidden for security)");
    res.status(500).json({ error: "Internal server error during access grant." });
  }
});

// ─────────────────────────────────────────────
//  POST /api/access/store-key — Store pre-encrypted AES key (generic)
// ─────────────────────────────────────────────

/**
 * @caller  DOCTOR (after record creation) or LAB (after diagnostics upload)
 *
 * After the server creates/encrypts a record and returns the AES key,
 * the frontend encrypts the AES key for the patient using the caller's
 * NaCl private key, then sends the pre-encrypted key here for storage.
 *
 * Request body:
 * {
 *   "cid":                  "Qm...",
 *   "userAddress":          "0x...",       ← who the key is encrypted FOR
 *   "encryptedAESKey":      "base64...",   ← NaCl-encrypted AES key
 *   "nonce":                "base64...",   ← NaCl nonce
 *   "senderNaClPublicKey":  "base64..."    ← sender's actual NaCl public key
 * }
 */
router.post("/store-key", async (req, res) => {
  const { cid, userAddress, encryptedAESKey, nonce, senderNaClPublicKey } = req.body;

  try {
    if (!cid || !userAddress || !encryptedAESKey || !nonce || !senderNaClPublicKey) {
      return res.status(400).json({
        error: "Missing required fields: cid, userAddress, encryptedAESKey, nonce, senderNaClPublicKey",
      });
    }

    await storeEncryptedKey(cid, userAddress, encryptedAESKey, nonce, senderNaClPublicKey);

    console.log(`[Access] Stored pre-encrypted key for CID ${cid} → user ${userAddress}`);

    res.json({ success: true, message: `Encrypted AES key stored for ${userAddress}` });
  } catch (error) {
    console.error("[Access] store-key error:", error.message);
    res.status(500).json({ error: "Internal server error while storing encrypted key." });
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

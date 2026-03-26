/**
 * ============================================================
 *  routes/records.js
 *  POST /api/records       — Create & encrypt a medical record
 *  POST /api/records/view  — Return encrypted records for client-side decryption
 * ============================================================
 *
 *  Key change: Decryption now happens CLIENT-SIDE.
 *  The server returns encrypted data + encrypted AES keys, and the
 *  client decrypts using their NaCl private key.
 */

const express = require("express");
const router = express.Router();
const multer = require("multer");
const nacl = require("tweetnacl");
const naclUtil = require("tweetnacl-util");

const {
  generateAESKey,
  encryptRecord,
  encryptBuffer,
  encryptAESKeyWithNaCl,
} = require("../utils/crypto");

// Multer config — optional PDF, stored in memory (max 20 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"), false);
    }
  },
});

const { uploadToIPFS, fetchFromIPFS, fetchMetadataFromIPFS } = require("../services/ipfsService");
const {
  storeEncryptedKey,
  getEncryptedKey,
} = require("../services/keyStore");
const { uploadRecordOnChain, getPatientRecordCIDs, checkPermission } = require("../services/blockchain");
const { isRecordRelevant, OPERATION_TAG_MAP } = require("../config/operationTags");
const { getNaClPublicKey } = require("../services/userStore");

// Server-side NaCl keypair used for encrypting AES keys for users.
// The public key is stored alongside the encrypted key so users can decrypt.
// Generated once per server lifetime (or could be loaded from env).
let serverNaClKeyPair = null;

function getServerNaClKeyPair() {
  if (!serverNaClKeyPair) {
    // In production, persist this keypair or derive it from a seed.
    // For now, generate per-server-lifetime.
    if (process.env.SERVER_NACL_PRIVATE_KEY) {
      const secretKey = naclUtil.decodeBase64(process.env.SERVER_NACL_PRIVATE_KEY);
      serverNaClKeyPair = nacl.box.keyPair.fromSecretKey(secretKey);
    } else {
      serverNaClKeyPair = nacl.box.keyPair();
      console.log(`[Records] ⚠️  Generated ephemeral server NaCl keypair.`);
      console.log(`[Records]    Set SERVER_NACL_PRIVATE_KEY=${naclUtil.encodeBase64(serverNaClKeyPair.secretKey)} in .env for persistence.`);
    }
    console.log(`[Records] Server NaCl public key: ${naclUtil.encodeBase64(serverNaClKeyPair.publicKey)}`);
  }
  return serverNaClKeyPair;
}

// ─────────────────────────────────────────────
//  POST /api/records — Create & Encrypt Record
// ─────────────────────────────────────────────

/**
 * @caller  DOCTOR
 *
 * Request body:
 * {
 *   "patientAddress":         "0x...",
 *   "doctorAddress":          "0x...",
 *   "patientNaClPublicKey":   "base64...",   ← patient's NaCl public key
 *   "record": { ... }
 * }
 */
router.post("/", upload.single("pdfFile"), async (req, res) => {
  // When a PDF is attached the body comes as FormData with JSON strings
  let { patientAddress, patientNaClPublicKey, doctorAddress, record } = req.body;
  const pdfFile = req.file || null;

  // Parse record if it came as a JSON string (multipart upload)
  if (typeof record === "string") {
    try { record = JSON.parse(record); } catch { return res.status(400).json({ error: "record must be valid JSON" }); }
  }

  try {
    // ── Validation ──
    if (!patientAddress || !patientNaClPublicKey || !doctorAddress || !record) {
      return res.status(400).json({
        error: "Missing required fields: patientAddress, patientNaClPublicKey, doctorAddress, record",
      });
    }
    if (!record.recordType || !record.tags || !Array.isArray(record.tags)) {
      return res.status(400).json({
        error: "record must include 'recordType' and 'tags' (array)",
      });
    }

    // ── 1. Generate AES key + IV ──
    const { key: aesKey, iv } = generateAESKey();

    // ── 2. Encrypt the medical record (AES-256-GCM) ──
    const { cipherText, authTag } = encryptRecord(record, aesKey, iv);

    // ── 2b. Encrypt PDF if present ──
    let encryptedPdf = null;
    let pdfAuthTag = null;
    if (pdfFile) {
      const pdfEnc = encryptBuffer(pdfFile.buffer, aesKey, iv);
      encryptedPdf = pdfEnc.encrypted;
      pdfAuthTag = pdfEnc.authTag;
    }

    // ── 3. Build two-layer IPFS payload ──
    const metadata = {
      recordType: record.recordType,
      specialty: record.specialty || "general",
      tags: record.tags,
      createdAt: new Date().toISOString(),
      doctorAddress: doctorAddress,
      patientAddress: patientAddress,
      hasPdf: !!pdfFile,
      originalFileName: pdfFile ? pdfFile.originalname : undefined,
    };

    const encryptedPayload = {
      cipherText,
      iv: iv.toString("base64"),
      authTag,
    };
    if (pdfFile) {
      encryptedPayload.pdfData = encryptedPdf;
      encryptedPayload.pdfAuthTag = pdfAuthTag;
    }

    // ── 4. Upload to IPFS ──
    const cid = await uploadToIPFS(metadata, encryptedPayload);
    console.log(`[Records] Uploaded to IPFS: ${cid}`);

    // ── 5. NaCl-encrypt AES key for patient ──
    const serverKP = getServerNaClKeyPair();
    const patientPubKeyBytes = naclUtil.decodeBase64(patientNaClPublicKey);

    const { encryptedKey, nonce } = encryptAESKeyWithNaCl(
      aesKey, patientPubKeyBytes, serverKP.secretKey
    );

    await storeEncryptedKey(
      cid,
      patientAddress,
      encryptedKey,
      nonce,
      naclUtil.encodeBase64(serverKP.publicKey) // sender = server public key
    );
    console.log(`[Records] AES key stored for patient: ${patientAddress}`);

    // ── 7. Response ──
    res.status(201).json({
      success: true,
      cid,
      txHash: "pending_metamask",
      message: "Record encrypted, uploaded to IPFS, ready for blockchain registration",
    });
  } catch (error) {
    console.error("[Records] Error creating record:", error.message);
    res.status(500).json({ error: "Internal server error while creating record." });
  }
});

// ─────────────────────────────────────────────
//  POST /api/records/view — Return encrypted records for client-side decryption
// ─────────────────────────────────────────────

/**
 * @caller  PATIENT or DOCTOR
 *
 * MAJOR CHANGE: Server NO LONGER decrypts records.
 * Instead it returns encrypted data + encrypted AES keys.
 * Client decrypts using session key (patient) or NaCl key (doctor).
 *
 * Request body:
 * {
 *   "patientAddress": "0x...",
 *   "userAddress":    "0x...",
 *   "operation":      "diabetes_check"
 * }
 */
router.post("/view", async (req, res) => {
  try {
    const { patientAddress, userAddress, operation } = req.body;

    if (!patientAddress || !userAddress || !operation) {
      return res.status(400).json({
        error: "Missing required fields: patientAddress, userAddress, operation",
      });
    }

    const isPatient = patientAddress.toLowerCase() === userAddress.toLowerCase();

    // ── 1. Permission check (doctors only) ──
    if (!isPatient) {
      try {
        const hasPermission = await checkPermission(patientAddress, userAddress, operation);
        if (!hasPermission) {
          return res.status(403).json({
            error: "Access denied: no active permission or permission expired",
          });
        }
      } catch (permErr) {
        return res.status(403).json({
          error: "Access denied: failed to verify on-chain permission",
        });
      }
    }

    // ── 2. Fetch all CIDs from blockchain ──
    const allRecords = await getPatientRecordCIDs(patientAddress);
    if (allRecords.length === 0) {
      return res.json({ records: [], message: "No records found" });
    }

    // ── 3. Filter by metadata tags (via IPFS metadata) ──
    const opTags = OPERATION_TAG_MAP[operation];

    // Build list of records to return
    const relevantRecords = [];
    for (const rec of allRecords) {
      if (isPatient && operation === '*') {
        // Patients see all their records when requesting '*'
        relevantRecords.push({
          cid: rec.ipfsHash,
          issuedByDoctor: rec.issuedByDoctor,
          timestamp: rec.timestamp.toString(),
        });
      } else {
        // Doctors / Patient sharing: filter by operation tags via IPFS metadata
        try {
          const metadata = await fetchMetadataFromIPFS(rec.ipfsHash);
          if (isRecordRelevant(operation, metadata.tags || [])) {
            relevantRecords.push({
              cid: rec.ipfsHash,
              metadata,
              issuedByDoctor: rec.issuedByDoctor,
              timestamp: rec.timestamp.toString(),
            });
          }
        } catch (fetchErr) {
          console.warn(`[View] Failed to fetch metadata for CID ${rec.ipfsHash}`);
        }
      }
    }

    // ── 4. Fetch encrypted data + keys (NO decryption) ──
    const recordPromises = relevantRecords.map(async (rel) => {
      try {
        // Get the user's encrypted AES key from DB
        const keyData = await getEncryptedKey(rel.cid, userAddress);
        if (!keyData) {
          return null;
        }

        // Fetch the full IPFS payload (encrypted)
        const ipfsData = await fetchFromIPFS(rel.cid);

        return {
          cid: rel.cid,
          metadata: rel.metadata || ipfsData.metadata,
          encryptedPayload: ipfsData.encryptedPayload,
          encryptedAESKey: keyData.encrypted_aes_key,
          nonce: keyData.nonce,
          senderPublicKey: keyData.sender_address, // NaCl public key of sender
          issuedByDoctor: rel.issuedByDoctor,
          issuedByLab: rel.issuedByLab || null,
          timestamp: rel.timestamp,
        };
      } catch (err) {
        console.warn(`[View] Failed to fetch CID ${rel.cid}`);
        return null;
      }
    });

    const results = await Promise.allSettled(recordPromises);
    const records = results
      .filter(r => r.status === "fulfilled" && r.value !== null)
      .map(r => r.value);

    // Also provide the server's NaCl public key so clients can identify it
    const serverKP = getServerNaClKeyPair();

    res.json({
      totalRecords: allRecords.length,
      filteredCount: relevantRecords.length,
      returnedCount: records.length,
      operation,
      serverNaClPublicKey: naclUtil.encodeBase64(serverKP.publicKey),
      records,
    });
  } catch (error) {
    console.error("[View] Error:", error.message);
    res.status(500).json({ error: "Internal server error while viewing records." });
  }
});

module.exports = router;

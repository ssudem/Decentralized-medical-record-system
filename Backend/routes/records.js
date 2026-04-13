/**
 * ============================================================
 *  routes/records.js
 *  POST /api/records       — Create & encrypt a medical record
 *  POST /api/records/view  — Return encrypted records for client-side decryption
 * ============================================================
 *
 *  Key change: The server returns the AES key in the creation response.
 *  The CALLER (doctor frontend) encrypts the AES key for the patient
 *  using the doctor’s actual NaCl private key, then stores it via
 *  POST /api/access/store-key. This ensures sender_address in the DB
 *  is the doctor’s real NaCl public key.
 */

const express = require("express");
const router = express.Router();
const multer = require("multer");
const {
  generateAESKey,
  encryptRecord,
  encryptBuffer,
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

const {
  uploadToIPFS,
  fetchFromIPFS,
  fetchMetadataFromIPFS,
} = require("../services/ipfsService");
const { getEncryptedKey } = require("../services/keyStore");
const {
  uploadRecordOnChain,
  getPatientRecordCIDs,
  checkPermission,
} = require("../services/blockchain");
const {
  isRecordRelevant,
  OPERATION_TAG_MAP,
} = require("../config/operationTags");

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
  let { patientAddress, patientNaClPublicKey, doctorAddress, record } =
    req.body;
  const pdfFile = req.file || null;

  // Parse record if it came as a JSON string (multipart upload)
  if (typeof record === "string") {
    try {
      record = JSON.parse(record);
    } catch {
      return res.status(400).json({ error: "record must be valid JSON" });
    }
  }

  try {
    // ── Validation ──
    if (!patientAddress || !patientNaClPublicKey || !doctorAddress || !record) {
      return res.status(400).json({
        error:
          "Missing required fields: patientAddress, patientNaClPublicKey, doctorAddress, record",
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

    // ── 5. Return AES key for client-side NaCl encryption ──
    // The doctor frontend will encrypt this for the patient and store
    // via POST /api/access/store-key with the doctor’s actual NaCl pubkey.
    const aesKeyBase64 = aesKey.toString("base64");

    console.log(
      `[Records] Record created, CID: ${cid}. AES key returned to doctor for NaCl wrapping.`,
    );

    // ── 6. Response ──
    res.status(201).json({
      success: true,
      cid,
      aesKeyBase64, // Doctor frontend encrypts this for the patient
      txHash: "pending_metamask",
      message:
        "Record encrypted, uploaded to IPFS, ready for blockchain registration",
    });
  } catch (error) {
    console.error("[Records] Error creating record:", error.message);
    res
      .status(500)
      .json({ error: "Internal server error while creating record." });
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
        error:
          "Missing required fields: patientAddress, userAddress, operation",
      });
    }

    const isPatient =
      patientAddress.toLowerCase() === userAddress.toLowerCase();

    // ── 1. Permission check (doctors only) ──
    // Already done in Frontend so no need to check again here .
    // if (!isPatient) {
    //   try {
    //     const hasPermission = await checkPermission(patientAddress, userAddress, operation);
    //     if (!hasPermission) {
    //       return res.status(403).json({
    //         error: "Access denied: no active permission or permission expired",
    //       });
    //     }
    //   } catch (permErr) {
    //     return res.status(403).json({
    //       error: "Access denied: failed to verify on-chain permission",
    //     });
    //   }
    // }

    // ── 2. Fetch all CIDs from blockchain ──
    const allRecords = await getPatientRecordCIDs(patientAddress);
    if (allRecords.length === 0) {
      return res.json({ records: [], message: "No records found" });
    }

    // ── 3 & 4. Concurrently filter and fetch encrypted data + keys ──
    const recordPromises = allRecords.map(async (rec) => {
      try {
        const cid = rec.ipfsHash;

        // 1. Fetch DB key - if no key, the user has no access. No need to hit IPFS.
        const keyData = await getEncryptedKey(cid, userAddress);
        if (!keyData) {
          return null;
        }

        // 2. Fetch full IPFS payload once
        // (fetchMetadataFromIPFS fetches the entire payload under the hood anyway)
        const ipfsData = await fetchFromIPFS(cid);
        const metadata = ipfsData.metadata;

        // 3. Filter by metadata tags if not self_view
        const isSelfView = isPatient && operation === "self_view";
        if (!isSelfView && !isRecordRelevant(operation, metadata.tags || [])) {
          return null; // Does not match tags
        }

        return {
          cid: cid,
          metadata: metadata,
          encryptedPayload: ipfsData.encryptedPayload,
          encryptedAESKey: keyData.encrypted_aes_key,
          nonce: keyData.nonce,
          senderPublicKey: keyData.sender_address, // NaCl public key of sender
          issuedByDoctor: rec.issuedByDoctor,
          issuedByLab: rec.issuedByLab || null,
          timestamp: rec.timestamp.toString(),
        };
      } catch (err) {
        console.warn(`[View] Failed to process CID ${rec.ipfsHash}: ${err.message}`);
        return null;
      }
    });

    const results = await Promise.allSettled(recordPromises);
    const records = results
      .filter((r) => r.status === "fulfilled" && r.value !== null)
      .map((r) => r.value);

    res.json({
      totalRecords: allRecords.length,
      filteredCount: records.length,
      returnedCount: records.length,
      operation,
      records,
    });
  } catch (error) {
    console.error("[View] Error:", error.message);
    res
      .status(500)
      .json({ error: "Internal server error while viewing records." });
  }
});

module.exports = router;

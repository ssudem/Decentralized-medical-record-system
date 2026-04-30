/**
 * ============================================================
 *  routes/records.js
 *  POST /api/records            — Create & encrypt a medical record
 *  POST /api/records/view       — Return encrypted records for client-side decryption
 *  GET  /api/records/granted/:doctorAddress — All records granted to a doctor
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
  mapWithConcurrency,
} = require("../services/ipfsService");
const { getEncryptedKey, getAllKeysForUser, getKeysForCIDs } = require("../services/keyStore");
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
    
    // 3 for optimization fetch all records from db via userAddress
    const allCIDs = allRecords.map((r) => r.ipfsHash);
    const userKeys = await getKeysForCIDs(allCIDs, userAddress);
    const keyMap = {};
    for (const row of userKeys) {
      keyMap[row.cid] = row;
    }

    // ── 4. Fetch encrypted data + keys with concurrency limit ──
    // Only process records that have a key in DB (already filtered above)
    const accessibleRecords = allRecords.filter((rec) => keyMap[rec.ipfsHash]);

    const results = await mapWithConcurrency(accessibleRecords, 6, async (rec) => {
      const cid = rec.ipfsHash;
      const keyData = keyMap[cid];

      // Fetch from IPFS (uses in-memory cache if already fetched)
      const ipfsData = await fetchFromIPFS(cid);
      const metadata = ipfsData.metadata;

      // Filter by metadata tags if not self_view
      const isSelfView = isPatient && operation === "self_view";
      if (!isSelfView && !isRecordRelevant(operation, metadata.tags || [])) {
        return null; // Does not match tags
      }

      return {
        cid,
        metadata,
        encryptedPayload: ipfsData.encryptedPayload,
        encryptedAESKey: keyData.encrypted_aes_key,
        nonce: keyData.nonce,
        senderPublicKey: keyData.sender_address,
        issuedByDoctor: rec.issuedByDoctor,
        issuedByLab: rec.issuedByLab || null,
        timestamp: rec.timestamp.toString(),
      };
    });

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

// ─────────────────────────────────────────────
//  GET /api/records/granted/:doctorAddress — All records granted to a doctor
// ─────────────────────────────────────────────

/**
 * @caller  DOCTOR (frontend — "All Granted Records" tab)
 *
 * Flow:
 *  1. Query encrypted_keys DB for all CIDs where user_address = doctorAddress
 *  2. Fetch IPFS metadata for all CIDs concurrently
 *  3. Group CIDs by patient, then check ALL operations on-chain per unique patient
 *  4. Categorize each record under its matching operation(s) using isRecordRelevant()
 *  5. Return records grouped: patient → operationGroups → records[]
 */
router.get("/granted/:doctorAddress", async (req, res) => {
  try {
    const { doctorAddress } = req.params;
    if (!doctorAddress) {
      return res.status(400).json({ error: "Missing doctorAddress" });
    }

    // 1. Get all encrypted keys for this doctor from DB
    const allKeys = await getAllKeysForUser(doctorAddress);
    if (!allKeys || allKeys.length === 0) {
      return res.json({
        groups: [],
        totalRecords: 0,
        message: "No records have been granted to you yet.",
      });
    }

    console.log(`[Granted] Doctor ${doctorAddress} has ${allKeys.length} encrypted key(s) in DB`);

    const ALL_OPERATIONS = Object.keys(OPERATION_TAG_MAP).filter(op => op !== "self_view");

    // 2. Fetch IPFS metadata for all CIDs (concurrency-limited, cached)
    const cidDataMap = {};    // cid -> { metadata, encryptedPayload, keyRow }
    const patientCIDMap = {}; // patientAddr -> [cid, ...]

    await mapWithConcurrency(allKeys, 6, async (keyRow) => {
      const cid = keyRow.cid;
      const ipfsData = await fetchFromIPFS(cid);
      if (!ipfsData || !ipfsData.metadata) return null;

      const metadata = ipfsData.metadata;
      const patientAddress = metadata.patientAddress?.toLowerCase();
      if (!patientAddress) {
        console.warn(`[Granted] CID ${cid} has no patientAddress in metadata`);
        return null;
      }

      cidDataMap[cid] = { metadata, encryptedPayload: ipfsData.encryptedPayload, keyRow };
      if (!patientCIDMap[patientAddress]) patientCIDMap[patientAddress] = [];
      patientCIDMap[patientAddress].push(cid);
      return cid;
    });

    // 3. For each unique patient, check ALL operations on-chain concurrently
    const patientPerms = {}; // patientAddr -> { operation: boolean }

    const permPromises = Object.keys(patientCIDMap).map(async (patientAddr) => {
      const perms = {};
      const opChecks = ALL_OPERATIONS.map(async (op) => {
        try {
          perms[op] = await checkPermission(patientAddr, doctorAddress, op);
        } catch {
          perms[op] = false;
        }
      });
      await Promise.allSettled(opChecks);
      patientPerms[patientAddr] = perms;
    });

    await Promise.allSettled(permPromises);

    // 4. Categorize records: patient → operation → records[]
    const groups = [];

    for (const [patientAddr, cids] of Object.entries(patientCIDMap)) {
      const perms = patientPerms[patientAddr] || {};
      const activeOps = ALL_OPERATIONS.filter(op => perms[op]);

      if (activeOps.length === 0) continue; // No active on-chain permissions

      const operationGroups = {}; // operation -> records[]

      for (const cid of cids) {
        const data = cidDataMap[cid];
        if (!data) continue;

        const recordTags = data.metadata.tags || [];

        // Place record under every matching active operation
        for (const op of activeOps) {
          if (isRecordRelevant(op, recordTags)) {
            if (!operationGroups[op]) operationGroups[op] = [];
            operationGroups[op].push({
              cid,
              patientAddress: patientAddr,
              metadata: data.metadata,
              encryptedPayload: data.encryptedPayload,
              encryptedAESKey: data.keyRow.encrypted_aes_key,
              nonce: data.keyRow.nonce,
              senderPublicKey: data.keyRow.sender_address,
              timestamp: data.metadata.createdAt,
            });
          }
        }
      }

      if (Object.keys(operationGroups).length === 0) continue;

      groups.push({
        patientAddress: patientAddr,
        activeOperations: activeOps,
        operationGroups,
        totalRecords: new Set(cids.filter(c => cidDataMap[c])).size,
      });
    }

    const totalCategorized = groups.reduce((sum, g) =>
      sum + Object.values(g.operationGroups).reduce((s, recs) => s + recs.length, 0), 0
    );

    console.log(`[Granted] Returning ${totalCategorized} categorized record(s) across ${groups.length} patient(s)`);

    res.json({
      groups,
      totalRecords: totalCategorized,
      totalPatients: groups.length,
    });
  } catch (error) {
    console.error("[Granted] Error:", error.message);
    res.status(500).json({ error: "Internal server error while fetching granted records." });
  }
});

module.exports = router;

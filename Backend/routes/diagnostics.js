/**
 * ============================================================
 *  routes/diagnostics.js
 *  POST /api/diagnostics/upload — Upload PDF + JSON lab report
 * ============================================================
 *
 *  The server encrypts the record with AES-256-GCM, uploads to IPFS,
 *  and returns the AES key. The LAB frontend then encrypts the AES key
 *  for the patient using the lab’s actual NaCl private key and stores
 *  it via POST /api/access/store-key.
 */

const express = require("express");
const router = express.Router();
const multer = require("multer");

const {
  generateAESKey,
  encryptRecord,
  encryptBuffer,
} = require("../utils/crypto");

const { uploadToIPFS } = require("../services/ipfsService");
const { getUserPublicKeyFromChain } = require("../services/blockchain");

// Multer config — store PDF in memory (max 20 MB)
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

// ─────────────────────────────────────────────
//  POST /api/diagnostics/upload
// ─────────────────────────────────────────────

router.post("/upload", upload.single("pdfFile"), async (req, res) => {
  try {
    const { patientAddress, labReport, recordType, tags } = req.body;
    const pdfFile = req.file;

    // ── Validation ──
    if (!patientAddress) {
      return res.status(400).json({
        error: "Missing required field: patientAddress",
      });
    }

    let parsedLabReport;
    try {
      parsedLabReport = labReport ? JSON.parse(labReport) : {};
    } catch (parseErr) {
      return res.status(400).json({ error: "labReport must be valid JSON" });
    }

    let parsedTags;
    try {
      parsedTags = tags ? JSON.parse(tags) : ["diagnostics"];
    } catch (tagErr) {
      parsedTags = ["diagnostics"];
    }

    // ── 1. Look up patient's NaCl public key from blockchain ──
    const patientNaclPubKey = await getUserPublicKeyFromChain(patientAddress);
    if (!patientNaclPubKey) {
      return res.status(404).json({
        error: "Patient not found or has no NaCl public key registered",
      });
    }

    // ── 2. Generate AES key + IV ──
    const { key: aesKey, iv } = generateAESKey();

    // ── 3. Encrypt PDF buffer with AES-256-GCM (if present) ──
    let encryptedPdf = null;
    let pdfAuthTag = null;
    if (pdfFile) {
      const pdfEnc = encryptBuffer(pdfFile.buffer, aesKey, iv);
      encryptedPdf = pdfEnc.encrypted;
      pdfAuthTag = pdfEnc.authTag;
    }

    // ── 4. Encrypt lab report JSON with AES-256-GCM ──
    const { cipherText: encryptedLabReport, authTag: labAuthTag } = encryptRecord(parsedLabReport, aesKey, iv);

    // ── 5. Build two-layer IPFS payload ──
    const metadata = {
      recordType: recordType || "diagnostics_report",
      specialty: "diagnostics",
      tags: parsedTags,
      createdAt: new Date().toISOString(),
      patientAddress: patientAddress,
      labAddress: parsedLabReport.labWallet || undefined,
      originalFileName: pdfFile ? pdfFile.originalname : undefined,
      hasPdf: !!pdfFile,
    };

    const encryptedPayload = {
      cipherText: encryptedLabReport,
      iv: iv.toString("base64"),
      authTag: labAuthTag,
    };
    if (pdfFile) {
      encryptedPayload.pdfData = encryptedPdf;
      encryptedPayload.pdfAuthTag = pdfAuthTag;
    }

    // ── 6. Upload to IPFS ──
    const cid = await uploadToIPFS(metadata, encryptedPayload);
    console.log(`[Diagnostics] Uploaded to IPFS: ${cid}`);

    // ── 7. Return AES key for client-side NaCl encryption ──
    // The lab frontend will encrypt this for the patient and store
    // via POST /api/access/store-key with the lab’s actual NaCl pubkey.
    const aesKeyBase64 = aesKey.toString("base64");

    console.log(`[Diagnostics] Report created, CID: ${cid}. AES key returned to lab for NaCl wrapping.`);

    // ── 8. Response ──
    res.status(201).json({
      success: true,
      cid,
      aesKeyBase64,   // Lab frontend encrypts this for the patient
      patientNaClPublicKey: patientNaclPubKey,  // Lab frontend needs this for encryption
      txHash: "pending_metamask",
      message: "Diagnostics report encrypted, uploaded to IPFS, ready for blockchain registration",
    });
  } catch (error) {
    console.error("[Diagnostics] Error uploading report:", error.message);
    res.status(500).json({
      error: "Internal server error while uploading diagnostics report: " + error.message,
    });
  }
});

module.exports = router;

/**
 * ============================================================
 *  utils/crypto.js
 *  AES-256-GCM encryption helpers (server-side)
 * ============================================================
 *
 *  CALLER OVERVIEW
 *  ───────────────
 *  generateAESKey()   → routes/records.js, routes/diagnostics.js
 *  encryptRecord()    → routes/records.js, routes/diagnostics.js
 *  encryptBuffer()    → routes/records.js, routes/diagnostics.js
 *
 *  Decryption and NaCl key-wrapping are handled client-side
 *  (Zero-Trust architecture).
 */

const crypto = require("crypto");

const AES_ALGORITHM = "aes-256-gcm";
const AES_IV_LENGTH = 12;  // 96 bits (recommended for GCM)

// ─────────────────────────────────────────────
//  AES Key Generation
// ─────────────────────────────────────────────

/**
 * Generate a random AES-256 symmetric key and IV.
 * @returns {{ key: Buffer, iv: Buffer }}
 */
function generateAESKey() {
  return {
    key: crypto.randomBytes(32), // 256 bits
    iv: crypto.randomBytes(AES_IV_LENGTH),  // 96 bits for GCM
  };
}

// ─────────────────────────────────────────────
//  AES-256-GCM Encrypt / Decrypt
// ─────────────────────────────────────────────

/**
 * Encrypt a medical record JSON object with AES-256-GCM.
 * @param {object} jsonData - The medical record object
 * @param {Buffer} key      - 32-byte AES key
 * @param {Buffer} iv       - 12-byte IV
 * @returns {{ cipherText: string, authTag: string }} Base64-encoded
 */
function encryptRecord(jsonData, key, iv) {
  const plaintext = JSON.stringify(jsonData);
  const cipher = crypto.createCipheriv(AES_ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag().toString("base64");
  return { cipherText: encrypted, authTag };
}


// ─────────────────────────────────────────────
//  Raw buffer encryption (for PDFs etc.)
// ─────────────────────────────────────────────

/**
 * Encrypt a raw buffer with AES-256-GCM.
 * @param {Buffer} data - Raw data to encrypt
 * @param {Buffer} key  - 32-byte AES key
 * @param {Buffer} iv   - 12-byte IV
 * @returns {{ encrypted: string, authTag: string }} Base64-encoded
 */
function encryptBuffer(data, key, iv) {
  const cipher = crypto.createCipheriv(AES_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

module.exports = {
  generateAESKey,
  encryptRecord,
  encryptBuffer,
};

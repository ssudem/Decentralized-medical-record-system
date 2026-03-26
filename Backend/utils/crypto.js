/**
 * ============================================================
 *  utils/crypto.js
 *  AES-256-GCM encryption/decryption  +  NaCl box key wrapping
 *  +  Session key helpers
 * ============================================================
 *
 *  CALLER OVERVIEW
 *  ───────────────
 *  generateAESKey()                     → routes/records.js, routes/diagnostics.js
 *  encryptRecord() / decryptRecord()   → routes/records.js
 *  encryptAESKeyWithNaCl()             → routes/records.js, routes/access.js
 *  decryptAESKeyWithNaCl()             → routes/records.js, routes/access.js
 *
 *  Uses Node.js built-in `crypto` + `tweetnacl` + `tweetnacl-util`.
 */

const crypto = require("crypto");
const nacl = require("tweetnacl");
const naclUtil = require("tweetnacl-util");

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

/**
 * Decrypt a Base64 AES-256-GCM cipherText back to a JSON object.
 * @param {string} cipherText - Base64-encoded encrypted data
 * @param {Buffer} key        - 32-byte AES key
 * @param {Buffer} iv         - 12-byte IV
 * @param {string} authTag    - Base64-encoded authentication tag
 * @returns {object} The decrypted medical record JSON
 */
function decryptRecord(cipherText, key, iv, authTag) {
  const decipher = crypto.createDecipheriv(AES_ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  let decrypted = decipher.update(cipherText, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return JSON.parse(decrypted);
}

// ─────────────────────────────────────────────
//  NaCl Box Key Wrapping (AES key protection)
// ─────────────────────────────────────────────

/**
 * Encrypt the AES key using nacl.box (x25519-xsalsa20-poly1305).
 *
 * @param {Buffer} aesKey              - The raw 32-byte AES key
 * @param {Uint8Array} recipientPubKey - Recipient's NaCl public key (32 bytes)
 * @param {Uint8Array} senderPrivKey   - Sender's NaCl private key (32 bytes)
 * @returns {{ encryptedKey: string, nonce: string }}
 *          Both are Base64-encoded for safe storage.
 */
function encryptAESKeyWithNaCl(aesKey, recipientPubKey, senderPrivKey) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength); // 24 bytes
  const messageUint8 = new Uint8Array(aesKey);
  const encrypted = nacl.box(messageUint8, nonce, recipientPubKey, senderPrivKey);

  if (!encrypted) {
    throw new Error("NaCl box encryption failed");
  }

  return {
    encryptedKey: naclUtil.encodeBase64(encrypted),
    nonce: naclUtil.encodeBase64(nonce),
  };
}

/**
 * Decrypt the AES key using nacl.box.open.
 *
 * @param {string} encryptedKeyBase64      - Base64-encoded encrypted AES key
 * @param {string} nonceBase64             - Base64-encoded nonce
 * @param {string|Uint8Array} senderPubKey - Sender's NaCl public key (Base64 or Uint8Array)
 * @param {string|Uint8Array} recipientPrivKey - Recipient's NaCl private key (Base64 or Uint8Array)
 * @returns {Buffer} The raw 32-byte AES key
 */
function decryptAESKeyWithNaCl(encryptedKeyBase64, nonceBase64, senderPubKey, recipientPrivKey) {
  const encrypted = naclUtil.decodeBase64(encryptedKeyBase64);
  const nonce = naclUtil.decodeBase64(nonceBase64);
  const pubKey = typeof senderPubKey === "string" ? naclUtil.decodeBase64(senderPubKey) : senderPubKey;
  const privKey = typeof recipientPrivKey === "string" ? naclUtil.decodeBase64(recipientPrivKey) : recipientPrivKey;
  const decrypted = nacl.box.open(encrypted, nonce, pubKey, privKey);

  if (!decrypted) {
    throw new Error("NaCl box decryption failed — invalid keys or corrupted data");
  }

  return Buffer.from(decrypted);
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

/**
 * Decrypt a raw buffer with AES-256-GCM.
 * @param {string} encryptedBase64 - Base64 encrypted data
 * @param {Buffer} key             - 32-byte AES key
 * @param {Buffer} iv              - 12-byte IV
 * @param {string} authTagBase64   - Base64 auth tag
 * @returns {Buffer} Decrypted data
 */
function decryptBuffer(encryptedBase64, key, iv, authTagBase64) {
  const decipher = crypto.createDecipheriv(AES_ALGORITHM, key, iv);
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final(),
  ]);
  return decrypted;
}

module.exports = {
  generateAESKey,
  encryptRecord,
  decryptRecord,
  encryptAESKeyWithNaCl,
  decryptAESKeyWithNaCl,
  encryptBuffer,
  decryptBuffer,
};

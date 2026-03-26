/**
 * ============================================================
 *  services/keyManager.js
 *  NaCl Key Pair Generation + Signature-Derived Key Encryption
 * ============================================================
 *
 *  CALLER OVERVIEW
 *  ───────────────
 *  generateNaClKeyPair()       → called by frontend during registration
 *  encryptNaClPrivateKey()     → called by frontend during registration
 *  decryptNaClPrivateKey()     → called by frontend during login
 *  deriveKeyFromSignature()    → called by frontend (and backend for session key)
 *
 *  ⚠️  PRIVATE KEY NOTICE
 *  The raw NaCl private key exists in RAM only during:
 *    • Registration: generated → immediately encrypted → discarded
 *    • Login: decrypted from DB → returned to caller → discarded
 *  It is NEVER logged, stored in plaintext, or included in error messages.
 *
 *  ENCRYPTION SCHEME
 *  Signature → sha256(signature) → 256-bit AES key
 *  AES key → AES-256-GCM encrypt(NaCl private key) → { ciphertext, iv, authTag }
 */

const crypto = require("crypto");
const nacl = require("tweetnacl");
const naclUtil = require("tweetnacl-util");

// ── AES-GCM parameters ──
const AES_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits (recommended for GCM)

// ─────────────────────────────────────────────
//  NaCl Key Pair Generation
// ─────────────────────────────────────────────

/**
 * Generate a NaCl box key pair (X25519).
 * @returns {{ publicKey: string, secretKey: string }} Base64-encoded keys
 */
function generateNaClKeyPair() {
  const keyPair = nacl.box.keyPair();
  return {
    publicKey: naclUtil.encodeBase64(keyPair.publicKey),
    secretKey: naclUtil.encodeBase64(keyPair.secretKey),
  };
}

// ─────────────────────────────────────────────
//  Signature-Based Key Derivation
// ─────────────────────────────────────────────

/**
 * Derive a 256-bit AES key from a MetaMask signature.
 * The same wallet + same message = same signature = same derived key.
 * This enables multi-device support.
 *
 * @param {string} signature - Hex-encoded MetaMask personal_sign result
 * @returns {Buffer} 32-byte AES key
 */
function deriveKeyFromSignature(signature) {
  // Remove 0x prefix if present
  const sigHex = signature.startsWith("0x") ? signature.slice(2) : signature;
  return crypto.createHash("sha256").update(Buffer.from(sigHex, "hex")).digest();
}

// ─────────────────────────────────────────────
//  NaCl Private Key Encryption (Signature → AES-GCM)
// ─────────────────────────────────────────────

/**
 * Encrypt a NaCl private key using a signature-derived AES key.
 *
 * @param {string} secretKeyBase64 - Base64-encoded NaCl secret key
 * @param {string} signature       - Hex-encoded MetaMask signature
 * @returns {{ encryptedKey: string, iv: string, authTag: string }}
 *          All values are hex-encoded for safe DB storage.
 */
function encryptNaClPrivateKey(secretKeyBase64, signature) {
  const derivedKey = deriveKeyFromSignature(signature);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(AES_ALGORITHM, derivedKey, iv);
  let encrypted = cipher.update(secretKeyBase64, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return {
    encryptedKey: encrypted,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

/**
 * Decrypt a NaCl private key using a signature-derived AES key.
 *
 * @param {{ encryptedKey: string, iv: string, authTag: string }} encryptedData
 * @param {string} signature - Hex-encoded MetaMask signature
 * @returns {string} Base64-encoded NaCl secret key
 */
function decryptNaClPrivateKey(encryptedData, signature) {
  const { encryptedKey, iv, authTag } = encryptedData;
  const derivedKey = deriveKeyFromSignature(signature);

  const decipher = crypto.createDecipheriv(
    AES_ALGORITHM,
    derivedKey,
    Buffer.from(iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  let decrypted = decipher.update(encryptedKey, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted; // Base64-encoded NaCl secret key
}

module.exports = {
  generateNaClKeyPair,
  deriveKeyFromSignature,
  encryptNaClPrivateKey,
  decryptNaClPrivateKey,
};

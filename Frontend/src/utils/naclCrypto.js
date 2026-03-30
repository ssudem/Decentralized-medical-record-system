/**
 * ============================================================
 *  utils/naclCrypto.js
 *  Client-side NaCl + AES-256-GCM cryptographic utilities
 * ============================================================
 *
 *  This module handles:
 *  1. MetaMask signature → key derivation
 *  2. NaCl keypair generation & private key encryption
 *  3. NaCl box encrypt/decrypt for AES keys
 *  4. Record decryption (AES-256-GCM)
 */

import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

// Fixed message for MetaMask signature — must match backend
const SIGN_MESSAGE = "MediRecord: Unlock encryption keys";

// ─────────────────────────────────────────────
//  MetaMask Signature
// ─────────────────────────────────────────────

/**
 * Sign the fixed message using MetaMask personal_sign.
 * Returns the hex-encoded signature.
 *
 * @param {string} userAddress - Connected wallet address
 * @returns {Promise<string>} Hex signature (0x-prefixed)
 */
export async function signFixedMessage(userAddress) {
  if (!window.ethereum) throw new Error("MetaMask is not installed");

  const signature = await window.ethereum.request({
    method: "personal_sign",
    params: [SIGN_MESSAGE, userAddress],
  });

  return signature;
}

/**
 * Derive a 256-bit key from a MetaMask signature using SHA-256.
 * Same wallet + same message = same signature = same key.
 *
 * @param {string} signature - Hex-encoded MetaMask signature (0x-prefixed)
 * @returns {Promise<Uint8Array>} 32-byte derived key
 */
export async function deriveKeyFromSignature(signature) {
  const sigHex = signature.startsWith("0x") ? signature.slice(2) : signature;
  const sigBytes = new Uint8Array(sigHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
  const hashBuffer = await crypto.subtle.digest("SHA-256", sigBytes);
  return new Uint8Array(hashBuffer);
}

// ─────────────────────────────────────────────
//  NaCl Key Pair Generation
// ─────────────────────────────────────────────

/**
 * Generate a NaCl box key pair.
 * @returns {{ publicKey: string, secretKey: string }} Base64-encoded
 */
export function generateNaClKeyPair() {
  const keyPair = nacl.box.keyPair();
  return {
    publicKey: naclUtil.encodeBase64(keyPair.publicKey),
    secretKey: naclUtil.encodeBase64(keyPair.secretKey),
  };
}

// ─────────────────────────────────────────────
//  NaCl Private Key Encryption (AES-256-GCM)
// ─────────────────────────────────────────────

/**
 * Encrypt a NaCl private key using a derived AES key.
 * @param {string} secretKeyBase64 - Base64 NaCl private key
 * @param {Uint8Array} derivedKey  - 32-byte derived key
 * @returns {Promise<{ encryptedKey: string, iv: string, authTag: string }>} hex-encoded
 */
export async function encryptNaClPrivateKey(secretKeyBase64, derivedKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit for GCM
  const plaintext = new TextEncoder().encode(secretKeyBase64);

  const cryptoKey = await crypto.subtle.importKey(
    "raw", derivedKey, { name: "AES-GCM" }, false, ["encrypt"]
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    plaintext
  );

  // AES-GCM in Web Crypto appends the 16-byte auth tag to ciphertext
  const ctBytes = new Uint8Array(ciphertext);
  const encrypted = ctBytes.slice(0, ctBytes.length - 16);
  const authTag = ctBytes.slice(ctBytes.length - 16);

  return {
    encryptedKey: arrayToHex(encrypted),
    iv: arrayToHex(iv),
    authTag: arrayToHex(authTag),
  };
}

/**
 * Decrypt a NaCl private key using a derived AES key.
 * @param {{ encryptedKey: string, iv: string, authTag: string }} encData - hex-encoded
 * @param {Uint8Array} derivedKey - 32-byte derived key
 * @returns {Promise<string>} Base64-encoded NaCl private key
 */
export async function decryptNaClPrivateKey(encData, derivedKey) {
  const encrypted = hexToArray(encData.encryptedKey);
  const iv = hexToArray(encData.iv);
  const authTag = hexToArray(encData.authTag);

  // Combine ciphertext + authTag (Web Crypto expects them together)
  const combined = new Uint8Array(encrypted.length + authTag.length);
  combined.set(encrypted);
  combined.set(authTag, encrypted.length);

  const cryptoKey = await crypto.subtle.importKey(
    "raw", derivedKey, { name: "AES-GCM" }, false, ["decrypt"]
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    combined
  );

  return new TextDecoder().decode(plaintext);
}

// ─────────────────────────────────────────────
//  NaCl Box Encryption / Decryption (for AES keys)
// ─────────────────────────────────────────────

/**
 * Decrypt an AES key using nacl.box.open.
 * @param {string} encryptedKeyBase64 - Base64 encrypted AES key
 * @param {string} nonceBase64        - Base64 nonce
 * @param {string} senderPubKeyBase64 - Base64 sender's NaCl public key
 * @param {string} recipientSecKeyBase64 - Base64 recipient's NaCl private key
 * @returns {Uint8Array} The raw AES key
 */
export function decryptAESKeyWithNaCl(encryptedKeyBase64, nonceBase64, senderPubKeyBase64, recipientSecKeyBase64) {
  const encrypted = naclUtil.decodeBase64(encryptedKeyBase64);
  const nonce = naclUtil.decodeBase64(nonceBase64);
  const senderPubKey = naclUtil.decodeBase64(senderPubKeyBase64);
  const recipientSecKey = naclUtil.decodeBase64(recipientSecKeyBase64);

  const decrypted = nacl.box.open(encrypted, nonce, senderPubKey, recipientSecKey);

  if (!decrypted) {
    throw new Error("NaCl box decryption failed");
  }

  return decrypted;
}

/**
 * Encrypt an AES key using nacl.box.
 * @param {Uint8Array} aesKey        - Raw AES key bytes
 * @param {string} recipientPubKeyBase64 - Base64 recipient's NaCl public key
 * @param {string} senderSecKeyBase64    - Base64 sender's NaCl private key
 * @returns {{ encryptedKey: string, nonce: string }} Base64-encoded
 */
export function encryptAESKeyWithNaCl(aesKey, recipientPubKeyBase64, senderSecKeyBase64) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const recipientPubKey = naclUtil.decodeBase64(recipientPubKeyBase64);
  const senderSecKey = naclUtil.decodeBase64(senderSecKeyBase64);

  const encrypted = nacl.box(aesKey, nonce, recipientPubKey, senderSecKey);

  if (!encrypted) {
    throw new Error("NaCl box encryption failed");
  }

  return {
    encryptedKey: naclUtil.encodeBase64(encrypted),
    nonce: naclUtil.encodeBase64(nonce),
  };
}



// ─────────────────────────────────────────────
//  AES-256-GCM Record Decryption (client-side)
// ─────────────────────────────────────────────

/**
 * Decrypt a medical record locally using AES-256-GCM via Web Crypto.
 * @param {string} cipherTextBase64 - Base64 encrypted record
 * @param {Uint8Array} aesKey       - 32-byte AES key
 * @param {string} ivBase64         - Base64 IV
 * @param {string} authTagBase64    - Base64 auth tag
 * @returns {Promise<object>} Decrypted JSON record
 */
export async function decryptRecordLocal(cipherTextBase64, aesKey, ivBase64, authTagBase64) {
  const encBytes = base64ToArray(cipherTextBase64);
  const ivBytes = base64ToArray(ivBase64);
  const tagBytes = base64ToArray(authTagBase64);

  // Combine ciphertext + authTag
  const combined = new Uint8Array(encBytes.length + tagBytes.length);
  combined.set(encBytes);
  combined.set(tagBytes, encBytes.length);

  const cryptoKey = await crypto.subtle.importKey(
    "raw", aesKey, { name: "AES-GCM" }, false, ["decrypt"]
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes },
    cryptoKey,
    combined
  );

  return JSON.parse(new TextDecoder().decode(plaintext));
}

/**
 * Decrypt a PDF buffer locally using AES-256-GCM via Web Crypto.
 * @param {string} encryptedBase64 - Base64 encrypted PDF
 * @param {Uint8Array} aesKey      - 32-byte AES key
 * @param {string} ivBase64        - Base64 IV
 * @param {string} authTagBase64   - Base64 auth tag
 * @returns {Promise<string>} Base64-encoded decrypted PDF
 */
export async function decryptPdfLocal(encryptedBase64, aesKey, ivBase64, authTagBase64) {
  const encBytes = base64ToArray(encryptedBase64);
  const ivBytes = base64ToArray(ivBase64);
  const tagBytes = base64ToArray(authTagBase64);

  const combined = new Uint8Array(encBytes.length + tagBytes.length);
  combined.set(encBytes);
  combined.set(tagBytes, encBytes.length);

  const cryptoKey = await crypto.subtle.importKey(
    "raw", aesKey, { name: "AES-GCM" }, false, ["decrypt"]
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes },
    cryptoKey,
    combined
  );

  // Convert to Base64 for display
  const bytes = new Uint8Array(plaintext);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ─────────────────────────────────────────────
//  Utility Helpers
// ─────────────────────────────────────────────

function arrayToHex(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

function hexToArray(hex) {
  return new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
}

function base64ToArray(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}


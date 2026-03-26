/**
 * ============================================================
 *  tests/crypto_test.js
 *  Unit tests for the NaCl + AES-256-GCM encryption system
 * ============================================================
 *
 *  Run: node tests/crypto_test.js
 *
 *  Tests:
 *  1. AES-256-GCM encrypt/decrypt roundtrip
 *  2. NaCl box encrypt/decrypt for AES keys
 *  3. NaCl private key encryption with signature-derived key
 *  4. Raw buffer encrypt/decrypt (PDF)
 *  5. Full end-to-end flow simulation
 */

const {
  generateAESKey,
  encryptRecord,
  decryptRecord,
  encryptAESKeyWithNaCl,
  decryptAESKeyWithNaCl,
  encryptBuffer,
  decryptBuffer,
} = require("../utils/crypto");

const {
  generateNaClKeyPair,
  deriveKeyFromSignature,
  encryptNaClPrivateKey,
  decryptNaClPrivateKey,
} = require("../services/keyManager");

const nacl = require("tweetnacl");
const naclUtil = require("tweetnacl-util");
const crypto = require("crypto");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

// ─── Test 1: AES-256-GCM Encrypt/Decrypt ───
console.log("\n═══ Test 1: AES-256-GCM Encrypt/Decrypt ═══");
{
  const { key, iv } = generateAESKey();
  const testData = { diagnosis: "Test diagnosis", treatment: "Test treatment", vitals: { bp: "120/80" } };

  const { cipherText, authTag } = encryptRecord(testData, key, iv);
  assert(typeof cipherText === "string" && cipherText.length > 0, "Encrypted data is non-empty string");
  assert(typeof authTag === "string" && authTag.length > 0, "Auth tag is non-empty string");

  const decrypted = decryptRecord(cipherText, key, iv, authTag);
  assert(JSON.stringify(decrypted) === JSON.stringify(testData), "Decrypted data matches original");

  // Wrong key should fail
  const wrongKey = crypto.randomBytes(32);
  try {
    decryptRecord(cipherText, wrongKey, iv, authTag);
    assert(false, "Wrong key should throw");
  } catch {
    assert(true, "Wrong key correctly throws error");
  }
}

// ─── Test 2: NaCl Box Encrypt/Decrypt for AES Keys ───
console.log("\n═══ Test 2: NaCl Box Encrypt/Decrypt for AES Keys ═══");
{
  const { key: aesKey } = generateAESKey();
  const senderKP = nacl.box.keyPair();
  const recipientKP = nacl.box.keyPair();

  const { encryptedKey, nonce } = encryptAESKeyWithNaCl(
    aesKey, recipientKP.publicKey, senderKP.secretKey
  );
  assert(typeof encryptedKey === "string" && encryptedKey.length > 0, "NaCl encrypted key is non-empty");
  assert(typeof nonce === "string" && nonce.length > 0, "Nonce is non-empty");

  const decryptedKey = decryptAESKeyWithNaCl(
    encryptedKey, nonce, senderKP.publicKey, recipientKP.secretKey
  );
  assert(Buffer.from(decryptedKey).equals(aesKey), "NaCl decrypted AES key matches original");

  // Wrong recipient key should fail
  const wrongKP = nacl.box.keyPair();
  try {
    decryptAESKeyWithNaCl(encryptedKey, nonce, senderKP.publicKey, wrongKP.secretKey);
    assert(false, "Wrong recipient key should throw");
  } catch {
    assert(true, "Wrong recipient key correctly throws error");
  }
}

// ─── Test 3: NaCl Private Key Encryption (Signature-Derived) ───
console.log("\n═══ Test 3: NaCl Private Key Encryption ═══");
{
  const keyPair = generateNaClKeyPair();
  assert(keyPair.publicKey && keyPair.secretKey, "NaCl keypair generated");

  // Simulate a MetaMask signature (64 bytes hex)
  const fakeSignature = "0x" + crypto.randomBytes(65).toString("hex");

  const encrypted = encryptNaClPrivateKey(keyPair.secretKey, fakeSignature);
  assert(encrypted.encryptedKey && encrypted.iv && encrypted.authTag, "Encrypted private key has all fields");

  const decrypted = decryptNaClPrivateKey(encrypted, fakeSignature);
  assert(decrypted === keyPair.secretKey, "Decrypted private key matches original");

  // Same signature should produce same derived key
  const derivedKey1 = deriveKeyFromSignature(fakeSignature);
  const derivedKey2 = deriveKeyFromSignature(fakeSignature);
  assert(derivedKey1.equals(derivedKey2), "Same signature produces same derived key (deterministic)");

  // Different signature should fail
  const differentSig = "0x" + crypto.randomBytes(65).toString("hex");
  try {
    decryptNaClPrivateKey(encrypted, differentSig);
    assert(false, "Different signature should throw");
  } catch {
    assert(true, "Different signature correctly throws error");
  }
}

// ─── Test 4: Raw Buffer Encrypt/Decrypt (PDF) ───
console.log("\n═══ Test 4: Raw Buffer Encrypt/Decrypt ═══");
{
  const { key, iv } = generateAESKey();
  const testPdf = crypto.randomBytes(1024); // simulate PDF

  const { encrypted, authTag } = encryptBuffer(testPdf, key, iv);
  assert(typeof encrypted === "string", "Encrypted buffer is base64 string");

  const decryptedPdf = decryptBuffer(encrypted, key, iv, authTag);
  assert(decryptedPdf.equals(testPdf), "Decrypted buffer matches original");
}

// ─── Test 5: Full End-to-End Flow ───
console.log("\n═══ Test 5: Full End-to-End Flow ═══");
{
  // 1. Patient registers — generate NaCl keypair
  const patientKP = generateNaClKeyPair();
  const patientSig = "0x" + crypto.randomBytes(65).toString("hex");
  const patientEncKey = encryptNaClPrivateKey(patientKP.secretKey, patientSig);

  // 2. Doctor registers — generate NaCl keypair
  const doctorKP = generateNaClKeyPair();

  // 3. Server NaCl keypair (used during record creation)
  const serverKP = nacl.box.keyPair();

  // 4. Record creation — AES encrypt, NaCl wrap AES key for patient
  const { key: aesKey, iv } = generateAESKey();
  const record = { diagnosis: "Diabetes Type 2", treatment: "Metformin 500mg", tags: ["diabetes"] };
  const { cipherText, authTag } = encryptRecord(record, aesKey, iv);

  const patientPubBytes = naclUtil.decodeBase64(patientKP.publicKey);
  const { encryptedKey: encAESForPatient, nonce: patientNonce } = encryptAESKeyWithNaCl(
    aesKey, patientPubBytes, serverKP.secretKey
  );

  console.log("  Record created and AES key wrapped for patient");

  // 5. Patient login — decrypt NaCl private key
  const recoveredPrivKey = decryptNaClPrivateKey(patientEncKey, patientSig);
  assert(recoveredPrivKey === patientKP.secretKey, "Patient recovered private key");

  // 6. Patient decrypts AES key with NaCl
  const rawAESKey = decryptAESKeyWithNaCl(
    encAESForPatient, patientNonce,
    naclUtil.encodeBase64(serverKP.publicKey), recoveredPrivKey
  );
  assert(Buffer.from(rawAESKey).equals(aesKey), "Patient decrypted AES key via NaCl");

  // 7. Patient decrypts the record
  const decryptedRecord = decryptRecord(cipherText, aesKey, iv, authTag);
  assert(decryptedRecord.diagnosis === record.diagnosis, "Patient decrypted record correctly");

  // 8. Patient grants access to doctor — re-encrypt AES key
  const doctorPubBytes = naclUtil.decodeBase64(doctorKP.publicKey);
  const ephemeralKP = nacl.box.keyPair();
  const { encryptedKey: encAESForDoctor, nonce: doctorNonce } = encryptAESKeyWithNaCl(
    Buffer.from(rawAESKey), doctorPubBytes, ephemeralKP.secretKey
  );

  // 9. Doctor decrypts AES key
  const doctorAESKey = decryptAESKeyWithNaCl(
    encAESForDoctor, doctorNonce,
    naclUtil.encodeBase64(ephemeralKP.publicKey), doctorKP.secretKey
  );
  assert(Buffer.from(doctorAESKey).equals(aesKey), "Doctor decrypted AES key via NaCl");

  // 10. Doctor decrypts the record
  const doctorDecryptedRecord = decryptRecord(cipherText, Buffer.from(doctorAESKey), iv, authTag);
  assert(doctorDecryptedRecord.diagnosis === record.diagnosis, "Doctor decrypted record correctly");

  console.log("  ✅ Full end-to-end flow PASSED");
}

// ─── Summary ───
console.log("\n═══════════════════════════════════════");
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log("═══════════════════════════════════════\n");

process.exit(failed > 0 ? 1 : 0);

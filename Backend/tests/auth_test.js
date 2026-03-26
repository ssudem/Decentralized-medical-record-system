/**
 * ============================================================
 *  tests/auth_test.js
 *  Verifies PBKDF2 + AES-GCM private key encryption roundtrip
 *  and wrong-password rejection.
 * ============================================================
 *
 *  Run:  node tests/auth_test.js
 *
 *  This test does NOT require a database or running server —
 *  it tests only the keyManager.js functions in isolation.
 */

const assert = require("assert");
const {
  generateRSAKeyPair,
  encryptPrivateKey,
  decryptPrivateKey,
} = require("../services/keyManager");

// ────────────────────────────────────────────

function testKeyGeneration() {
  console.log("\n🔑 Test 1: RSA Key Pair Generation");

  const { publicKey, privateKey } = generateRSAKeyPair();

  assert(publicKey.startsWith("-----BEGIN PUBLIC KEY-----"), "Public key must be PEM");
  assert(privateKey.startsWith("-----BEGIN PRIVATE KEY-----"), "Private key must be PEM");
  console.log(`   Public key length:  ${publicKey.length} chars`);
  console.log(`   Private key length: ${privateKey.length} chars`);
  console.log("   ✅ PASSED — Valid RSA-2048 PEM key pair generated\n");
}

// ────────────────────────────────────────────

function testEncryptDecryptRoundtrip() {
  console.log("🔐 Test 2: Encrypt → Decrypt Roundtrip (correct password)");

  const { privateKey } = generateRSAKeyPair();
  const password = "MyS3cur3P@ssw0rd!";

  // Encrypt
  const encrypted = encryptPrivateKey(privateKey, password);
  console.log(`   Salt:      ${encrypted.salt.substring(0, 16)}...`);
  console.log(`   IV:        ${encrypted.iv}`);
  console.log(`   AuthTag:   ${encrypted.authTag}`);
  console.log(`   Cipher len: ${encrypted.encryptedKey.length} hex chars`);

  // Decrypt with same password
  const decrypted = decryptPrivateKey(encrypted, password);
  assert.strictEqual(decrypted, privateKey, "Decrypted key must match original");
  console.log("   ✅ PASSED — Decrypted private key matches original\n");
}

// ────────────────────────────────────────────

function testWrongPasswordRejection() {
  console.log("🚫 Test 3: Wrong Password → Decryption Must Fail");

  const { privateKey } = generateRSAKeyPair();
  const correctPassword = "CorrectHorse123!";
  const wrongPassword = "WrongBattery456!";

  // Encrypt with correct password
  const encrypted = encryptPrivateKey(privateKey, correctPassword);

  // Attempt decrypt with wrong password → AES-GCM auth tag should fail
  try {
    decryptPrivateKey(encrypted, wrongPassword);
    assert.fail("Should have thrown an error for wrong password");
  } catch (err) {
    // Expected: AES-GCM throws "Unsupported state or unable to authenticate data"
    console.log(`   Error caught: "${err.message}"`);
    assert(
      err.message.includes("authenticate") || err.message.includes("Unsupported"),
      "Error should be an AES-GCM auth tag failure"
    );
    console.log("   ✅ PASSED — Wrong password correctly rejected\n");
  }
}

// ────────────────────────────────────────────

function testDifferentUsersGetDifferentSalts() {
  console.log("🧂 Test 4: Different Users → Different Salts & Ciphertexts");

  const { privateKey } = generateRSAKeyPair();
  const password = "SamePassword123!";

  const enc1 = encryptPrivateKey(privateKey, password);
  const enc2 = encryptPrivateKey(privateKey, password);

  assert.notStrictEqual(enc1.salt, enc2.salt, "Salts must be unique per call");
  assert.notStrictEqual(enc1.iv, enc2.iv, "IVs must be unique per call");
  assert.notStrictEqual(enc1.encryptedKey, enc2.encryptedKey, "Ciphertexts must differ due to different salt/IV");

  // Both should still decrypt correctly
  const dec1 = decryptPrivateKey(enc1, password);
  const dec2 = decryptPrivateKey(enc2, password);
  assert.strictEqual(dec1, privateKey);
  assert.strictEqual(dec2, privateKey);

  console.log("   ✅ PASSED — Same password, different salt/IV → different ciphertext, both decrypt\n");
}

// ────────────────────────────────────────────

console.log("═══════════════════════════════════════════");
console.log("  MediRecord — Auth (KeyManager) Unit Tests");
console.log("═══════════════════════════════════════════");

try {
  testKeyGeneration();
  testEncryptDecryptRoundtrip();
  testWrongPasswordRejection();
  testDifferentUsersGetDifferentSalts();

  console.log("═══════════════════════════════════════════");
  console.log("  ✅ ALL AUTH TESTS PASSED");
  console.log("═══════════════════════════════════════════\n");
} catch (error) {
  console.error("\n  ❌ TEST FAILED:", error.message);
  console.error(error);
  process.exit(1);
}

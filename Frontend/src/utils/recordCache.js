/**
 * ─── Encrypted Record Cache (sessionStorage) ───
 *
 * Caches the **encrypted** API response (never decrypted data) so that
 * subsequent page loads skip the network round-trip but still perform
 * client-side decryption every time (keys stay in-memory only).
 *
 * Each cache entry is keyed by:
 *   patient: `enc_patient_<walletAddress>`
 *   doctor:  `enc_doctor_<doctorAddr>_<patientAddr>_<operation>`
 *
 * Entries include a timestamp and are invalidated after `maxAgeMs` (default 5 min).
 */

const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

// ── Patient cache ──

function patientCacheKey(walletAddress) {
  return `enc_patient_${walletAddress?.toLowerCase()}`;
}

export function loadPatientCache(walletAddress) {
  try {
    const raw = sessionStorage.getItem(patientCacheKey(walletAddress));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > MAX_AGE_MS) {
      sessionStorage.removeItem(patientCacheKey(walletAddress));
      return null;
    }
    return parsed.records;
  } catch {
    return null;
  }
}

export function savePatientCache(walletAddress, encryptedRecords) {
  try {
    sessionStorage.setItem(
      patientCacheKey(walletAddress),
      JSON.stringify({ timestamp: Date.now(), records: encryptedRecords }),
    );
  } catch {
    // quota exceeded — silently skip
  }
}

export function clearPatientCache(walletAddress) {
  sessionStorage.removeItem(patientCacheKey(walletAddress));
}

// ── Doctor cache ──

function doctorCacheKey(doctorAddr, patientAddr, operation) {
  return `enc_doctor_${doctorAddr?.toLowerCase()}_${patientAddr?.toLowerCase()}_${operation}`;
}

export function loadDoctorCache(doctorAddr, patientAddr, operation) {
  try {
    const key = doctorCacheKey(doctorAddr, patientAddr, operation);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > MAX_AGE_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed.records;
  } catch {
    return null;
  }
}

export function saveDoctorCache(doctorAddr, patientAddr, operation, encryptedRecords) {
  try {
    sessionStorage.setItem(
      doctorCacheKey(doctorAddr, patientAddr, operation),
      JSON.stringify({ timestamp: Date.now(), records: encryptedRecords }),
    );
  } catch {
    // quota exceeded — silently skip
  }
}

export function clearDoctorCache(doctorAddr, patientAddr, operation) {
  sessionStorage.removeItem(doctorCacheKey(doctorAddr, patientAddr, operation));
}

export function clearAllDoctorCaches() {
  const keysToRemove = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key?.startsWith("enc_doctor_")) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((k) => sessionStorage.removeItem(k));
}

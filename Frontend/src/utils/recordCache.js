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

// ── Granted-records cache (All Granted Records tab) ──

const GRANTED_CACHE_KEY = "enc_granted_groups";
const GRANTED_MODE_KEY  = "doctor_view_mode";

export function saveGrantedCache(doctorAddr, groups) {
  try {
    sessionStorage.setItem(
      `${GRANTED_CACHE_KEY}_${doctorAddr?.toLowerCase()}`,
      JSON.stringify({ timestamp: Date.now(), groups }),
    );
  } catch {
    // quota exceeded — silently skip
  }
}

export function loadGrantedCache(doctorAddr) {
  try {
    const raw = sessionStorage.getItem(`${GRANTED_CACHE_KEY}_${doctorAddr?.toLowerCase()}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > MAX_AGE_MS) {
      sessionStorage.removeItem(`${GRANTED_CACHE_KEY}_${doctorAddr?.toLowerCase()}`);
      return null;
    }
    return parsed.groups;
  } catch {
    return null;
  }
}

export function clearGrantedCache(doctorAddr) {
  sessionStorage.removeItem(`${GRANTED_CACHE_KEY}_${doctorAddr?.toLowerCase()}`);
}

// ── Permission cache (on-chain grant verification) ──
// Caches per-operation permission results so we don't re-check blockchain
// every time the user expands an operation accordion.

function permCacheKey(doctorAddr, patientAddr, operation) {
  return `perm_${doctorAddr?.toLowerCase()}_${patientAddr?.toLowerCase()}_${operation}`;
}

export function savePermissionCache(doctorAddr, patientAddr, operation, granted) {
  try {
    sessionStorage.setItem(
      permCacheKey(doctorAddr, patientAddr, operation),
      JSON.stringify({ timestamp: Date.now(), granted }),
    );
  } catch {
    // quota exceeded — silently skip
  }
}

export function loadPermissionCache(doctorAddr, patientAddr, operation) {
  try {
    const raw = sessionStorage.getItem(permCacheKey(doctorAddr, patientAddr, operation));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > MAX_AGE_MS) {
      sessionStorage.removeItem(permCacheKey(doctorAddr, patientAddr, operation));
      return null;
    }
    return parsed.granted;
  } catch {
    return null;
  }
}

export function clearPermissionCache(doctorAddr, patientAddr, operation) {
  sessionStorage.removeItem(permCacheKey(doctorAddr, patientAddr, operation));
}

export function saveViewMode(mode) {
  sessionStorage.setItem(GRANTED_MODE_KEY, mode);
}

export function loadViewMode() {
  return sessionStorage.getItem(GRANTED_MODE_KEY) || "manual";
}

/**
 * ============================================================
 *  services/ipfsService.js
 *  Upload / Download encrypted medical records to/from IPFS
 *  via the Pinata API.
 * ============================================================
 *
 *  CALLER OVERVIEW
 *  ───────────────
 *  All functions in this module are called by the BACKEND only.
 *  Patients and doctors never call IPFS directly — all IPFS
 *  interaction is proxied through the Node.js server.
 *
 *  uploadToIPFS()         → called by routes/records.js (DOCTOR flow)
 *  fetchFromIPFS()        → called by routes/records.js (PATIENT & DOCTOR view flow)
 *  fetchMetadataFromIPFS()→ called by routes/records.js during tag filtering
 *                           (no private-key involvement; metadata is unencrypted)
 *
 *  ⚠️  PRIVATE KEY NOTICE
 *  ─────────────────────
 *  PINATA_JWT is read from process.env and placed in HTTP Authorization headers.
 *  It is NEVER logged and NEVER returned in any API response.
 *  Axios error objects are NOT forwarded directly to callers to prevent any
 *  accidental exposure of the JWT through HTTP error response bodies.
 *
 *  IPFS PAYLOAD FORMAT (two-layer structure)
 *  ──────────────────────────────────────────
 *  {
 *    "metadata": {                       ← UNENCRYPTED (for filtering)
 *      "recordType": "lab_report",
 *      "specialty":  "endocrinology",
 *      "tags":       ["diabetes", "HbA1c"],
 *      "createdAt":  "2026-03-13T22:00:00Z",
 *      "doctorAddress":  "0x...",
 *      "patientAddress": "0x..."
 *    },
 *    "encryptedPayload": {               ← AES-256 ENCRYPTED
 *      "cipherText": "BASE64...",
 *      "iv":         "BASE64..."
 *    }
 *  }
 *
 *  The metadata contains NO medical data — only category labels
 *  so the backend can filter records by operation tags without
 *  decrypting the actual medical content.
 */

require("dotenv").config();
const axios = require("axios");
const FormData = require("form-data");

const PINATA_BASE_URL = "https://api.pinata.cloud";
const PINATA_GATEWAY  = "https://gateway.pinata.cloud/ipfs";

// ─────────────────────────────────────────────
//  In-memory IPFS cache (CID → payload)
//  IPFS content is immutable: same CID = same data forever.
//  Safe to cache indefinitely. Capped at 500 entries to bound memory.
// ─────────────────────────────────────────────
const IPFS_CACHE = new Map();
const IPFS_CACHE_MAX = 500;

function cacheSet(cid, data) {
  if (IPFS_CACHE.size >= IPFS_CACHE_MAX) {
    // Evict oldest entry (first inserted)
    const oldest = IPFS_CACHE.keys().next().value;
    IPFS_CACHE.delete(oldest);
  }
  IPFS_CACHE.set(cid, data);
}

// In-flight dedup — avoid fetching the same CID concurrently
const inFlight = new Map();

// ─────────────────────────────────────────────
//  Upload to IPFS
// ─────────────────────────────────────────────

/**
 * Upload a two-layer payload (metadata + encryptedPayload) to Pinata.
 * @caller  BACKEND — invoked by routes/records.js during the DOCTOR record-creation flow.
 *          The payload contains ONLY the cipherText + IV; the raw medical record
 *          is never sent to IPFS in plaintext.
 *
 * @param {object} metadata         - Unencrypted filtering metadata
 * @param {object} encryptedPayload - { cipherText, iv } (both Base64)
 * @returns {Promise<string>} The IPFS CID
 */
async function uploadToIPFS(metadata, encryptedPayload) {
  // Build the two-layer JSON payload
  const payload = JSON.stringify({ metadata, encryptedPayload });

  // Create a virtual file for Pinata's pinFileToIPFS endpoint
  const form = new FormData();
  form.append("file", Buffer.from(payload), {
    filename: `record_${Date.now()}.json`,
    contentType: "application/json",
  });

  // Optional: add Pinata metadata for dashboard organization
  form.append("pinataMetadata", JSON.stringify({
    name: `MedRec_${metadata.recordType}_${Date.now()}`,
  }));

  // PINATA_JWT is injected from env — never echoed in logs or responses
  const response = await axios.post(
    `${PINATA_BASE_URL}/pinning/pinFileToIPFS`,
    form,
    {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${process.env.PINATA_JWT}`,
      },
      maxContentLength: Infinity,
    }
  );

  return response.data.IpfsHash; // The CID
}

// ─────────────────────────────────────────────
//  Fetch from IPFS
// ─────────────────────────────────────────────

/**
 * Fetch a record payload from IPFS via Pinata gateway.
 * @caller  BACKEND — invoked by routes/records.js during the PATIENT & DOCTOR view flow
 *          to retrieve the full two-layer payload for decryption.
 *
 * @param {string} cid - IPFS Content Identifier
 * @returns {Promise<{ metadata: object, encryptedPayload: object }>}
 */
async function fetchFromIPFS(cid) {
  // 1. Check in-memory cache first (instant)
  if (IPFS_CACHE.has(cid)) return IPFS_CACHE.get(cid);

  // 2. Dedup concurrent requests for the same CID
  if (inFlight.has(cid)) return inFlight.get(cid);

  const fetchPromise = (async () => {
    // PINATA_JWT is injected from env — never echoed in logs or responses
    const response = await axios.get(`${PINATA_GATEWAY}/${cid}`, {
      headers: {
        Authorization: `Bearer ${process.env.PINATA_JWT}`,
      },
    });

    // response.data is already parsed JSON (axios auto-parses)
    const data = response.data;
    cacheSet(cid, data);
    return data;
  })();

  inFlight.set(cid, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlight.delete(cid);
  }
}

/**
 * Fetch ONLY the metadata (unencrypted layer) from an IPFS record.
 * @caller  BACKEND — invoked by routes/records.js during tag-based filtering
 *          for BOTH patient (all records) and doctor (operation-filtered) view flows.
 *          No private key is involved at this stage.
 *
 * Used for tag-based filtering — avoids transferring the full
 * encrypted payload when we only need to check tags.
 *
 * Note: IPFS doesn't support partial fetches, so we fetch the
 * full payload and return just the metadata portion.
 *
 * @param {string} cid - IPFS Content Identifier
 * @returns {Promise<object>} The metadata object
 */
async function fetchMetadataFromIPFS(cid) {
  const data = await fetchFromIPFS(cid);
  return data.metadata;
}

/**
 * Run async tasks with a concurrency limit.
 * @param {Array} items - Items to process
 * @param {number} limit - Max concurrent tasks
 * @param {Function} fn  - Async function(item) => result
 * @returns {Promise<Array>} Settled results (same as Promise.allSettled)
 */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (err) {
        results[i] = { status: "rejected", reason: err };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

module.exports = {
  uploadToIPFS,
  fetchFromIPFS,
  fetchMetadataFromIPFS,
  mapWithConcurrency,
};

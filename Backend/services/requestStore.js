/**
 * ============================================================
 *  services/requestStore.js
 *  MySQL (TiDB Cloud) CRUD for the `access_requests` table
 * ============================================================
 *
 *  CALLER OVERVIEW
 *  ───────────────
 *  createRequest()                → called by routes/requests.js (DOCTOR creates a request)
 *  getPendingRequestsForPatient() → called by routes/requests.js (PATIENT fetches incoming requests)
 *  updateRequestStatus()          → called by routes/requests.js (PATIENT approves/rejects)
 *
 *  No private keys or sensitive data are involved in this module.
 */

require("dotenv").config();
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────
//  Connection Pool (shared pattern)
// ─────────────────────────────────────────────

let pool;

function getPool() {
  if (!pool) {
    const sslConfig = {};
    if (process.env.CA) {
      const caPath = path.resolve(process.env.CA);
      if (fs.existsSync(caPath)) {
        sslConfig.ca = fs.readFileSync(caPath);
      }
    }

    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 4000,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: Object.keys(sslConfig).length > 0 ? sslConfig : undefined,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    console.log(`[RequestStore] MySQL pool created → ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  }
  return pool;
}

// ─────────────────────────────────────────────
//  CRUD Operations
// ─────────────────────────────────────────────

/**
 * Insert a new access request from a Doctor to a Patient.
 * @caller  BACKEND — routes/requests.js POST /
 *
 * @param {object} request
 * @param {string} request.patientAddress  - Patient Ethereum address
 * @param {string} request.doctorAddress   - Doctor Ethereum address
 * @param {string} request.operation       - Operation name (e.g. "diabetes_check")
 * @param {string} request.purpose         - Free-text purpose description
 * @returns {Promise<number>} The inserted request's ID
 */
async function createRequest({ patientAddress, doctorAddress, operation, purpose }) {
  const p = getPool();
  const [result] = await p.execute(
    `INSERT INTO access_requests (patient_address, doctor_address, operation, purpose, status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [patientAddress.toLowerCase(), doctorAddress.toLowerCase(), operation, purpose]
  );
  return result.insertId;
}

/**
 * Retrieve all pending access requests for a patient.
 * @caller  BACKEND — routes/requests.js GET /patient/:address
 *
 * @param {string} patientAddress - Patient Ethereum address
 * @returns {Promise<object[]>} Array of pending request rows
 */
async function getPendingRequestsForPatient(patientAddress) {
  const p = getPool();
  const [rows] = await p.execute(
    `SELECT id, patient_address, doctor_address, operation, purpose, status, created_at
     FROM access_requests
     WHERE patient_address = ? AND status = 'pending'
     ORDER BY created_at DESC`,
    [patientAddress.toLowerCase()]
  );
  return rows;
}

/**
 * Update the status of an access request.
 * @caller  BACKEND — routes/requests.js PUT /:id/status
 *
 * @param {number} id     - Request ID
 * @param {string} status - New status: 'approved' or 'rejected'
 */
async function updateRequestStatus(id, status) {
  const p = getPool();
  await p.execute(
    `UPDATE access_requests SET status = ? WHERE id = ?`,
    [status, id]
  );
}

/**
 * Get a single request by ID.
 * @caller  BACKEND — routes/requests.js PUT /:id/status (to read before update)
 *
 * @param {number} id - Request ID
 * @returns {Promise<object|null>} Request row or null
 */
async function getRequestById(id) {
  const p = getPool();
  const [rows] = await p.execute(
    `SELECT id, patient_address, doctor_address, operation, purpose, status, created_at
     FROM access_requests WHERE id = ?`,
    [id]
  );
  return rows.length > 0 ? rows[0] : null;
}

module.exports = {
  createRequest,
  getPendingRequestsForPatient,
  updateRequestStatus,
  getRequestById,
};

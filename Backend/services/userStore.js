/**
 * ============================================================
 *  services/userStore.js
 *  MySQL (TiDB Cloud) CRUD for the `users` table
 * ============================================================
 *
 *  Pure MetaMask auth — no email or password stored.
 *  Users are identified solely by their Ethereum address.
 *
 *  Stores NaCl public key + encrypted NaCl private key
 *  (protected by MetaMask signature-derived AES key).
 */

require("dotenv").config();
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ─────────────────────────────────────────────
//  Connection Pool
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
      connectTimeout: 10000,        // 10s — fail fast on bad connections
      enableKeepAlive: true,
      keepAliveInitialDelay: 30000, // 30s — keepalive before TiDB idle-kills the connection
    });

    pool.on("connection", (conn) => {
      conn.on("error", (err) => {
        if (err.code === "ECONNRESET" || err.code === "PROTOCOL_CONNECTION_LOST") {
          console.warn("[UserStore] DB connection lost, removing from pool:", err.code);
        }
      });
    });

    console.log(`[UserStore] MySQL pool created → ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  }
  return pool;
}

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

/** Generate a random 32-byte hex nonce for signature challenges. */
function generateNonce() {
  return crypto.randomBytes(32).toString("hex");
}

// ─────────────────────────────────────────────
//  CRUD Operations
// ─────────────────────────────────────────────

/**
 * Insert a new user into the DB (pure MetaMask — no email/password).
 *
 * @param {object} user
 * @param {string} user.ethereumAddress        - Ethereum address (primary identifier)
 * @param {string} user.role                   - 'patient', 'doctor', or 'diagnostics'
 * @param {string} user.naclPublicKey          - NaCl public key (Base64)
 * @param {string} user.encryptedNaclPrivateKey - AES-GCM encrypted NaCl private key (hex)
 * @param {string} user.naclKeyIv              - AES-GCM IV (hex)
 * @param {string} user.naclKeyAuthTag         - AES-GCM auth tag (hex)
 * @param {string} user.nonce                  - Current auth nonce
 * @returns {Promise<number>} The inserted user's ID
 */
async function createUser({ ethereumAddress, role, naclPublicKey, encryptedNaclPrivateKey, naclKeyIv, naclKeyAuthTag, nonce }) {
  const p = getPool();
  const [result] = await p.execute(
    `INSERT INTO users (ethereum_address, role, nacl_public_key, encrypted_nacl_private_key, nacl_key_iv, nacl_key_auth_tag, nonce)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [ethereumAddress, role, naclPublicKey, encryptedNaclPrivateKey, naclKeyIv, naclKeyAuthTag, nonce]
  );
  return result.insertId;
}

/**
 * Retrieve a user by Ethereum address — full row (including encrypted NaCl key data).
 * Used during login to return encrypted keys to the client.
 */
async function getUserByEthereumAddressFull(ethereumAddress) {
  const p = getPool();
  const [rows] = await p.execute(
    `SELECT id, role, nacl_public_key, encrypted_nacl_private_key, nacl_key_iv, nacl_key_auth_tag,
            ethereum_address, nonce, created_at
     FROM users WHERE LOWER(ethereum_address) = LOWER(?)`,
    [ethereumAddress]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Retrieve a user by ID (public fields only).
 */
async function getUserById(id) {
  const p = getPool();
  const [rows] = await p.execute(
    `SELECT id, role, nacl_public_key, ethereum_address, created_at
     FROM users WHERE id = ?`,
    [id]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Retrieve a user by Ethereum address (public fields only).
 */
async function getUserByEthereumAddress(ethereumAddress) {
  const p = getPool();
  const [rows] = await p.execute(
    `SELECT id, role, nacl_public_key, ethereum_address, created_at
     FROM users WHERE LOWER(ethereum_address) = LOWER(?)`,
    [ethereumAddress]
  );
  return rows.length > 0 ? rows[0] : null;
}


/**
 * Update the nonce for a given Ethereum address (used after successful auth).
 */
async function updateNonce(ethereumAddress, nonce) {
  const p = getPool();
  await p.execute(
    `UPDATE users SET nonce = ? WHERE LOWER(ethereum_address) = LOWER(?)`,
    [nonce, ethereumAddress]
  );
}

/**
 * Store a nonce for an address that hasn't registered yet (pre-registration challenge).
 * Uses an in-memory Map since there's no user row yet.
 */
const pendingNonces = new Map();

function setPendingNonce(ethereumAddress, nonce) {
  pendingNonces.set(ethereumAddress.toLowerCase(), nonce);
}

function getPendingNonce(ethereumAddress) {
  return pendingNonces.get(ethereumAddress.toLowerCase()) || null;
}

function clearPendingNonce(ethereumAddress) {
  pendingNonces.delete(ethereumAddress.toLowerCase());
}

module.exports = {
  generateNonce,
  createUser,
  getUserByEthereumAddressFull,
  getUserById,
  getUserByEthereumAddress,
  updateNonce,
  setPendingNonce,
  getPendingNonce,
  clearPendingNonce,
};

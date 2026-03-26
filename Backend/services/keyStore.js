/**
 * ============================================================
 *  services/keyStore.js
 *  MySQL (TiDB Cloud) storage for NaCl-encrypted AES keys
 * ============================================================
 *
 *  TABLE: encrypted_keys
 *  ─────────────────────
 *  | cid | user_address | encrypted_aes_key | nonce | sender_address |
 *  | created_at |
 */

require("dotenv").config();
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

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
      connectTimeout: 10000,       // 10s — fail fast on bad connections
      enableKeepAlive: true,
      keepAliveInitialDelay: 30000, // 30s — send keepalive before TiDB idle-kills the connection
    });

    // Destroy stale connections on ECONNRESET so the pool auto-reconnects
    pool.on("connection", (conn) => {
      conn.on("error", (err) => {
        if (err.code === "ECONNRESET" || err.code === "PROTOCOL_CONNECTION_LOST") {
          console.warn("[KeyStore] DB connection lost, removing from pool:", err.code);
        }
      });
    });

    console.log(`[KeyStore] MySQL pool created → ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  }
  return pool;
}

/**
 * Execute a DB query with one automatic retry on connection reset.
 */
async function withRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === "ECONNRESET" || err.code === "PROTOCOL_CONNECTION_LOST") {
      console.warn("[KeyStore] Connection lost, retrying once…");
      // Force pool to drop the stale connection by destroying it
      pool = null;
      return await fn();
    }
    throw err;
  }
}

// ─────────────────────────────────────────────
//  Encrypted AES Key Operations
// ─────────────────────────────────────────────

/**
 * Store (or replace) a NaCl-encrypted AES key for a user + CID.
 *
 * @param {string} cid                        - IPFS CID of the record
 * @param {string} userAddress                - Ethereum address
 * @param {string} encryptedKey               - Base64 NaCl-encrypted AES key
 * @param {string} nonce                      - Base64 NaCl nonce
 * @param {string} senderAddress              - Ethereum address of the encrypting party
 */
async function storeEncryptedKey(cid, userAddress, encryptedKey, nonce, senderAddress) {
  return withRetry(async () => {
    const p = getPool();
    await p.execute(
      `INSERT INTO encrypted_keys (cid, user_address, encrypted_aes_key, nonce, sender_address)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE encrypted_aes_key = VALUES(encrypted_aes_key),
                               nonce = VALUES(nonce),
                               sender_address = VALUES(sender_address),
                               created_at = CURRENT_TIMESTAMP`,
      // NOTE: senderAddress is a NaCl public key (Base64), NOT an Ethereum address — do NOT lowercase it
      [cid, userAddress.toLowerCase(), encryptedKey, nonce, senderAddress || null]
    );
  });
}

/**
 * Retrieve the encrypted AES key + nonce + sender for a specific user + CID.
 *
 * @param {string} cid         - IPFS CID
 * @param {string} userAddress - Ethereum address
 * @returns {Promise<{ encrypted_aes_key, nonce, sender_address }|null>}
 */
async function getEncryptedKey(cid, userAddress) {
  return withRetry(async () => {
    const p = getPool();
    const [rows] = await p.execute(
      `SELECT encrypted_aes_key, nonce, sender_address
       FROM encrypted_keys WHERE cid = ? AND user_address = ?`,
      [cid, userAddress.toLowerCase()]
    );
    return rows.length > 0 ? rows[0] : null;
  });
}


/**
 * Remove a user's encrypted key entry for a specific CID.
 */
async function removeKeysForUser(cid, userAddress) {
  const p = getPool();
  await p.execute(
    `DELETE FROM encrypted_keys WHERE cid = ? AND user_address = ?`,
    [cid, userAddress.toLowerCase()]
  );
}

/**
 * Remove ALL key entries for a user across all CIDs.
 */
async function removeAllKeysForUser(userAddress) {
  const p = getPool();
  await p.execute(
    `DELETE FROM encrypted_keys WHERE user_address = ?`,
    [userAddress.toLowerCase()]
  );
}

/**
 * Get all CIDs that a user has encrypted AES keys for.
 */
async function getCIDsForUser(userAddress) {
  const p = getPool();
  const [rows] = await p.execute(
    `SELECT cid FROM encrypted_keys WHERE user_address = ?`,
    [userAddress.toLowerCase()]
  );
  return rows.map(r => r.cid);
}

module.exports = {
  storeEncryptedKey,
  getEncryptedKey,
  removeKeysForUser,
  removeAllKeysForUser,
  getCIDsForUser,
};

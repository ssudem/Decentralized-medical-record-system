/**
 * ============================================================
 *  services/userDirectory.js
 *  MySQL CRUD for the `user_directory` table
 * ============================================================
 *
 *  CALLER OVERVIEW
 *  ───────────────
 *  upsertUser()     → called by routes/users.js after blockchain registration
 *  searchUsers()    → called by routes/users.js for name-based search
 *  getUserByAddr()  → called by routes/users.js for single address lookup
 *
 *  This is an INDEX of on-chain data — the blockchain is the source of truth.
 *  If the DB is wiped, it can be rebuilt from blockchain events.
 *
 *  TABLE SCHEMA (create this manually):
 *  ─────────────────────────────────────
 *  CREATE TABLE IF NOT EXISTS user_directory (
 *    wallet_address  VARCHAR(255) NOT NULL PRIMARY KEY,
 *    full_name       VARCHAR(255) NOT NULL,
 *    role            VARCHAR(50)  NOT NULL,
 *    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
 *  );
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
      connectTimeout: 10000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 30000,
    });

    pool.on("connection", (conn) => {
      conn.on("error", (err) => {
        if (err.code === "ECONNRESET" || err.code === "PROTOCOL_CONNECTION_LOST") {
          console.warn("[UserDirectory] DB connection lost, removing from pool:", err.code);
        }
      });
    });

    console.log(`[UserDirectory] MySQL pool created → ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  }
  return pool;
}

async function withRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === "ECONNRESET" || err.code === "PROTOCOL_CONNECTION_LOST") {
      console.warn("[UserDirectory] Connection lost, retrying once…");
      pool = null;
      return await fn();
    }
    throw err;
  }
}

// ─────────────────────────────────────────────
//  CRUD Operations
// ─────────────────────────────────────────────

/**
 * Insert or update a user in the directory.
 * @param {string} walletAddress - Ethereum address
 * @param {string} fullName     - Display name
 * @param {string} role         - 'patient', 'doctor', or 'diagnostics'
 */
async function upsertUser(walletAddress, fullName, role) {
  return withRetry(async () => {
    const p = getPool();
    await p.execute(
      `INSERT INTO user_directory (wallet_address, full_name, role)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role = VALUES(role)`,
      [walletAddress.toLowerCase(), fullName, role]
    );
  });
}

/**
 * Search users by name (partial match).
 * @param {string} query - Search term
 * @param {string} [role] - Optional role filter
 * @returns {Promise<Array<{ wallet_address, full_name, role }>>}
 */
async function searchUsers(query, role) {
  return withRetry(async () => {
    const p = getPool();
    let sql = `SELECT wallet_address, full_name, role FROM user_directory WHERE LOWER(full_name) LIKE LOWER(?)`;
    const params = [`%${query}%`];

    if (role) {
      sql += ` AND role = ?`;
      params.push(role);
    }

    sql += ` ORDER BY full_name ASC LIMIT 10`;

    const [rows] = await p.execute(sql, params);
    return rows;
  });
}

/**
 * Get a single user by wallet address.
 * @param {string} walletAddress - Ethereum address
 * @returns {Promise<{ wallet_address, full_name, role } | null>}
 */
async function getUserByAddress(walletAddress) {
  return withRetry(async () => {
    const p = getPool();
    const [rows] = await p.execute(
      `SELECT wallet_address, full_name, role FROM user_directory WHERE wallet_address = ?`,
      [walletAddress.toLowerCase()]
    );
    return rows.length > 0 ? rows[0] : null;
  });
}

module.exports = {
  upsertUser,
  searchUsers,
  getUserByAddress,
};

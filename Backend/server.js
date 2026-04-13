/**
 * ============================================================
 *  server.js
 *  Express entry point — Secure Execution Layer
 *  for the Decentralized Medical Record System
 * ============================================================
 *
 *  CALLER: This file is executed by Node.js at startup.
 *  It is NOT called by patients or doctors directly.
 *  All patient/doctor interactions happen through the HTTP
 *  routes mounted below.
 *
 *  ROUTE CALLER SUMMARY
 *  ────────────────────
 *  POST /api/auth/login         → ALL USERS (timestamp-based wallet auth, keys from blockchain)
 *  POST /api/auth/login         → PATIENT or DOCTOR (returns JWT + private key)
 *  GET  /api/auth/me            → PATIENT or DOCTOR (JWT-protected profile)
 *  POST /api/records            → DOCTOR uploads a new encrypted record
 *  POST /api/records/view       → PATIENT (all records) or DOCTOR (filtered)
 *  POST /api/access/grant       → PATIENT re-encrypts AES key for a doctor
 *  POST /api/access/revoke      → PATIENT removes a doctor's decryption key
 *  GET  /api/access/keys/:cid/:address → PATIENT or DOCTOR retrieves their key
 *  GET  /api/health             → anyone (monitoring / health probe)
 *
 *  ⚠️  PRIVATE KEY NOTICE
 *  ─────────────────────
 *  SERVER_PRIVATE_KEY is loaded from .env via dotenv at startup and passed
 *  to initBlockchain(). It is NEVER logged, echoed in responses, or exposed
 *  in any HTTP endpoint. The .env file is excluded from version control via
 *  .gitignore. Confirm .gitignore includes ".env" before pushing to any repo.
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");

const { initBlockchain } = require("./services/blockchain");

// Route modules
const authRouter = require("./routes/auth");
const recordsRouter = require("./routes/records");
const accessRouter = require("./routes/access");
const hospitalsRouter = require("./routes/hospitals");
const requestsRouter = require("./routes/requests");
const diagnosticsRouter = require("./routes/diagnostics");

// ─────────────────────────────────────────────
//  App Initialization
// ─────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" })); // medical records can be large

// ─────────────────────────────────────────────
//  Routes
// ─────────────────────────────────────────────

app.use("/api/auth", authRouter);
app.use("/api/records", recordsRouter);
app.use("/api/access", accessRouter);
app.use("/api/hospitals", hospitalsRouter);
app.use("/api/requests", requestsRouter);
app.use("/api/diagnostics", diagnosticsRouter);

// Health check — returns no sensitive information
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "MediRecord Secure Execution Layer",
    timestamp: new Date().toISOString(),
  });
});

// Config — single source of truth for operation → tag mapping
app.get("/api/config/operation-tags", (req, res) => {
  const { OPERATION_TAG_MAP } = require("./config/operationTags");
  res.json(OPERATION_TAG_MAP);
});

// ─────────────────────────────────────────────
//  Server Start
// ─────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log("═══════════════════════════════════════════");
  console.log("  MediRecord — Secure Execution Layer");
  console.log("═══════════════════════════════════════════");
  console.log(`  Server running on http://localhost:${PORT}`);
  console.log(`  Health check:  GET /api/health`);
  console.log("═══════════════════════════════════════════");

  // Initialize blockchain connection (reads SERVER_PRIVATE_KEY from env)
  try {
    if (
      process.env.BLOCKCHAIN_RPC_URL &&
      process.env.SERVER_PRIVATE_KEY &&
      process.env.CONTRACT_ADDRESS
    ) {
      initBlockchain();
      console.log("  ✅ Blockchain connected");
    } else {
      console.warn(
        "  ⚠️  Blockchain env vars missing — blockchain features disabled",
      );
    }
  } catch (err) {
    // Log only the message, not the full error object (avoid leaking key context)
    console.error("  ❌ Blockchain init failed:", err.message);
  }

  console.log("═══════════════════════════════════════════\n");
});

module.exports = app;

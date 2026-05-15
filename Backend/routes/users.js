/**
 * ============================================================
 *  routes/users.js
 *  POST   /api/users/register   — Save user to directory after blockchain registration
 *  GET    /api/users/search     — Search users by name (for form auto-complete)
 *  GET    /api/users/:address   — Get a single user by address
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const { upsertUser, searchUsers, getUserByAddress } = require("../services/userDirectory");

// ─────────────────────────────────────────────
//  POST /api/users/register — Save to directory
// ─────────────────────────────────────────────

/**
 * Called by the Frontend AFTER a successful blockchain registration.
 * Stores the name + address in MySQL so other users can search by name.
 *
 * Body: { walletAddress, fullName, role }
 */
router.post("/register", async (req, res) => {
  try {
    const { walletAddress, fullName, role } = req.body;

    if (!walletAddress || !fullName || !role) {
      return res.status(400).json({ error: "Missing required fields: walletAddress, fullName, role" });
    }

    await upsertUser(walletAddress, fullName, role);

    console.log(`[UserDirectory] Registered: ${fullName} (${role}) → ${walletAddress}`);

    res.json({ success: true, message: "User saved to directory" });
  } catch (error) {
    console.error("[UserDirectory] Error saving user:", error.message);
    res.status(500).json({ error: "Failed to save user to directory" });
  }
});

// ─────────────────────────────────────────────
//  GET /api/users/search?q=...&role=...
// ─────────────────────────────────────────────

/**
 * Search for users by name. Used by address input fields
 * so doctors/patients can find each other without memorizing addresses.
 *
 * Query params:
 *   q    — search term (required, min 2 chars)
 *   role — optional filter: 'patient', 'doctor', or 'diagnostics'
 */
router.get("/search", async (req, res) => {
  try {
    const { q, role } = req.query;

    if (!q || q.length < 2) {
      return res.json({ success: true, users: [] });
    }

    const users = await searchUsers(q, role || null);

    res.json({ success: true, users });
  } catch (error) {
    console.error("[UserDirectory] Search error:", error.message);
    res.status(500).json({ error: "Search failed" });
  }
});

// ─────────────────────────────────────────────
//  GET /api/users/:address — Single lookup
// ─────────────────────────────────────────────

router.get("/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const user = await getUserByAddress(address);

    if (!user) {
      return res.status(200).json({ success: true, user: null });
    }

    res.json({ success: true, user });
  } catch (error) {
    console.error("[UserDirectory] Lookup error:", error.message);
    res.status(500).json({ error: "Lookup failed" });
  }
});

module.exports = router;

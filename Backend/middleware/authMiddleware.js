/**
 * ============================================================
 *  middleware/authMiddleware.js
 *  JWT verification middleware for protected routes
 * ============================================================
 *
 *  CALLER OVERVIEW
 *  ───────────────
 *  verifyToken() is used as Express middleware on any route that
 *  requires authentication (e.g. GET /api/auth/me).
 *
 *  It can be used by PATIENT or DOCTOR — the JWT payload includes
 *  the user's role, so downstream handlers can differentiate.
 *
 *  ⚠️  PRIVATE KEY NOTICE
 *  ─────────────────────
 *  JWT_SECRET is read from process.env and is NEVER logged or
 *  returned in any response. If verification fails, the error
 *  message is sanitised (a generic 401 is returned).
 */

require("dotenv").config();
const jwt = require("jsonwebtoken");

/**
 * Express middleware: verify JWT from the Authorization header.
 * @caller  PATIENT, DOCTOR, or DIAGNOSTICS — any authenticated request.
 *          Attach this as middleware to protected routes:
 *            router.get("/me", verifyToken, handler);
 *
 * On success, sets req.user = { id, ethereumAddress, role } for downstream handlers.
 * On failure, returns 401 with a generic error (no token details leaked).
 */
function verifyToken(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Attach user info to the request for downstream use
    req.user = {
      ethereumAddress: decoded.ethereumAddress,
      role: decoded.role,
    };
    next();
  } catch (err) {
    // Do NOT expose the raw JWT error (could leak token structure)
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

module.exports = { verifyToken };

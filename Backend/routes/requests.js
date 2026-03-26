/**
 * ============================================================
 *  routes/requests.js
 *  POST   /api/requests                — Doctor creates an access request
 *  GET    /api/requests/patient/:address — Patient views pending requests
 *  PUT    /api/requests/:id/status     — Patient approves or rejects
 * ============================================================
 *
 *  CALLER OVERVIEW
 *  ───────────────
 *  POST   /               → DOCTOR (creates a request for a patient)
 *  GET    /patient/:addr  → PATIENT (views their pending incoming requests)
 *  PUT    /:id/status     → PATIENT (approves or rejects a specific request)
 *
 *  No private keys are involved in this module.
 */

const express = require("express");
const router = express.Router();

const {
  createRequest,
  getPendingRequestsForPatient,
  updateRequestStatus,
  getRequestById,
} = require("../services/requestStore");

// ─────────────────────────────────────────────
//  POST /api/requests — Doctor creates access request
// ─────────────────────────────────────────────

/**
 * @caller  DOCTOR
 *
 * Request body:
 * {
 *   "patientAddress": "0x...",
 *   "doctorAddress":  "0x...",
 *   "operation":      "diabetes_check",
 *   "purpose":        "Routine diabetes follow-up"
 * }
 */
router.post("/", async (req, res) => {
  try {
    const { patientAddress, doctorAddress, operation, purpose } = req.body;

    if (!patientAddress || !doctorAddress || !operation || !purpose) {
      return res.status(400).json({
        error: "Missing required fields: patientAddress, doctorAddress, operation, purpose",
      });
    }

    const id = await createRequest({ patientAddress, doctorAddress, operation, purpose });

    console.log(`[Requests] Doctor ${doctorAddress} requested access to patient ${patientAddress} for "${operation}"`);

    res.status(201).json({
      success: true,
      requestId: id,
      message: "Access request created successfully. Waiting for patient approval.",
    });
  } catch (error) {
    console.error("[Requests] Error creating request:", error.message);
    res.status(500).json({ error: "Internal server error while creating access request." });
  }
});

// ─────────────────────────────────────────────
//  GET /api/requests/patient/:address — Patient views pending requests
// ─────────────────────────────────────────────

/**
 * @caller  PATIENT
 *
 * Returns all pending access requests for the given patient address.
 */
router.get("/patient/:address", async (req, res) => {
  try {
    const { address } = req.params;
    if (!address) {
      return res.status(400).json({ error: "Patient address is required" });
    }

    const requests = await getPendingRequestsForPatient(address);

    res.json({ success: true, requests });
  } catch (error) {
    console.error("[Requests] Error fetching requests:", error.message);
    res.status(500).json({ error: "Internal server error while fetching access requests." });
  }
});

// ─────────────────────────────────────────────
//  PUT /api/requests/:id/status — Patient approves / rejects
// ─────────────────────────────────────────────

/**
 * @caller  PATIENT
 *
 * Request body:
 * {
 *   "status": "approved" | "rejected"
 * }
 */
router.put("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Status must be 'approved' or 'rejected'" });
    }

    const request = await getRequestById(id);
    if (!request) {
      return res.status(404).json({ error: "Access request not found" });
    }

    if (request.status !== "pending") {
      return res.status(400).json({ error: `Request already ${request.status}` });
    }

    await updateRequestStatus(id, status);

    console.log(`[Requests] Request ${id} updated to "${status}"`);

    res.json({
      success: true,
      message: `Request ${status} successfully`,
    });
  } catch (error) {
    console.error("[Requests] Error updating request:", error.message);
    res.status(500).json({ error: "Internal server error while updating access request." });
  }
});

module.exports = router;

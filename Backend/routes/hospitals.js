/**
 * ============================================================
 *  routes/hospitals.js
 *  Endpoints to manage hospitals, doctor, and diagnostics lab
 *  authorizations via the smart contract.
 * ============================================================
 *
 *  CALLER OVERVIEW
 *  ───────────────
 *  POST /api/hospitals/add                      → called by SuperAdmin
 *  POST /api/hospitals/authorize-doctor         → called by a Hospital Admin
 *  POST /api/hospitals/authorize-diagnostics    → called by a Hospital Admin
 *  GET  /api/hospitals/:address/status           → public / UI check
 *  GET  /api/hospitals/doctor/:address           → public / UI check
 *  GET  /api/hospitals/diagnostics-lab/:address  → public / UI check
 */

const express = require("express");
const router = express.Router();

const {
  addHospitalOnChain,
  removeHospitalOnChain,
  isHospitalValid,
  authorizeDoctorOnChain,
  unauthorizeDoctorOnChain,
  getDoctorHospital,
  authorizeDiagnosticsLabOnChain,
  unauthorizeDiagnosticsLabOnChain,
  getDiagnosticsLabHospital,
} = require("../services/blockchain");

// ─────────────────────────────────────────────
//  POST /api/hospitals/add
// ─────────────────────────────────────────────

/**
 * @caller  SuperAdmin
 *
 * Adds a new hospital to the blockchain. The backend signs this transaction
 * automatically using the `SERVER_PRIVATE_KEY` since only the super admin
 * can add hospitals in MedicalRecordSystem.sol.
 *
 * Request body:
 * {
 *   "hospitalAddress": "0x..."
 * }
 */
router.post("/add", async (req, res) => {
  const { hospitalAddress } = req.body;

  if (!hospitalAddress) {
    return res.status(400).json({ error: "Missing required field: hospitalAddress" });
  }

  try {
    const txHash = await addHospitalOnChain(hospitalAddress);
    console.log(`[Hospitals] Added hospital: ${hospitalAddress} (TX: ${txHash})`);
    
    res.status(201).json({
      success: true,
      hospitalAddress,
      txHash,
      message: "Hospital successfully added to the blockchain."
    });
  } catch (error) {
    console.error(`[Hospitals] Failed to add hospital ${hospitalAddress}:`, error.message);
    res.status(500).json({ error: "Failed to add hospital on-chain." });
  }
});

// ─────────────────────────────────────────────
//  POST /api/hospitals/authorize-doctor
// ─────────────────────────────────────────────

/**
 * @caller  Hospital Admin
 *
 * Authorizes a doctor to upload records under this hospital's umbrella.
 * The hospital must be valid (added via SuperAdmin).
 *
 * Request body:
 * {
 *   "doctorAddress": "0x...",
 *   "hospitalPrivateKey": "0x..."  <- ephemeral, in-memory only
 * }
 */
router.post("/authorize-doctor", async (req, res) => {
  // Destructure early to sanitise errors
  const { doctorAddress, hospitalPrivateKey } = req.body;

  if (!doctorAddress || !hospitalPrivateKey) {
    return res.status(400).json({ 
      error: "Missing required fields: doctorAddress, hospitalPrivateKey" 
    });
  }

  try {
    const txHash = await authorizeDoctorOnChain(doctorAddress, hospitalPrivateKey);
    console.log(`[Hospitals] Doctor ${doctorAddress} authorized by hospital (TX: ${txHash})`);
    
    res.status(200).json({
      success: true,
      doctorAddress,
      txHash,
      message: "Doctor successfully authorized on the blockchain."
    });
  } catch (error) {
    // Sanitise: don't return raw ethers error
    console.error(`[Hospitals] Failed to authorize doctor ${doctorAddress} (details hidden)`);
    res.status(500).json({ error: "Failed to authorize doctor. Ensure the hospital is valid and the key is correct." });
  }
});

// ─────────────────────────────────────────────
//  GET /api/hospitals/:address/status
// ─────────────────────────────────────────────

/**
 * @caller  Public / UI
 * Check if a specific address is a validated hospital.
 */
router.get("/:address/status", async (req, res) => {
  try {
    const { address } = req.params;
    const isValid = await isHospitalValid(address);
    res.json({ address, isValid });
  } catch (error) {
    console.error("[Hospitals] Check status error:", error.message);
    res.status(500).json({ error: "Failed to check hospital status." });
  }
});

// ─────────────────────────────────────────────
//  GET /api/hospitals/doctor/:address
// ─────────────────────────────────────────────

/**
 * @caller  Public / UI
 * Get the hospital address linked to a specific doctor.
 */
router.get("/doctor/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const hospitalAddress = await getDoctorHospital(address);
    res.json({ doctorAddress: address, hospitalAddress });
  } catch (error) {
    console.error("[Hospitals] Check doctor hospital error:", error.message);
    res.status(500).json({ error: "Failed to fetch doctor's hospital." });
  }
});
// ─────────────────────────────────────────────
//  POST /api/hospitals/authorize-diagnostics
// ─────────────────────────────────────────────

/**
 * @caller  Hospital Admin
 *
 * Authorizes a diagnostics lab under this hospital’s umbrella.
 *
 * Request body:
 * {
 *   "labAddress": "0x...",
 *   "hospitalPrivateKey": "0x..."  <- ephemeral, in-memory only
 * }
 */
router.post("/authorize-diagnostics", async (req, res) => {
  const { labAddress, hospitalPrivateKey } = req.body;

  if (!labAddress || !hospitalPrivateKey) {
    return res.status(400).json({
      error: "Missing required fields: labAddress, hospitalPrivateKey"
    });
  }

  try {
    const txHash = await authorizeDiagnosticsLabOnChain(labAddress, hospitalPrivateKey);
    console.log(`[Hospitals] Diagnostics lab ${labAddress} authorized (TX: ${txHash})`);

    res.status(200).json({
      success: true,
      labAddress,
      txHash,
      message: "Diagnostics lab successfully authorized on the blockchain."
    });
  } catch (error) {
    console.error(`[Hospitals] Failed to authorize diagnostics lab ${labAddress} (details hidden)`);
    res.status(500).json({ error: "Failed to authorize diagnostics lab. Ensure the hospital is valid and the key is correct." });
  }
});

// ─────────────────────────────────────────────
//  GET /api/hospitals/diagnostics-lab/:address
// ─────────────────────────────────────────────

/**
 * @caller  Public / UI
 * Get the hospital address linked to a specific diagnostics lab.
 */
router.get("/diagnostics-lab/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const hospitalAddress = await getDiagnosticsLabHospital(address);
    res.json({ labAddress: address, hospitalAddress });
  } catch (error) {
    console.error("[Hospitals] Check diagnostics lab hospital error:", error.message);
    res.status(500).json({ error: "Failed to fetch diagnostics lab's hospital." });
  }
});

// ─────────────────────────────────────────────
//  POST /api/hospitals/remove
// ─────────────────────────────────────────────

/**
 * @caller  SuperAdmin
 *
 * Removes a hospital from the blockchain registry. The backend signs this
 * transaction automatically using the `SERVER_PRIVATE_KEY`.
 *
 * Request body:
 * {
 *   "hospitalAddress": "0x..."
 * }
 */
router.post("/remove", async (req, res) => {
  const { hospitalAddress } = req.body;

  if (!hospitalAddress) {
    return res.status(400).json({ error: "Missing required field: hospitalAddress" });
  }

  try {
    const txHash = await removeHospitalOnChain(hospitalAddress);
    console.log(`[Hospitals] Removed hospital: ${hospitalAddress} (TX: ${txHash})`);

    res.status(200).json({
      success: true,
      hospitalAddress,
      txHash,
      message: "Hospital successfully removed from the blockchain."
    });
  } catch (error) {
    console.error(`[Hospitals] Failed to remove hospital ${hospitalAddress}:`, error.message);
    res.status(500).json({ error: "Failed to remove hospital on-chain." });
  }
});

// ─────────────────────────────────────────────
//  POST /api/hospitals/unauthorize-doctor
// ─────────────────────────────────────────────

/**
 * @caller  Hospital Admin
 *
 * Revokes a doctor's authorization under this hospital.
 *
 * Request body:
 * {
 *   "doctorAddress": "0x...",
 *   "hospitalPrivateKey": "0x..."  <- ephemeral, in-memory only
 * }
 */
router.post("/unauthorize-doctor", async (req, res) => {
  const { doctorAddress, hospitalPrivateKey } = req.body;

  if (!doctorAddress || !hospitalPrivateKey) {
    return res.status(400).json({
      error: "Missing required fields: doctorAddress, hospitalPrivateKey"
    });
  }

  try {
    const txHash = await unauthorizeDoctorOnChain(doctorAddress, hospitalPrivateKey);
    console.log(`[Hospitals] Doctor ${doctorAddress} unauthorised (TX: ${txHash})`);

    res.status(200).json({
      success: true,
      doctorAddress,
      txHash,
      message: "Doctor successfully unauthorised on the blockchain."
    });
  } catch (error) {
    console.error(`[Hospitals] Failed to unauthorize doctor ${doctorAddress} (details hidden)`);
    res.status(500).json({ error: "Failed to unauthorize doctor. Ensure the hospital is valid and the key is correct." });
  }
});

// ─────────────────────────────────────────────
//  POST /api/hospitals/unauthorize-diagnostics
// ─────────────────────────────────────────────

/**
 * @caller  Hospital Admin
 *
 * Revokes a diagnostics lab's authorization under this hospital.
 *
 * Request body:
 * {
 *   "labAddress": "0x...",
 *   "hospitalPrivateKey": "0x..."  <- ephemeral, in-memory only
 * }
 */
router.post("/unauthorize-diagnostics", async (req, res) => {
  const { labAddress, hospitalPrivateKey } = req.body;

  if (!labAddress || !hospitalPrivateKey) {
    return res.status(400).json({
      error: "Missing required fields: labAddress, hospitalPrivateKey"
    });
  }

  try {
    const txHash = await unauthorizeDiagnosticsLabOnChain(labAddress, hospitalPrivateKey);
    console.log(`[Hospitals] Diagnostics lab ${labAddress} unauthorised (TX: ${txHash})`);

    res.status(200).json({
      success: true,
      labAddress,
      txHash,
      message: "Diagnostics lab successfully unauthorised on the blockchain."
    });
  } catch (error) {
    console.error(`[Hospitals] Failed to unauthorize diagnostics lab ${labAddress} (details hidden)`);
    res.status(500).json({ error: "Failed to unauthorize diagnostics lab. Ensure the hospital is valid and the key is correct." });
  }
});

module.exports = router;

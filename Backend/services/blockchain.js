/**
 * ============================================================
 *  services/blockchain.js
 *  Ethers.js v6 helpers for interacting with
 *  the MedicalRecordSystem smart contract
 * ============================================================
 *
 *  CALLER OVERVIEW
 *  ───────────────
 *  All functions in this module are called by the BACKEND (Node.js server),
 *  NOT directly by patients or doctors over HTTP.
 *
 *  The backend connects as the SuperAdmin wallet (SERVER_PRIVATE_KEY)
 *  which is the same address that deployed the contract. This gives
 *  the backend the ability to call getPatientRecords() for ANY
 *  patient — used by the secure execution layer.
 *
 *  uploadRecordOnChain() is the ONE exception: it creates a temporary
 *  ethers.Wallet from the doctor's private key (received from the
 *  POST /api/records route) in order to sign the on-chain tx as the
 *  doctor. The key is held in-memory for the duration of the call only
 *  and is never stored or logged.
 *
 *  ⚠️  PRIVATE KEY NOTICE
 *  ─────────────────────
 *  SERVER_PRIVATE_KEY is read from process.env at startup — it must
 *  exist only in the .env file, which is excluded from version control
 *  via .gitignore. It is NEVER logged, echoed in responses, or exposed
 *  to any HTTP caller.
 *
 *  The doctorPrivateKey parameter in uploadRecordOnChain() is used
 *  solely to construct an ephemeral ethers.Wallet instance. It is
 *  NOT stored, NOT logged (even on error), and NOT returned.
 */

require("dotenv").config();
const { ethers } = require("ethers");
const path = require("path");
const contractABI = require(path.join(__dirname, "..", "contractABI.json"));

// ─────────────────────────────────────────────
//  Provider & Wallet Setup
// ─────────────────────────────────────────────

let provider;
let serverWallet;
let contract;

/**
 * Initialize the blockchain connection.
 * @caller  BACKEND — called once at server startup (server.js → initBlockchain())
 *
 * Reads SERVER_PRIVATE_KEY from .env to create the SuperAdmin wallet.
 * The key is held in the `serverWallet` variable for the lifetime of the
 * process and is NEVER exposed through any API response or log statement.
 */
function initBlockchain() {
  provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
  serverWallet = new ethers.Wallet(process.env.SERVER_PRIVATE_KEY, provider);
  contract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS,
    contractABI,
    serverWallet
  );

  // Log the derived PUBLIC address only; the private key is never logged.
  console.log(`[Blockchain] Connected as SuperAdmin: ${serverWallet.address}`);
  console.log(`[Blockchain] Contract: ${process.env.CONTRACT_ADDRESS}`);
}

/**
 * Get the contract instance (connected via serverWallet / superAdmin).
 * @caller  BACKEND — used internally by other functions in this module
 * @returns {ethers.Contract}
 */
function getContract() {
  if (!contract) initBlockchain();
  return contract;
}

/**
 * Get the provider instance.
 * @caller  BACKEND — used internally (e.g., by uploadRecordOnChain)
 * @returns {ethers.JsonRpcProvider}
 */
function getProvider() {
  if (!provider) initBlockchain();
  return provider;
}

// ─────────────────────────────────────────────
//  Permission Checks
// ─────────────────────────────────────────────

/**
 * Check if a doctor has active permission for an operation on a patient.
 * @caller  BACKEND — called from routes/records.js (view) and routes/access.js (grant/keys)
 *          to verify on-chain permission before allowing any data access.
 *
 * @param {string} patientAddress - Patient Ethereum address
 * @param {string} doctorAddress  - Doctor Ethereum address
 * @param {string} operation      - Operation name (e.g. "diabetes_check")
 * @returns {Promise<boolean>}
 */
async function checkPermission(patientAddress, doctorAddress, operation) {
  const c = getContract();
  return await c.checkPermission(patientAddress, doctorAddress, operation);
}

/**
 * Get the expiry timestamp for a specific permission.
 * @caller  BACKEND — utility function; can be called to display remaining
 *          access time in a UI or for admin dashboards.
 *
 * @param {string} patientAddress
 * @param {string} doctorAddress
 * @param {string} operation
 * @returns {Promise<bigint>} Unix timestamp (0 = never granted or revoked)
 */
async function getAccessExpiry(patientAddress, doctorAddress, operation) {
  const c = getContract();
  return await c.getAccessExpiry(patientAddress, doctorAddress, operation);
}

// ─────────────────────────────────────────────
//  Record Operations
// ─────────────────────────────────────────────

/**
 * Retrieve all record CIDs for a patient.
 * @caller  BACKEND — called from routes/records.js (POST /view) as SuperAdmin
 *          so no specific operation permission is needed at this layer.
 *          Permission enforcement happens in the route handler.
 *
 * @param {string} patientAddress - Patient Ethereum address
 * @returns {Promise<Array<{ ipfsHash: string, issuedByDoctor: string, timestamp: bigint }>>}
 */
async function getPatientRecordCIDs(patientAddress) {
  const c = getContract();
  // SuperAdmin can pass any operation string — contract skips the permission check
  const records = await c.getPatientRecords.staticCall(patientAddress, "");
  return records.map(r => ({
    ipfsHash: r.ipfsHash,
    issuedByDoctor: r.issuedByDoctor,
    issuedByLab: r.issuedByLab,
    timestamp: r.timestamp,
  }));
}

/**
 * Upload a record CID to the blockchain, signed by the doctor's wallet.
 * @caller  BACKEND — called from routes/records.js (POST /) on behalf of a DOCTOR.
 *          The doctor's private key is provided by the HTTP request body and is
 *          passed directly to this function. It is used ONLY to construct an
 *          ephemeral ethers.Wallet for signing the transaction. It is NEVER
 *          stored, logged, or returned — even on error.
 *
 * @param {string} patientAddress   - Patient Ethereum address
 * @param {string} cid              - IPFS CID
 * @param {string} doctorPrivateKey - Doctor's wallet private key (ephemeral, in-memory only)
 * @returns {Promise<string>} Transaction hash
 */
async function uploadRecordOnChain(patientAddress, cid, doctorPrivateKey) {
  const p = getProvider();

  // Create an ephemeral wallet — key exists only for the duration of this function.
  // ⚠️  Do NOT log doctorPrivateKey or the wallet's private key under any circumstance.
  const doctorWallet = new ethers.Wallet(doctorPrivateKey, p);
  const doctorContract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS,
    contractABI,
    doctorWallet
  );

  const tx = await doctorContract.uploadRecord(patientAddress, cid);
  const receipt = await tx.wait();
  return receipt.hash;
}

// ─────────────────────────────────────────────
//  Hospital Operations
// ─────────────────────────────────────────────

/**
 * Add a new hospital to the blockchain.
 * @caller  BACKEND — called from routes/hospitals.js on behalf of the SuperAdmin.
 *          Only the SuperAdmin (deployer) can successfully call this.
 *
 * @param {string} hospitalAddress - Hospital Ethereum address to add
 * @returns {Promise<string>} Transaction hash
 */
async function addHospitalOnChain(hospitalAddress) {
  const c = getContract(); // uses serverWallet (SuperAdmin)
  const tx = await c.addHospital(hospitalAddress);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Check if a hospital is valid (approved) on the blockchain.
 * @caller  BACKEND — utility.
 *
 * @param {string} hospitalAddress - Hospital Ethereum address
 * @returns {Promise<boolean>}
 */
async function isHospitalValid(hospitalAddress) {
  const c = getContract();
  return await c.validHospitals(hospitalAddress);
}

/**
 * Authorize a doctor to upload records under a specific hospital.
 * @caller  BACKEND — called from routes/hospitals.js on behalf of a HOSPITAL.
 *          The hospital's private key is provided ephemerally to sign.
 *
 * @param {string} doctorAddress      - Doctor Ethereum address to authorize
 * @param {string} hospitalPrivateKey - Hospital's wallet pk (ephemeral, in-memory only)
 * @returns {Promise<string>} Transaction hash
 */
async function authorizeDoctorOnChain(doctorAddress, hospitalPrivateKey) {
  const p = getProvider();

  // Ephemeral wallet for the hospital
  const hospitalWallet = new ethers.Wallet(hospitalPrivateKey, p);
  const hospitalContract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS,
    contractABI,
    hospitalWallet
  );

  const tx = await hospitalContract.authorizeDoctor(doctorAddress);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Get the hospital address associated with a doctor.
 * @caller  BACKEND — utility/UI check.
 *
 * @param {string} doctorAddress - Doctor Ethereum address
 * @returns {Promise<string>} Hospital address (0x0... if none)
 */
async function getDoctorHospital(doctorAddress) {
  const c = getContract();
  return await c.doctorToHospital(doctorAddress);
}

// ─────────────────────────────────────────────
//  Diagnostics Lab Operations
// ─────────────────────────────────────────────

/**
 * Authorize a diagnostics lab under a specific hospital.
 * @param {string} labAddress          - Lab Ethereum address to authorize
 * @param {string} hospitalPrivateKey  - Hospital's wallet pk (ephemeral, in-memory only)
 * @returns {Promise<string>} Transaction hash
 */
async function authorizeDiagnosticsLabOnChain(labAddress, hospitalPrivateKey) {
  const p = getProvider();
  const hospitalWallet = new ethers.Wallet(hospitalPrivateKey, p);
  const hospitalContract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS,
    contractABI,
    hospitalWallet
  );

  const tx = await hospitalContract.authorizeDiagnosticsLab(labAddress);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Get the hospital address associated with a diagnostics lab.
 * @param {string} labAddress - Lab Ethereum address
 * @returns {Promise<string>} Hospital address (0x0... if none)
 */
async function getDiagnosticsLabHospital(labAddress) {
  const c = getContract();
  return await c.diagnosticsLabToHospital(labAddress);
}

// ─────────────────────────────────────────────
//  Removal / Unauthorize Operations
// ─────────────────────────────────────────────

/**
 * Remove a hospital from the blockchain registry.
 * @caller  BACKEND — called from routes/hospitals.js on behalf of SuperAdmin.
 *          Only the SuperAdmin (deployer) can successfully call this.
 *
 * @param {string} hospitalAddress - Hospital Ethereum address to remove
 * @returns {Promise<string>} Transaction hash
 */
async function removeHospitalOnChain(hospitalAddress) {
  const c = getContract(); // uses serverWallet (SuperAdmin)
  const tx = await c.removeHospital(hospitalAddress);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Unauthorize a doctor on the blockchain.
 * @caller  BACKEND — called from routes/hospitals.js on behalf of a HOSPITAL.
 *          The hospital's private key is provided ephemerally to sign.
 *
 * @param {string} doctorAddress      - Doctor Ethereum address to unauthorize
 * @param {string} hospitalPrivateKey - Hospital's wallet pk (ephemeral, in-memory only)
 * @returns {Promise<string>} Transaction hash
 */
async function unauthorizeDoctorOnChain(doctorAddress, hospitalPrivateKey) {
  const p = getProvider();
  const hospitalWallet = new ethers.Wallet(hospitalPrivateKey, p);
  const hospitalContract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS,
    contractABI,
    hospitalWallet
  );

  const tx = await hospitalContract.unauthorizeDoctor(doctorAddress);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Unauthorize a diagnostics lab on the blockchain.
 * @caller  BACKEND — called from routes/hospitals.js on behalf of a HOSPITAL.
 *
 * @param {string} labAddress          - Lab Ethereum address to unauthorize
 * @param {string} hospitalPrivateKey  - Hospital's wallet pk (ephemeral, in-memory only)
 * @returns {Promise<string>} Transaction hash
 */
async function unauthorizeDiagnosticsLabOnChain(labAddress, hospitalPrivateKey) {
  const p = getProvider();
  const hospitalWallet = new ethers.Wallet(hospitalPrivateKey, p);
  const hospitalContract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS,
    contractABI,
    hospitalWallet
  );

  const tx = await hospitalContract.unauthorizeDiagnosticsLab(labAddress);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Upload a record CID to the blockchain, signed by the diagnostics lab's wallet.
 * @param {string} patientAddress - Patient Ethereum address
 * @param {string} cid            - IPFS CID
 * @param {string} labPrivateKey  - Lab's wallet private key (ephemeral, in-memory only)
 * @returns {Promise<string>} Transaction hash
 */
async function uploadRecordLabOnChain(patientAddress, cid, labPrivateKey) {
  const p = getProvider();
  const labWallet = new ethers.Wallet(labPrivateKey, p);
  const labContract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS,
    contractABI,
    labWallet
  );

  const tx = await labContract.uploadRecordLab(patientAddress, cid);
  const receipt = await tx.wait();
  return receipt.hash;
}

module.exports = {
  initBlockchain,
  getContract,
  getProvider,
  checkPermission,
  getAccessExpiry,
  getPatientRecordCIDs,
  uploadRecordOnChain,
  addHospitalOnChain,
  removeHospitalOnChain,
  isHospitalValid,
  authorizeDoctorOnChain,
  unauthorizeDoctorOnChain,
  getDoctorHospital,
  authorizeDiagnosticsLabOnChain,
  unauthorizeDiagnosticsLabOnChain,
  getDiagnosticsLabHospital,
  uploadRecordLabOnChain,
};

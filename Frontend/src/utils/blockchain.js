import { ethers } from "ethers";
import contractABI from "../contractABI.json";

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;

// ─── Role mapping helpers ───
const ROLE_MAP = { patient: 1, doctor: 2, diagnostics: 3 };
const ROLE_REVERSE = { 0: "none", 1: "patient", 2: "doctor", 3: "diagnostics" };

/**
 * Get a BrowserProvider (MetaMask).
 */
export function getProvider() {
  if (!window.ethereum) throw new Error("MetaMask is not installed");
  return new ethers.BrowserProvider(window.ethereum);
}

/**
 * Get a Signer for the connected wallet.
 */
export async function getSigner() {
  const provider = getProvider();
  return await provider.getSigner();
}

/**
 * Return a read-only contract instance (no signer — view calls only).
 */
export async function getReadContract() {
  const provider = getProvider();
  return new ethers.Contract(CONTRACT_ADDRESS, contractABI, provider);
}

/**
 * Return a contract instance connected to the user's MetaMask signer.
 */
export async function getWriteContract() {
  const signer = await getSigner();
  return new ethers.Contract(CONTRACT_ADDRESS, contractABI, signer);
}

// ─────────────────────────────────────────────
//  User Identity (replaces MySQL users table)
// ─────────────────────────────────────────────

/**
 * Register a new user on-chain. MetaMask signs the tx.
 * @param {string} role       - 'patient', 'doctor', or 'diagnostics'
 * @param {string} naclPubKey - Base64 NaCl public key
 * @param {string} encPrivKey - Hex encrypted NaCl private key
 * @param {string} metadata   - "iv|authTag" packed string
 */
export async function registerUserOnChain(role, naclPubKey, encPrivKey, metadata) {
  const roleId = ROLE_MAP[role];
  if (!roleId) throw new Error(`Invalid role: ${role}`);
  const contract = await getWriteContract();
  const tx = await contract.registerUser(roleId, naclPubKey, encPrivKey, metadata);
  return tx.wait();
}

/**
 * Get full user profile from the blockchain.
 * @param {string} address - Ethereum address
 * @returns {{ role, naclPublicKey, encryptedPrivateKey, metadata }}
 */
export async function getUserOnChain(address) {
  const contract = await getReadContract();
  const [roleId, naclPublicKey, encryptedPrivateKey, metadata] =
    await contract.getUser(address);
  return {
    role: ROLE_REVERSE[Number(roleId)] || "none",
    naclPublicKey,
    encryptedPrivateKey,
    metadata, // "iv|authTag"
  };
}

/**
 * Get only the NaCl public key for an address.
 */
export async function getUserPublicKeyOnChain(address) {
  const contract = await getReadContract();
  return await contract.getUserPublicKey(address);
}

/**
 * Check if an address is registered on-chain.
 */
export async function isUserRegisteredOnChain(address) {
  const contract = await getReadContract();
  return await contract.isRegistered(address);
}

// ─────────────────────────────────────────────
//  Access Control
// ─────────────────────────────────────────────

/**
 * Patient grants access to a doctor for a specific operation.
 * Prompts MetaMask to sign the tx.
 */
export async function grantAccessOnChain(
  doctorAddress,
  operation,
  purpose,
  durationSeconds,
) {
  const contract = await getWriteContract();
  const tx = await contract.grantAccess(
    doctorAddress,
    operation,
    purpose,
    durationSeconds,
  );
  return tx.wait();
}

/**
 * Patient revokes a doctor's access for a specific operation.
 */
export async function revokeAccessOnChain(doctorAddress, operation) {
  const contract = await getWriteContract();
  const tx = await contract.revokeAccess(doctorAddress, operation);
  return tx.wait();
}

/**
 * Doctor uploads a record on-chain. MetaMask signs the tx.
 */
export async function addRecordOnChain(patientAddress, cid) {
  const contract = await getWriteContract();
  const tx = await contract.uploadRecord(patientAddress, cid);
  return tx.wait();
}

/**
 * Get the SuperAdmin address from the smart contract.
 */
export async function getSuperAdmin() {
  const contract = await getReadContract();
  return contract.superAdmin();
}

/**
 * Check if an address is a validated hospital on-chain.
 */
export async function isHospitalValidOnChain(address) {
  const contract = await getReadContract();
  return contract.validHospitals(address);
}

// check permissions for doctor for a specific operation
export async function checkDoctorPermissionOnChain(
  patientAddress,
  doctorAddress,
  operation,
) {
  const contract = await getReadContract();
  return contract.checkPermission(patientAddress, doctorAddress, operation);
}

/**
 * Hospital authorizes a doctor on-chain. MetaMask signs the tx.
 */
export async function authorizeDoctorOnChain(doctorAddress) {
  const contract = await getWriteContract();
  const tx = await contract.authorizeDoctor(doctorAddress);
  return tx.wait();
}

/**
 * Hospital authorizes a diagnostics lab on-chain. MetaMask signs the tx.
 */
export async function authorizeDiagnosticsLabOnChain(labAddress) {
  const contract = await getWriteContract();
  const tx = await contract.authorizeDiagnosticsLab(labAddress);
  return tx.wait();
}

/**
 * Diagnostics lab uploads a record on-chain. MetaMask signs the tx.
 */
export async function addRecordLabOnChain(patientAddress, cid) {
  const contract = await getWriteContract();
  const tx = await contract.uploadRecordLab(patientAddress, cid);
  return tx.wait();
}

/**
 * SuperAdmin removes a hospital on-chain. MetaMask signs the tx.
 */
export async function removeHospitalOnChain(hospitalAddress) {
  const contract = await getWriteContract();
  const tx = await contract.removeHospital(hospitalAddress);
  return tx.wait();
}

/**
 * Hospital unauthorizes a doctor on-chain. MetaMask signs the tx.
 */
export async function unauthorizeDoctorOnChain(doctorAddress) {
  const contract = await getWriteContract();
  const tx = await contract.unauthorizeDoctor(doctorAddress);
  return tx.wait();
}

/**
 * Hospital unauthorizes a diagnostics lab on-chain. MetaMask signs the tx.
 */
export async function unauthorizeDiagnosticsLabOnChain(labAddress) {
  const contract = await getWriteContract();
  const tx = await contract.unauthorizeDiagnosticsLab(labAddress);
  return tx.wait();
}

// get the hospital address associated with a doctor
export async function getDoctorHospital(doctorAddress) {
  const c = await getReadContract();
  return await c.doctorToHospital(doctorAddress);
}

//get the hospital address associated with a diagnostics lab
export async function getDiagnosticsLabHospital(labAddress) {
  const c = await getReadContract();
  return await c.diagnosticsLabToHospital(labAddress);
}

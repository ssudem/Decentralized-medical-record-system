import { ethers } from "ethers";
import contractABI from "../contractABI.json";

const CONTRACT_ADDRESS = "0x68B52e168a307991abe5F743CC4F5A050C3AD6dA";

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

/* ─── Smart-contract helper wrappers ─── */

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

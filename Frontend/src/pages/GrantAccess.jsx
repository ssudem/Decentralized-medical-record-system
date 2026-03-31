import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import API from "../api/axios";
import {
  grantAccessOnChain,
  checkDoctorPermissionOnChain,
} from "../utils/blockchain";
import { Card, Button, Input, Spinner, Toast } from "../components/UI";
import { Shield, ArrowLeft, Clock, Search, UserCheck } from "lucide-react";
import OPERATIONS from "../constants/operations";
import {
  decryptAESKeyWithNaCl,
  encryptAESKeyWithNaCl,
} from "../utils/naclCrypto";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

export default function GrantAccess() {
  const { walletAddress, naclPrivateKey } = useAuth();
  const navigate = useNavigate();

  const [toast, setToast] = useState(null);
  const [doctorAddress, setDoctorAddress] = useState("");
  const [operation, setOperation] = useState("");
  const [hours, setHours] = useState("1");
  const [loading, setLoading] = useState(false);

  // Patient records (to select which ones to grant access to)
  const [records, setRecords] = useState([]);
  const [recLoading, setRecLoading] = useState(false);
  const [selectedCIDs, setSelectedCIDs] = useState([]);

  /* ── Fetch patient's records ── */
  const fetchMyRecords = async () => {
    if (!walletAddress || !naclPrivateKey) return;
    setRecLoading(true);
    try {
      const { data } = await API.post("/records/view", {
        patientAddress: walletAddress,
        userAddress: walletAddress,
        operation: operation || "*",
      });
      setRecords(data.records || []);
    } catch (err) {
      setToast({
        message: err.response?.data?.error || "Failed to fetch records",
        type: "error",
      });
    } finally {
      setRecLoading(false);
    }
  };

  useEffect(() => {
    if (walletAddress && naclPrivateKey) fetchMyRecords();
  }, [walletAddress, operation]);

  const toggleCID = (cid) =>
    setSelectedCIDs((prev) =>
      prev.includes(cid) ? prev.filter((c) => c !== cid) : [...prev, cid],
    );

  /* ── Grant Access ── */
  const handleGrant = async (e) => {
    e.preventDefault();
    if (!doctorAddress || !operation || selectedCIDs.length === 0) {
      setToast({
        message: "Select doctor, operation, and at least one record",
        type: "error",
      });
      return;
    }
    if (!naclPrivateKey) {
      setToast({
        message: "Encryption keys not available. Re-login.",
        type: "error",
      });
      return;
    }

    setLoading(true);
    try {
      // 0. check if permission exists on-chain before trying to revoke
      const permission_exists = await checkDoctorPermissionOnChain(
        walletAddress,
        doctorAddress,
        operation,
      );

      if (permission_exists) {
        setToast({
          message: "Access already granted to this doctor for this operation",
          type: "error",
        });
        return;
      }
      // 1. Fetch doctor's NaCl public key
      setToast({ message: "Fetching doctor encryption key…", type: "info" });
      const { data: pkData } = await API.get(
        `/auth/public-key/${doctorAddress}`,
      );
      const doctorNaClPubKey = pkData.user.naclPublicKey;

      if (!doctorNaClPubKey) {
        throw new Error("Doctor has no NaCl public key registered");
      }

      // 2. Grant on-chain access (MetaMask popup)
      setToast({
        message: "Confirm blockchain transaction in MetaMask…",
        type: "info",
      });
      const durationSeconds = parseInt(hours) * 3600;
      await grantAccessOnChain(
        doctorAddress,
        operation,
        `Manual grant: ${operation}`,
        durationSeconds,
      );

      // 3. For each selected CID: decrypt AES key, then re-encrypt for doctor
      setToast({ message: "Re-encrypting keys for doctor…", type: "info" });

      for (const cid of selectedCIDs) {
        const rec = records.find((r) => r.cid === cid);
        if (!rec) continue;

        let aesKeyBytes;

        // Decrypt AES key with NaCl private key
        if (
          naclPrivateKey &&
          rec.encryptedAESKey &&
          rec.nonce &&
          rec.senderPublicKey
        ) {
          aesKeyBytes = decryptAESKeyWithNaCl(
            rec.encryptedAESKey,
            rec.nonce,
            rec.senderPublicKey,
            naclPrivateKey,
          );
        }

        if (!aesKeyBytes) {
          console.warn(`Could not decrypt AES key for CID ${cid}`);
          continue;
        }

        // Re-encrypt the AES key for the doctor using patient's NaCl private key
        const { encryptedKey, nonce: encNonce } = encryptAESKeyWithNaCl(
          aesKeyBytes,
          doctorNaClPubKey,
          naclPrivateKey,
        );

        // Derive patient's NaCl public key from private key
        const patientSecKey = naclUtil.decodeBase64(naclPrivateKey);
        const patientPubKey = naclUtil.encodeBase64(
          nacl.box.keyPair.fromSecretKey(patientSecKey).publicKey,
        );

        // Send pre-encrypted key to backend (no plaintext AES key ever sent)
        await API.post("/access/grant", {
          cid,
          patientAddress: walletAddress,
          doctorAddress,
          encryptedAESKey: encryptedKey,
          nonce: encNonce,
          senderNaClPublicKey: patientPubKey,
          operation,
        });
      }

      setToast({
        message: `Access granted to ${doctorAddress.slice(0, 8)}… for ${hours}h`,
        type: "success",
      });
      setDoctorAddress("");
      setSelectedCIDs([]);
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        err?.reason ||
        err?.message ||
        "Grant failed";
      setToast({ message: msg, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6 animate-fade-in">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <button
        onClick={() => navigate("/patient")}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div>
        <h1 className="text-3xl font-bold bg-linear-to-r from-primary to-accent bg-clip-text text-transparent">
          Grant Record Access
        </h1>
        <p className="text-text-secondary text-sm mt-1">
          Share your medical records with a doctor for a limited time
        </p>
      </div>

      <form onSubmit={handleGrant} className="space-y-6">
        {/* Doctor */}
        <Card>
          <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-primary" /> Doctor Details
          </h2>
          <div className="space-y-4">
            <Input
              id="ga-doc"
              label="Doctor Ethereum Address"
              placeholder="0x…"
              value={doctorAddress}
              onChange={(e) => setDoctorAddress(e.target.value)}
              required
            />

            <div>
              <label
                htmlFor="ga-op"
                className="block text-sm font-medium text-text-secondary mb-1.5"
              >
                Operation
              </label>
              <select
                id="ga-op"
                value={operation}
                onChange={(e) => setOperation(e.target.value)}
                required
                className="w-full px-4 py-2.5 rounded-xl bg-surface-input border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="" disabled>
                  Select operation…
                </option>
                {OPERATIONS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-text-secondary mb-1.5 flex items-center gap-1.5">
                <Clock className="w-4 h-4" /> Access Duration (hours)
              </label>
              <Input
                id="ga-hours"
                type="number"
                min="1"
                max="168"
                placeholder="1"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                required
              />
            </div>
          </div>
        </Card>

        {/* Records */}
        <Card>
          <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-accent" /> Select Records
          </h2>

          {recLoading ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : records.length === 0 ? (
            <p className="text-text-muted text-sm text-center py-4">
              No records found for this operation.
            </p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {records.map((rec) => (
                <label
                  key={rec.cid}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors
                    ${selectedCIDs.includes(rec.cid) ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedCIDs.includes(rec.cid)}
                    onChange={() => toggleCID(rec.cid)}
                    className="rounded text-primary"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-mono text-text-secondary break-all">
                      {rec.cid}
                    </span>
                    {rec.metadata?.recordType && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-accent/10 text-accent text-xs">
                        {rec.metadata.recordType}
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
        </Card>

        <Button type="submit" loading={loading} className="w-full">
          <Shield className="w-4 h-4" />
          Grant Access ({selectedCIDs.length} record
          {selectedCIDs.length !== 1 ? "s" : ""})
        </Button>
      </form>
    </div>
  );
}

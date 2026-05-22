import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import API from "../api/axios";
import {
  revokeAccessOnChain,
  checkDoctorPermissionOnChain,
} from "../utils/blockchain";
import { Card, Button, Input, Toast } from "../components/UI";
import UserAddressInput from "../components/UserAddressInput";
import { ShieldOff, ArrowLeft } from "lucide-react";
import OPERATIONS from "../constants/operations";

export default function RevokeAccess() {
  const { walletAddress } = useAuth();
  const navigate = useNavigate();

  const [toast, setToast] = useState(null);
  const [revokeForm, setRevokeForm] = useState({
    doctorAddress: "",
    operation: "",
  });
  const [revokeLoading, setRevokeLoading] = useState(false);

  /* ── Revoke Access ── */
  const handleRevoke = async (e) => {
    e.preventDefault();
    setRevokeLoading(true);
    try {
      // 0. Resolve Registered name if needed
      const resolvedDoctor = revokeForm.doctorAddress;

      // 1. check if permission exists on-chain before trying to revoke
      const permission_exists = await checkDoctorPermissionOnChain(
        walletAddress,
        resolvedDoctor,
        revokeForm.operation,
      );

      if (!permission_exists) {
        setToast({
          message: "Doctor already does not have access to this operation",
          type: "error",
          duration: 100000,
        });
        return;
      }
      // 2. Revoke on-chain (MetaMask popup)
      setToast({
        message: "Confirm revoke in MetaMask…",
        type: "info",
        duration: 100000,
      });

      await revokeAccessOnChain(resolvedDoctor, revokeForm.operation);

      // 3. Remove off-chain encrypted keys from DB
      setToast({
        message: "Removing off-chain encrypted keys from SQL-DB...",
        type: "info",
        duration: 100000,
      });
      const { data } = await API.post("/records/view", {
        patientAddress: walletAddress,
        userAddress: walletAddress,
        operation: revokeForm.operation,
      });
      for (const rec of data.records) {
        try {
          await API.post("/access/revoke", {
            cid: rec.cid,
            doctorAddress: resolvedDoctor,
          });
        } catch {
          /* skip */
        }
      }

      setToast({
        message: "Access revoked successfully!",
        type: "success",
        duration: 100000,
      });
      // Reset form after brief delay to ensure toast displays
      setTimeout(() => {
        setRevokeForm({ doctorAddress: "", operation: "" });
      }, 100);
    } catch (err) {
      setToast({
        message: err.message || "Revoke failed",
        type: "error",
        duration: 100000,
      });
    } finally {
      setRevokeLoading(false);
    }
  };

  const setR = (key) => (e) =>
    setRevokeForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6 animate-fade-in">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <button
        onClick={() => navigate("/patient")}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div>
        <h1 className="text-3xl font-bold bg-linear-to-r from-danger to-warning bg-clip-text text-transparent">
          Revoke Access
        </h1>
        <p className="text-text-secondary text-sm mt-1">
          Remove a doctor's access to your medical records
        </p>
      </div>

      <Card>
        <form onSubmit={handleRevoke} className="grid gap-4 md:grid-cols-2">
          <UserAddressInput
            id="r-doctor"
            label="Doctor Address or Registered name"
            placeholder="0x… or doctor.eth"
            value={revokeForm.doctorAddress}
            onChange={setR("doctorAddress")}
            searchRole="doctor"
            required
          />
          <div>
            <label
              htmlFor="r-op"
              className="block text-sm font-medium text-text-secondary mb-1.5"
            >
              Operation
            </label>
            <select
              id="r-op"
              value={revokeForm.operation}
              onChange={setR("operation")}
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
          <div className="md:col-span-2">
            <Button
              type="submit"
              variant="danger"
              loading={revokeLoading}
              onClick={() => setToast(false)}
              className="w-full"
            >
              <ShieldOff className="w-4 h-4" /> Revoke Access
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import API from "../api/axios";
import { Card, Button, Input, Toast } from "../components/UI";
import UserAddressInput from "../components/UserAddressInput";
import { SendHorizonal, Mail, ArrowLeft } from "lucide-react";
import OPERATIONS from "../constants/operations";
import { checkDoctorPermissionOnChain } from "../utils/blockchain";
import useDoctorAuth from "../utils/useDoctorAuth";
import { X } from "lucide-react";

export default function RequestAccess() {
  const { walletAddress } = useAuth();
  const navigate = useNavigate();
  const { isAuthorized, loading: authLoading } = useDoctorAuth(walletAddress);

  const [toast, setToast] = useState(null);
  const [reqForm, setReqForm] = useState({
    patientAddress: "",
    operation: "",
    purpose: "",
  });
  const [reqLoading, setReqLoading] = useState(false);
  const setReq = (key) => (e) =>
    setReqForm((f) => ({ ...f, [key]: e.target.value }));

  const handleRequestAccess = async (e) => {
    e.preventDefault();
    setReqLoading(true);
    try {
      // Resolve Registered name if needed
      const resolvedPatient = reqForm.patientAddress;

      const permission_exists = await checkDoctorPermissionOnChain(
        resolvedPatient,
        walletAddress,
        reqForm.operation,
      );

      if (permission_exists) {
        setToast({
          message: "Doctor already has access to this operation",
          type: "success",
        });
        return;
      }
      await API.post("/requests", {
        patientAddress: resolvedPatient,
        doctorAddress: walletAddress,
        operation: reqForm.operation,
        purpose: reqForm.purpose,
      });
      setToast({ message: "Access request sent to patient!", type: "success" });
      setReqForm({ patientAddress: "", operation: "", purpose: "" });
    } catch (err) {
      setToast({
        message: err.response?.data?.error || "Failed to send request",
        type: "error",
      });
    } finally {
      setReqLoading(false);
    }
  };

  if (authLoading) return null;

  if (!isAuthorized) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 bg-warning/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <X className="w-8 h-8 text-warning" />
        </div>
        <h2 className="text-2xl font-bold text-text-primary mb-2">Unauthorized</h2>
        <p className="text-text-secondary mb-6">
          You are not currently linked to a valid hospital. You must be authorized by a valid hospital to request access to records.
        </p>
        <Button onClick={() => navigate("/doctor")}>
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6 animate-fade-in">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <button
        onClick={() => navigate("/doctor")}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-warning to-accent bg-clip-text text-transparent">
          Request Access from Patient
        </h1>
        <p className="text-text-secondary text-sm mt-1">
          Send an access request to a patient. They can approve it from their
          dashboard.
        </p>
      </div>

      <Card>
        <form
          onSubmit={handleRequestAccess}
          className="grid gap-4 md:grid-cols-2"
        >
          <UserAddressInput
            id="req-paddr"
            label="Patient Address or Registered name"
            placeholder="0x… or patient.eth"
            value={reqForm.patientAddress}
            onChange={setReq("patientAddress")}
            searchRole="patient"
            required
          />
          <div>
            <label
              htmlFor="req-op"
              className="block text-sm font-medium text-text-secondary mb-1.5"
            >
              Operation
            </label>
            <select
              id="req-op"
              value={reqForm.operation}
              onChange={setReq("operation")}
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
          <Input
            id="req-purpose"
            label="Purpose"
            placeholder="Routine diabetes follow-up"
            value={reqForm.purpose}
            onChange={setReq("purpose")}
            required
            className="md:col-span-2"
          />
          <div className="md:col-span-2">
            <Button type="submit" loading={reqLoading}>
              <SendHorizonal className="w-4 h-4" /> Send Request
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}


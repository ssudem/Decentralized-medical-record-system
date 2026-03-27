import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  authorizeDoctorOnChain,
  authorizeDiagnosticsLabOnChain,
  unauthorizeDoctorOnChain as unauthorizeDoctorOnChainFn,
  unauthorizeDiagnosticsLabOnChain as unauthorizeLabOnChainFn,
} from "../utils/blockchain";
import API from "../api/axios";
import { Card, Button, Input, Toast } from "../components/UI";
import { UserCheck, Building2, Search, ShieldCheck, FlaskConical, Trash2, UserX } from "lucide-react";

export default function HospitalPanel() {
  const { walletAddress, isHospitalAdmin } = useAuth();
  const [toast, setToast] = useState(null);

  // ── Authorize Doctor ──
  const [doctorAddr, setDoctorAddr] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // ── Remove Doctor ──
  const [removeDoctorAddr, setRemoveDoctorAddr] = useState("");
  const [removeDoctorLoading, setRemoveDoctorLoading] = useState(false);

  // ── Authorize Diagnostics Lab ──
  const [labAddr, setLabAddr] = useState("");
  const [labAuthLoading, setLabAuthLoading] = useState(false);

  // ── Remove Diagnostics Lab ──
  const [removeLabAddr, setRemoveLabAddr] = useState("");
  const [removeLabLoading, setRemoveLabLoading] = useState(false);

  // ── Status Check ──
  const [checkAddr, setCheckAddr] = useState("");
  const [checkResult, setCheckResult] = useState(null);
  const [checkLoading, setCheckLoading] = useState(false);

  // ── Check Diagnostics Lab Status ──
  const [checkLabAddr, setCheckLabAddr] = useState("");
  const [checkLabResult, setCheckLabResult] = useState(null);
  const [checkLabLoading, setCheckLabLoading] = useState(false);

  /* ── Authorize Doctor via MetaMask ── */
  const handleAuthorize = async (e) => {
    e.preventDefault();
    if (!doctorAddr) return;
    setAuthLoading(true);
    try {
      setToast({ message: "Confirm the transaction in MetaMask…", type: "info" });
      await authorizeDoctorOnChain(doctorAddr);
      setToast({ message: `Doctor ${doctorAddr.slice(0, 8)}… authorized!`, type: "success" });
      setDoctorAddr("");
    } catch (err) {
      setToast({ message: err?.reason || err?.message || "Authorization failed", type: "error" });
    } finally {
      setAuthLoading(false);
    }
  };

  /* ── Remove Doctor via MetaMask ── */
  const handleRemoveDoctor = async (e) => {
    e.preventDefault();
    if (!removeDoctorAddr) return;
    setRemoveDoctorLoading(true);
    try {
      setToast({ message: "Confirm the transaction in MetaMask…", type: "info" });
      await unauthorizeDoctorOnChainFn(removeDoctorAddr);
      setToast({ message: `Doctor ${removeDoctorAddr.slice(0, 8)}… removed!`, type: "success" });
      setRemoveDoctorAddr("");
    } catch (err) {
      setToast({ message: err?.reason || err?.message || "Failed to remove doctor", type: "error" });
    } finally {
      setRemoveDoctorLoading(false);
    }
  };

  /* ── Authorize Diagnostics Lab via MetaMask ── */
  const handleAuthorizeLab = async (e) => {
    e.preventDefault();
    if (!labAddr) return;
    setLabAuthLoading(true);
    try {
      setToast({ message: "Confirm the transaction in MetaMask…", type: "info" });
      await authorizeDiagnosticsLabOnChain(labAddr);
      setToast({ message: `Lab ${labAddr.slice(0, 8)}… authorized!`, type: "success" });
      setLabAddr("");
    } catch (err) {
      setToast({ message: err?.reason || err?.message || "Authorization failed", type: "error" });
    } finally {
      setLabAuthLoading(false);
    }
  };

  /* ── Remove Diagnostics Lab via MetaMask ── */
  const handleRemoveLab = async (e) => {
    e.preventDefault();
    if (!removeLabAddr) return;
    setRemoveLabLoading(true);
    try {
      setToast({ message: "Confirm the transaction in MetaMask…", type: "info" });
      await unauthorizeLabOnChainFn(removeLabAddr);
      setToast({ message: `Lab ${removeLabAddr.slice(0, 8)}… removed!`, type: "success" });
      setRemoveLabAddr("");
    } catch (err) {
      setToast({ message: err?.reason || err?.message || "Failed to remove diagnostics lab", type: "error" });
    } finally {
      setRemoveLabLoading(false);
    }
  };

  /* ── Check if a doctor is linked ── */
  const handleCheckDoctor = async () => {
    if (!checkAddr) return;
    setCheckLoading(true);
    setCheckResult(null);
    try {
      const { data } = await API.get(`/hospitals/doctor/${checkAddr}`);
      const isLinked = data.hospitalAddress && data.hospitalAddress !== "0x0000000000000000000000000000000000000000";
      setCheckResult({ ...data, isLinked });
    } catch {
      setToast({ message: "Lookup failed", type: "error" });
    } finally {
      setCheckLoading(false);
    }
  };

  /* ── Check if a diagnostics lab is linked ── */
  const handleCheckLab = async () => {
    if (!checkLabAddr) return;
    setCheckLabLoading(true);
    setCheckLabResult(null);
    try {
      const { data } = await API.get(`/hospitals/diagnostics-lab/${checkLabAddr}`);
      const isLinked = data.hospitalAddress && data.hospitalAddress !== "0x0000000000000000000000000000000000000000";
      setCheckLabResult({ ...data, isLinked });
    } catch {
      setToast({ message: "Lab lookup failed", type: "error" });
    } finally {
      setCheckLabLoading(false);
    }
  };
  if (!isHospitalAdmin) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 text-center animate-fade-in flex flex-col items-center justify-center min-h-[60vh]">
        <Building2 className="w-16 h-16 text-danger mb-4 opacity-80" />
        <h1 className="text-3xl font-bold text-danger mb-2">Access Denied</h1>
        <p className="text-text-secondary">
          The connected wallet (<span className="font-mono text-xs">{walletAddress || "None"}</span>) is not registered as a hospital.
        </p>
        <p className="text-text-secondary mt-2">
          Please switch to an authorized hospital wallet in MetaMask to view this dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8 animate-fade-in">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <div>
        <h1 className="text-3xl font-bold bg-linear-to-r from-primary to-accent bg-clip-text text-transparent">
          Hospital Admin
        </h1>
        <p className="text-text-secondary text-sm mt-1 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-success" />
          Hospital wallet:{" "}
          <span className="font-mono text-xs text-primary">{walletAddress || "Not connected"}</span>
        </p>
      </div>

      {/* ── Authorize Doctor ── */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-success" /> Authorize Doctor
        </h2>
        <Card>
          <form onSubmit={handleAuthorize} className="flex gap-3 items-end">
            <Input id="auth-doc" label="Doctor Ethereum Address" placeholder="0x…"
              value={doctorAddr} onChange={(e) => setDoctorAddr(e.target.value)} required className="flex-1" />
            <Button type="submit" loading={authLoading}>
              <UserCheck className="w-4 h-4" /> Authorize
            </Button>
          </form>
          <p className="text-xs text-text-muted mt-3">MetaMask will prompt you to sign the on-chain transaction.</p>
        </Card>
      </section>

      {/* ── Remove Doctor ── */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <UserX className="w-5 h-5 text-danger" /> Remove Doctor
        </h2>
        <Card>
          <form onSubmit={handleRemoveDoctor} className="flex gap-3 items-end">
            <Input id="remove-doc" label="Doctor Ethereum Address" placeholder="0x…"
              value={removeDoctorAddr} onChange={(e) => setRemoveDoctorAddr(e.target.value)} required className="flex-1" />
            <Button type="submit" loading={removeDoctorLoading} variant="danger">
              <Trash2 className="w-4 h-4" /> Remove
            </Button>
          </form>
          <p className="text-xs text-text-muted mt-3">
            ⚠️ Only doctors authorized by your hospital can be removed. MetaMask will prompt you.
          </p>
        </Card>
      </section>

      {/* ── Authorize Diagnostics Lab ── */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-accent" /> Authorize Diagnostics Lab
        </h2>
        <Card>
          <form onSubmit={handleAuthorizeLab} className="flex gap-3 items-end">
            <Input id="auth-lab" label="Diagnostics Lab Ethereum Address" placeholder="0x…"
              value={labAddr} onChange={(e) => setLabAddr(e.target.value)} required className="flex-1" />
            <Button type="submit" loading={labAuthLoading}>
              <FlaskConical className="w-4 h-4" /> Authorize
            </Button>
          </form>
          <p className="text-xs text-text-muted mt-3">
            MetaMask will prompt you to sign the on-chain transaction to authorize this diagnostics lab.
          </p>
        </Card>
      </section>

      {/* ── Remove Diagnostics Lab ── */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Trash2 className="w-5 h-5 text-danger" /> Remove Diagnostics Lab
        </h2>
        <Card>
          <form onSubmit={handleRemoveLab} className="flex gap-3 items-end">
            <Input id="remove-lab" label="Diagnostics Lab Ethereum Address" placeholder="0x…"
              value={removeLabAddr} onChange={(e) => setRemoveLabAddr(e.target.value)} required className="flex-1" />
            <Button type="submit" loading={removeLabLoading} variant="danger">
              <Trash2 className="w-4 h-4" /> Remove
            </Button>
          </form>
          <p className="text-xs text-text-muted mt-3">
            ⚠️ Only labs authorized by your hospital can be removed. MetaMask will prompt you.
          </p>
        </Card>
      </section>

      {/* ── Check Doctor Status ── */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Search className="w-5 h-5 text-accent" /> Check Doctor Status
        </h2>
        <Card>
          <div className="flex gap-3 items-end mb-4">
            <Input id="chk-doc" label="Doctor Ethereum Address" placeholder="0x…"
              value={checkAddr} onChange={(e) => setCheckAddr(e.target.value)} className="flex-1" />
            <Button type="button" variant="secondary" onClick={handleCheckDoctor} loading={checkLoading}>
              <Search className="w-4 h-4" /> Check
            </Button>
          </div>
          {checkResult && (
            <div className={`p-3 rounded-xl border text-sm animate-fade-in ${
              checkResult.isLinked ? "bg-success/5 border-success/20 text-success" : "bg-warning/5 border-warning/20 text-warning"
            }`}>
              <ShieldCheck className="w-4 h-4 inline mr-1.5" />
              {checkResult.isLinked
                ? `✅ Doctor ${checkResult.doctorAddress} is linked to hospital ${checkResult.hospitalAddress}.`
                : `⚠️ Doctor ${checkResult.doctorAddress} is NOT linked to any hospital.`}
            </div>
          )}
        </Card>
      </section>

      {/* ── Check Diagnostics Lab Status ── */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Search className="w-5 h-5 text-accent" /> Check Diagnostics Lab Status
        </h2>
        <Card>
          <div className="flex gap-3 items-end mb-4">
            <Input id="chk-lab" label="Diagnostics Lab Ethereum Address" placeholder="0x…"
              value={checkLabAddr} onChange={(e) => setCheckLabAddr(e.target.value)} className="flex-1" />
            <Button type="button" variant="secondary" onClick={handleCheckLab} loading={checkLabLoading}>
              <Search className="w-4 h-4" /> Check
            </Button>
          </div>
          {checkLabResult && (
            <div className={`p-3 rounded-xl border text-sm animate-fade-in ${
              checkLabResult.isLinked ? "bg-success/5 border-success/20 text-success" : "bg-warning/5 border-warning/20 text-warning"
            }`}>
              <ShieldCheck className="w-4 h-4 inline mr-1.5" />
              {checkLabResult.isLinked
                ? `✅ Lab ${checkLabResult.labAddress} is linked to hospital ${checkLabResult.hospitalAddress}.`
                : `⚠️ Lab ${checkLabResult.labAddress} is NOT linked to any hospital.`}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

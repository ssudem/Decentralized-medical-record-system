import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import API from "../api/axios";
import { Card, Button, Input, Spinner, Toast } from "../components/UI";
import UserAddressInput from "../components/UserAddressInput";
import UserAddress from "../components/UserAddress";
import { Search, ClipboardList, FileText, ArrowLeft, Users, ListChecks, ChevronDown, ChevronRight, Layers } from "lucide-react";
import OPERATIONS from "../constants/operations";
import {
  decryptAESKeyWithNaCl,
  decryptRecordLocal,
  decryptPdfLocal,
} from "../utils/naclCrypto";

import { checkDoctorPermissionOnChain } from "../utils/blockchain";
import {
  loadDoctorCache,
  saveDoctorCache,
  clearDoctorCache,
  saveGrantedCache,
  loadGrantedCache,
  clearGrantedCache,
  saveViewMode,
  loadViewMode,
  savePermissionCache,
  loadPermissionCache,
} from "../utils/recordCache";

/* ── Operation icon map ── */
const OP_ICONS = {
  diabetes_check: "🩸",
  cancer_risk_analysis: "🔬",
  allergy_summary: "🤧",
  cardiac_review: "❤️",
  pulmonary_review: "🫁",
  general_checkup: "🩺",
  view_diagnostics: "📋",
};

/* ── Shared record card ── */
function RecordCard({ rec, navigate }) {
  return (
    <Card className="bg-surface hover:border-accent/30 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <span className="px-2.5 py-0.5 rounded-full bg-accent/10 text-accent text-xs font-semibold uppercase">
          {rec.metadata?.recordType || "record"}
        </span>
        <span className="text-xs text-text-muted">
          {rec.timestamp
            ? new Date(
                Number(rec.timestamp) * 1000 || rec.timestamp
              ).toLocaleDateString()
            : ""}
        </span>
      </div>
      <p className="text-sm text-text-secondary mb-1">
        <strong>CID:</strong>{" "}
        <span className="font-mono text-xs break-all">{rec.cid}</span>
      </p>

      {/* Issued By */}
      {rec.issuedByDoctor && rec.issuedByDoctor !== "0x0000000000000000000000000000000000000000" && (
        <p className="text-sm text-text-secondary mb-1">
          <strong>🩺 Doctor:</strong>{" "}
          <UserAddress address={rec.issuedByDoctor} className="text-xs" />
        </p>
      )}
      {rec.issuedByLab && rec.issuedByLab !== "0x0000000000000000000000000000000000000000" && (
        <p className="text-sm text-text-secondary mb-1">
          <strong>🔬 Lab:</strong>{" "}
          <UserAddress address={rec.issuedByLab} className="text-xs" />
        </p>
      )}
      {/* Fallback to metadata */}
      {(!rec.issuedByDoctor || rec.issuedByDoctor === "0x0000000000000000000000000000000000000000") &&
       (!rec.issuedByLab || rec.issuedByLab === "0x0000000000000000000000000000000000000000") && (
        <>
          {(rec.metadata?.doctorAddress || rec.record?.doctorAddress) && (
            <p className="text-sm text-text-secondary mb-1">
              <strong>🩺 Doctor:</strong>{" "}
              <UserAddress address={rec.metadata?.doctorAddress || rec.record?.doctorAddress} className="text-xs" />
            </p>
          )}
          {rec.metadata?.labAddress && (
            <p className="text-sm text-text-secondary mb-1">
              <strong>🔬 Lab:</strong>{" "}
              <UserAddress address={rec.metadata.labAddress} className="text-xs" />
            </p>
          )}
        </>
      )}

      {rec.metadata?.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {rec.metadata.tags.map((t) => (
            <span key={t} className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs">{t}</span>
          ))}
        </div>
      )}
      {rec.record && (
        <div className="mt-4 pt-3 border-t border-border/50">
          <Button
            variant="secondary"
            className="w-full text-xs py-2"
            onClick={() =>
              navigate(`/record/${rec.cid}`, {
                state: { recordData: rec, isDoctor: true },
              })
            }
          >
            <FileText className="w-4 h-4" /> View Full Record Details
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function ViewRecords() {
  const { walletAddress, naclPrivateKey } = useAuth();
  const navigate = useNavigate();

  const [toast, setToast] = useState(null);
  // Mode: "manual" | "granted" — restored from sessionStorage
  const [mode, setModeState] = useState(() => loadViewMode());
  const setMode = (m) => { setModeState(m); saveViewMode(m); };

  // ═══ Manual Search State ═══
  const [viewAddr, setViewAddr] = useState("");
  const [viewOp, setViewOp] = useState("");
  const [viewRecords, setViewRecords] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);
  const [fromCache, setFromCache] = useState(false);

  // ═══ All Granted State ═══
  const [grantedGroups, setGrantedGroups] = useState([]);    // new: groups with operationGroups
  const [grantedLoading, setGrantedLoading] = useState(false);
  const [expandedPatient, setExpandedPatient] = useState(null);
  const [expandedOp, setExpandedOp] = useState(null);          // "patientAddr_operation"
  const [decryptedOps, setDecryptedOps] = useState({});        // { "patientAddr_op": decryptedRecords[] }
  const [decryptingOp, setDecryptingOp] = useState(null);      // "patientAddr_op"
  const [verifiedOps, setVerifiedOps] = useState({});           // { "patientAddr_op": true/false }

  // ── Helper: decrypt an array of encrypted records in-memory ──
  const decryptAll = async (encRecords) => {
    const decryptPromises = encRecords.map(async (rec) => {
      try {
        if (!rec.encryptedAESKey || !rec.nonce || !rec.senderPublicKey) return null;

        const aesKeyBytes = decryptAESKeyWithNaCl(
          rec.encryptedAESKey, rec.nonce, rec.senderPublicKey, naclPrivateKey
        );
        const decryptedRecord = await decryptRecordLocal(
          rec.encryptedPayload.cipherText, aesKeyBytes,
          rec.encryptedPayload.iv, rec.encryptedPayload.authTag
        );

        let pdfBase64 = null;
        if (rec.encryptedPayload.pdfData && rec.encryptedPayload.pdfAuthTag) {
          try {
            pdfBase64 = await decryptPdfLocal(
              rec.encryptedPayload.pdfData, aesKeyBytes,
              rec.encryptedPayload.iv, rec.encryptedPayload.pdfAuthTag
            );
          } catch {}
        }

        return {
          cid: rec.cid,
          metadata: rec.metadata,
          record: decryptedRecord,
          pdfBase64,
          timestamp: rec.timestamp,
          issuedByDoctor: rec.issuedByDoctor,
          issuedByLab: rec.issuedByLab,
        };
      } catch {
        return null;
      }
    });
    return (await Promise.all(decryptPromises)).filter(Boolean);
  };

  // ── Restore last manual search results from session cache on mount ──
  useEffect(() => {
    if (!walletAddress || !naclPrivateKey) return;
    const autoLoad = async () => {
      try {
        const lastParams = JSON.parse(sessionStorage.getItem("doctor_view_last_params") || "null");
        if (lastParams?.addr && lastParams?.op) {
          setViewAddr(lastParams.addr);
          setViewOp(lastParams.op);
          const cached = loadDoctorCache(walletAddress, lastParams.addr, lastParams.op);
          if (cached?.length > 0) {
            setViewLoading(true);
            try {
              const ok = await checkDoctorPermissionOnChain(lastParams.addr, walletAddress, lastParams.op);
              if (!ok) {
                setToast({ message: "Cached view restricted: Access permission expired.", type: "error" });
                clearDoctorCache(lastParams.addr, walletAddress, lastParams.op);
                setViewLoading(false);
                return;
              }
            } catch {
              clearDoctorCache(lastParams.addr, walletAddress, lastParams.op);
              setViewLoading(false);
              return;
            }
            setFromCache(true);
            setToast({ message: "⚡ Decrypting cached records…", type: "info" });
            const dec = await decryptAll(cached);
            setViewRecords(dec);
            setViewLoading(false);
            setToast({ message: `⚡ ${dec.length} record(s) loaded from cache`, type: "success" });
          }
        }
      } catch { setViewLoading(false); }
    };
    autoLoad();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, naclPrivateKey]);

  // ── Restore granted-records cache on mount (blockchain validated) ──
  useEffect(() => {
    if (!walletAddress || !naclPrivateKey) return;
    const restoreGranted = async () => {
      const cachedGroups = loadGrantedCache(walletAddress);
      if (!cachedGroups || cachedGroups.length === 0) return;

      setGrantedLoading(true);
      setToast({ message: "⚡ Validating cached granted records on blockchain…", type: "info" });

      try {
        // Validate all patient×operation pairs concurrently (not sequentially)
        const groupResults = await Promise.allSettled(
          cachedGroups.map(async (group) => {
            const opResults = await Promise.allSettled(
              (group.activeOperations || []).map(async (op) => {
                const ok = await checkDoctorPermissionOnChain(
                  group.patientAddress, walletAddress, op
                );
                if (ok) savePermissionCache(walletAddress, group.patientAddress, op, true);
                else clearPermissionCache(walletAddress, group.patientAddress, op);
                return { op, ok };
              })
            );

            const validOps = opResults
              .filter(r => r.status === "fulfilled" && r.value.ok)
              .map(r => r.value.op);

            // Clear permission cache for failed checks too
            opResults
              .filter(r => r.status === "rejected")
              .forEach(() => {}); // already handled by catch in checkDoctorPermission

            if (validOps.length === 0) return null;

            const filteredOpGroups = {};
            for (const op of validOps) {
              if (group.operationGroups?.[op]) filteredOpGroups[op] = group.operationGroups[op];
            }
            return { ...group, activeOperations: validOps, operationGroups: filteredOpGroups };
          })
        );

        const validGroups = groupResults
          .filter(r => r.status === "fulfilled" && r.value !== null)
          .map(r => r.value);

        if (validGroups.length > 0) {
          setGrantedGroups(validGroups);
          saveGrantedCache(walletAddress, validGroups);
          setToast({ message: `⚡ ${validGroups.length} patient group(s) restored from cache`, type: "success" });
        } else {
          clearGrantedCache(walletAddress);
          setToast({ message: "All cached granted permissions have expired.", type: "error" });
        }
      } catch {
        clearGrantedCache(walletAddress);
        setToast({ message: "Failed to validate cached permissions.", type: "error" });
      } finally {
        setGrantedLoading(false);
      }
    };
    restoreGranted();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, naclPrivateKey]);

  /* ── Manual Search Handler ── */
  const handleView = async (e) => {
    e.preventDefault();
    setViewRecords([]);
    setFromCache(false);
    if (!naclPrivateKey) {
      setToast({ message: "Encryption keys not available. Please re-login.", type: "error" });
      return;
    }
    setViewLoading(true);
    try {
      const ok = await checkDoctorPermissionOnChain(viewAddr, walletAddress, viewOp);
      if (!ok) {
        setToast({ message: "Access denied: no active permission or permission expired", type: "error" });
        clearDoctorCache(viewAddr, walletAddress, viewOp);
        setViewLoading(false);
        return;
      }
    } catch {
      setToast({ message: "Access denied: failed to verify on-chain permission", type: "error" });
      setViewLoading(false);
      return;
    }

    const cached = loadDoctorCache(walletAddress, viewAddr, viewOp);
    if (cached?.length > 0) {
      setFromCache(true);
      setToast({ message: "⚡ Decrypting cached records…", type: "info" });
      const dec = await decryptAll(cached);
      setViewRecords(dec);
      sessionStorage.setItem("doctor_view_last_params", JSON.stringify({ addr: viewAddr, op: viewOp }));
      setToast({ message: `⚡ ${dec.length} record(s) loaded from cache`, type: "success" });
      setViewLoading(false);
      return;
    }

    try {
      setToast({ message: "Fetching relevant records and Decrypting...", type: "info" });
      const { data } = await API.post("/records/view", {
        patientAddress: viewAddr, userAddress: walletAddress, operation: viewOp,
      });
      if (!data.records?.length) {
        setToast({ message: "No matching records found", type: "info" });
        setViewLoading(false);
        return;
      }
      saveDoctorCache(walletAddress, viewAddr, viewOp, data.records);
      const decryptedRecords = await decryptAll(data.records);
      setViewRecords(decryptedRecords);
      if (decryptedRecords.length > 0) {
        sessionStorage.setItem("doctor_view_last_params", JSON.stringify({ addr: viewAddr, op: viewOp }));
        setToast({ message: `${decryptedRecords.length} record(s) decrypted — encrypted data cached`, type: "success" });
      } else {
        setToast({ message: "Could not decrypt any records. Check your access permissions.", type: "error" });
      }
    } catch (err) {
      setToast({ message: err.response?.data?.error || "Failed to fetch records", type: "error" });
    } finally {
      setViewLoading(false);
    }
  };

  /* ── All Granted Records Handler ── */
  const handleFetchGranted = async () => {
    if (!naclPrivateKey) {
      setToast({ message: "Encryption keys not available. Please re-login.", type: "error" });
      return;
    }
    setGrantedLoading(true);
    setGrantedGroups([]);
    setDecryptedOps({});
    setExpandedPatient(null);
    setExpandedOp(null);
    setVerifiedOps({});
    try {
      setToast({ message: "Scanning DB & categorizing by operation on blockchain…", type: "info" });
      const { data } = await API.get(`/records/granted/${walletAddress}`);
      if (!data.groups?.length) {
        setToast({ message: "No granted records found.", type: "info" });
        setGrantedLoading(false);
        return;
      }
      setGrantedGroups(data.groups);
      saveGrantedCache(walletAddress, data.groups);
      setToast({ message: `Found ${data.totalRecords} record(s) from ${data.totalPatients} patient(s)`, type: "success" });
    } catch (err) {
      setToast({ message: err.response?.data?.error || "Failed to fetch granted records", type: "error" });
    } finally {
      setGrantedLoading(false);
    }
  };

  /* ── Toggle patient accordion (shows operation sub-groups) ── */
  const handleExpandPatient = (patientAddr) => {
    setExpandedPatient(expandedPatient === patientAddr ? null : patientAddr);
    setExpandedOp(null); // collapse any open operation
  };

  /* ── Expand an operation: ALWAYS verify on-chain BEFORE decrypt ── */
  const handleExpandOperation = async (patientAddr, operation) => {
    const opKey = `${patientAddr}_${operation}`;
    if (expandedOp === opKey) { setExpandedOp(null); return; }
    setExpandedOp(opKey);
    if (decryptedOps[opKey]) return; // Already decrypted in this session

    const group = grantedGroups.find(g => g.patientAddress === patientAddr);
    if (!group || !group.operationGroups?.[operation]) return;

    setDecryptingOp(opKey);
    try {
      // 1. Always verify on-chain (session cache only avoids redundant calls within TTL)
      let permitted = loadPermissionCache(walletAddress, patientAddr, operation);

      if (permitted === null || permitted === true) {
        // Fresh check — don't trust stale "true" from cache after a potential revoke
        try {
          permitted = await checkDoctorPermissionOnChain(patientAddr, walletAddress, operation);
          if (permitted) {
            savePermissionCache(walletAddress, patientAddr, operation, true);
          } else {
            clearPermissionCache(walletAddress, patientAddr, operation);
          }
        } catch {
          setToast({ message: "Failed to verify on-chain permission.", type: "error" });
          setVerifiedOps(prev => ({ ...prev, [opKey]: false }));
          return;
        }
      }

      setVerifiedOps(prev => ({ ...prev, [opKey]: permitted }));

      if (!permitted) {
        clearPermissionCache(walletAddress, patientAddr, operation);
        setToast({ message: `Access denied: ${opLabel(operation)} permission expired or revoked.`, type: "error" });
        return;
      }

      // 2. Permission valid — decrypt
      const dec = await decryptAll(group.operationGroups[operation]);
      setDecryptedOps(prev => ({ ...prev, [opKey]: dec }));
      if (dec.length === 0) setToast({ message: "Could not decrypt records for this operation.", type: "error" });
    } catch {
      setToast({ message: "Decryption failed.", type: "error" });
    } finally {
      setDecryptingOp(null);
    }
  };

  // ── Operation label helper ──
  const opLabel = (val) => OPERATIONS.find(o => o.value === val)?.label || val;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6 animate-fade-in">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <button
        onClick={() => navigate("/doctor")}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div>
        <h1 className="text-3xl font-bold bg-linear-to-r from-accent to-primary bg-clip-text text-transparent">
          View Patient Records
        </h1>
        <p className="text-text-secondary text-sm mt-1">
          Search for specific records or browse all records granted to you
        </p>
      </div>

      {/* ═══ Mode Tabs ═══ */}
      <div className="flex gap-2">
        <button
          id="tab-manual-search"
          onClick={() => setMode("manual")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 cursor-pointer
            ${mode === "manual"
              ? "bg-primary text-white shadow-md shadow-primary/20"
              : "bg-surface-light text-text-secondary border border-border hover:border-primary/40"}`}
        >
          <Search className="w-4 h-4" /> Manual Search
        </button>
        <button
          id="tab-all-granted"
          onClick={() => setMode("granted")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 cursor-pointer
            ${mode === "granted"
              ? "bg-accent text-white shadow-md shadow-accent/20"
              : "bg-surface-light text-text-secondary border border-border hover:border-accent/40"}`}
        >
          <ListChecks className="w-4 h-4" /> All Granted Records
        </button>
      </div>

      {/* ═══════════ Manual Search Mode ═══════════ */}
      {mode === "manual" && (
        <Card>
          <form onSubmit={handleView} className="grid gap-4 md:grid-cols-3 mb-6">
            <UserAddressInput
              id="v-addr"
              label="Patient Address or Registered name"
              placeholder="0x… or patient name"
              value={viewAddr}
              onChange={(e) => setViewAddr(e.target.value)}
              searchRole="patient"
              required
            />
            <div>
              <label htmlFor="v-op" className="block text-sm font-medium text-text-secondary mb-1.5">
                Operation
              </label>
              <select
                id="v-op"
                value={viewOp}
                onChange={(e) => setViewOp(e.target.value)}
                required
                className="w-full px-4 py-2.5 rounded-xl bg-surface-input border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="" disabled>Select operation…</option>
                {OPERATIONS.map((op) => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center">
              <Button type="submit" variant="secondary" loading={viewLoading} className="w-full" onClick={() => setToast(false)}>
                <Search className="w-4 h-4" /> Search Records
              </Button>
            </div>
          </form>

          {viewLoading ? (
            <div className="flex justify-center py-8"><Spinner size="lg" /></div>
          ) : viewRecords.length === 0 ? (
            <div className="text-center py-8">
              <ClipboardList className="w-10 h-10 text-text-muted mx-auto mb-2" />
              <p className="text-text-secondary text-sm">Search for patient records above.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {viewRecords.map((rec) => (
                <RecordCard key={rec.cid} rec={rec} navigate={navigate} />
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ═══════════ All Granted Records Mode ═══════════ */}
      {mode === "granted" && (
        <div className="space-y-4">
          <Card className="!border-surface-input">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                  <Users className="w-5 h-5 text-accent" /> Records Granted To You
                </h2>
                <p className="text-xs text-text-secondary mt-1">
                  Shows all records from patients who have granted you active on-chain permission, validated via blockchain
                </p>
              </div>
              <Button
                id="btn-fetch-granted"
                variant="secondary"
                loading={grantedLoading}
                onClick={handleFetchGranted}
                className="shrink-0"
              >
                <ListChecks className="w-4 h-4" /> {grantedGroups.length > 0 ? "Refresh" : "Fetch All"}
              </Button>
            </div>
          </Card>

          {grantedLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Spinner size="lg" />
              <p className="text-text-secondary text-sm">Scanning DB & validating permissions on blockchain…</p>
            </div>
          ) : grantedGroups.length === 0 ? (
            <Card>
              <div className="text-center py-8">
                <Users className="w-10 h-10 text-text-muted mx-auto mb-2" />
                <p className="text-text-secondary text-sm">
                  Click "Fetch All" to scan for all records granted to you.
                </p>
              </div>
            </Card>
          ) : (
            <div className="space-y-3">
              {grantedGroups.map((group) => {
                const isPatientExpanded = expandedPatient === group.patientAddress;
                const ops = Object.keys(group.operationGroups || {});
                const totalRecs = ops.reduce((s, op) => s + (group.operationGroups[op]?.length || 0), 0);

                return (
                  <Card key={group.patientAddress} className="overflow-hidden">
                    {/* ── Patient Header ── */}
                    <button
                      onClick={() => handleExpandPatient(group.patientAddress)}
                      className="w-full flex items-center justify-between gap-3 text-left cursor-pointer group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                          <Users className="w-5 h-5 text-accent" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-text-primary group-hover:text-accent transition-colors truncate">
                            Patient: <UserAddress address={group.patientAddress} />
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                              {totalRecs} record{totalRecs !== 1 ? "s" : ""}
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xs font-medium">
                              <Layers className="w-3 h-3 inline mr-0.5" />{ops.length} operation{ops.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                        </div>
                      </div>
                      {isPatientExpanded
                        ? <ChevronDown className="w-5 h-5 text-text-muted shrink-0" />
                        : <ChevronRight className="w-5 h-5 text-text-muted shrink-0" />}
                    </button>

                    {/* ── Operation Sub-Groups ── */}
                    {isPatientExpanded && (
                      <div className="mt-4 pt-4 border-t border-border/50 space-y-2">
                        {ops.map((op) => {
                          const opKey = `${group.patientAddress}_${op}`;
                          const isOpExpanded = expandedOp === opKey;
                          const opRecsDec = decryptedOps[opKey];
                          const isOpDecrypting = decryptingOp === opKey;
                          const isVerified = verifiedOps[opKey];
                          const opRecs = group.operationGroups[op] || [];

                          return (
                            <div key={opKey} className="rounded-xl border border-border/60 overflow-hidden">
                              {/* Operation header */}
                              <button
                                onClick={() => handleExpandOperation(group.patientAddress, op)}
                                className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left cursor-pointer hover:bg-surface-light/50 transition-colors"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span className="text-lg">{OP_ICONS[op] || "📄"}</span>
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-text-primary truncate">{opLabel(op)}</p>
                                    <p className="text-xs text-text-muted">{opRecs.length} record{opRecs.length !== 1 ? "s" : ""}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {isVerified === true && (
                                    <span className="px-2 py-0.5 rounded-full bg-success/10 text-success text-xs font-medium">✓ Verified</span>
                                  )}
                                  {isVerified === false && (
                                    <span className="px-2 py-0.5 rounded-full bg-error/10 text-error text-xs font-medium">✗ Expired</span>
                                  )}
                                  {isOpExpanded
                                    ? <ChevronDown className="w-4 h-4 text-text-muted" />
                                    : <ChevronRight className="w-4 h-4 text-text-muted" />}
                                </div>
                              </button>

                              {/* Operation records */}
                              {isOpExpanded && (
                                <div className="px-4 pb-4 pt-1">
                                  {isOpDecrypting ? (
                                    <div className="flex justify-center py-6 gap-2">
                                      <Spinner /> <span className="text-text-secondary text-sm">Verifying & decrypting…</span>
                                    </div>
                                  ) : opRecsDec?.length > 0 ? (
                                    <div className="grid gap-3 md:grid-cols-2">
                                      {opRecsDec.map((rec) => (
                                        <RecordCard key={rec.cid} rec={rec} navigate={navigate} />
                                      ))}
                                    </div>
                                  ) : opRecsDec ? (
                                    <p className="text-text-muted text-sm text-center py-4">
                                      Could not decrypt records for this operation.
                                    </p>
                                  ) : isVerified === false ? (
                                    <p className="text-error text-sm text-center py-4">
                                      Permission has expired or been revoked. Records cannot be decrypted.
                                    </p>
                                  ) : null}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


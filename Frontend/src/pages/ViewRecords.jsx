import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import API from "../api/axios";
import { Card, Button, Input, Spinner, Toast } from "../components/UI";
import { Search, ClipboardList, FileText, ArrowLeft } from "lucide-react";
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
} from "../utils/recordCache";

export default function ViewRecords() {
  const { walletAddress, naclPrivateKey } = useAuth();
  const navigate = useNavigate();

  const [toast, setToast] = useState(null);
  const [viewAddr, setViewAddr] = useState("");
  const [viewOp, setViewOp] = useState("");
  const [viewRecords, setViewRecords] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);
  const [fromCache, setFromCache] = useState(false);

  // ── Restore last search results from session cache on mount ──
  useEffect(() => {
    if (!walletAddress || !naclPrivateKey) return;

    const autoLoad = async () => {
      try {
        const lastParams = JSON.parse(
          sessionStorage.getItem("doctor_view_last_params") || "null"
        );
        if (lastParams && lastParams.addr && lastParams.op) {
          setViewAddr(lastParams.addr);
          setViewOp(lastParams.op);

          const cached = loadDoctorCache(
            walletAddress,
            lastParams.addr,
            lastParams.op
          );
          
          if (cached && cached.length > 0) {
            setViewLoading(true);

            // 0. Permission check in frontend before displaying cache
            try {
              const permission_exists = await checkDoctorPermissionOnChain(
                lastParams.addr,
                walletAddress,
                lastParams.op
              );

              if (!permission_exists) {
                setToast({
                  message: "Cached view restricted: Access permission has expired or been revoked.",
                  type: "error",
                });
                clearDoctorCache(lastParams.addr, walletAddress, lastParams.op);
                setViewLoading(false);
                return; // Stop here, do not display cache
              }
            } catch (permErr) {
              setToast({
                message: "Failed to verify on-chain permission for cached records.",
                type: "error",
              });
              clearDoctorCache(lastParams.addr, walletAddress, lastParams.op);
              setViewLoading(false);
              return;
            }

            setFromCache(true);
            setToast({ message: "⚡ Decrypting cached records…", type: "info" });
            
            const dec = await decryptAll(cached);
            setViewRecords(dec);
            setViewLoading(false);
            setToast({
              message: `⚡ ${dec.length} record(s) loaded from cache`,
              type: "success",
            });
          }
        }
      } catch (err) {
        console.warn("[ViewRecords] Failed to load cache on mount", err);
        setViewLoading(false);
      }
    };

    autoLoad();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, naclPrivateKey]);

  // ── Helper: decrypt an array of encrypted records in-memory ──
  const decryptAll = async (encRecords) => {
    const decryptPromises = encRecords.map(async (rec) => {
      try {
        if (!rec.encryptedAESKey || !rec.nonce || !rec.senderPublicKey) {
          console.warn(`[ViewRecords] Missing key data for CID ${rec.cid}`);
          return null;
        }

        const aesKeyBytes = decryptAESKeyWithNaCl(
          rec.encryptedAESKey,
          rec.nonce,
          rec.senderPublicKey,
          naclPrivateKey,
        );

        const decryptedRecord = await decryptRecordLocal(
          rec.encryptedPayload.cipherText,
          aesKeyBytes,
          rec.encryptedPayload.iv,
          rec.encryptedPayload.authTag,
        );

        // Decrypt PDF if present (diagnostics records)
        let pdfBase64 = null;
        if (rec.encryptedPayload.pdfData && rec.encryptedPayload.pdfAuthTag) {
          try {
            pdfBase64 = await decryptPdfLocal(
              rec.encryptedPayload.pdfData,
              aesKeyBytes,
              rec.encryptedPayload.iv,
              rec.encryptedPayload.pdfAuthTag,
            );
          } catch (pdfErr) {
            console.warn(
              `[ViewRecords] PDF decrypt failed for CID ${rec.cid}:`,
              pdfErr.message,
            );
          }
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
      } catch (err) {
        console.warn(
          `[ViewRecords] Failed to decrypt CID ${rec.cid}:`,
          err.message,
        );
        return null;
      }
    });

    const results = await Promise.all(decryptPromises);
    return results.filter((r) => r !== null);
  };

  /* ── View Patient Records (Doctor flow) ── */
  const handleView = async (e) => {
    e.preventDefault();
    setViewRecords([]);
    setFromCache(false);

    if (!naclPrivateKey) {
      setToast({
        message: "Encryption keys not available. Please re-login.",
        type: "error",
      });
      return;
    }

    setViewLoading(true);

    try {
      //0. Permission check in frontend itself before making any API calls
      const permission_exists = await checkDoctorPermissionOnChain(
        viewAddr,
        walletAddress,
        viewOp,
      );

      if (!permission_exists) {
        setToast({
          message: "Access denied: no active permission or permission expired",
          type: "error",
        });
        clearDoctorCache(viewAddr, walletAddress, viewOp);
        setViewLoading(false);
        return;
      }
    } catch (permErr) {
      setToast({
        message: "Access denied: failed to verify on-chain permission",
        type: "error",
      });
      clearDoctorCache(viewAddr, walletAddress, viewOp);
      setViewLoading(false);
      return;
    }

    // ── Check encrypted cache first ──
    const cached = loadDoctorCache(walletAddress, viewAddr, viewOp);
    if (cached && cached.length > 0) {
      setFromCache(true);
      setToast({ message: "⚡ Decrypting cached records…", type: "info" });
      const dec = await decryptAll(cached);
      setViewRecords(dec);
      sessionStorage.setItem(
        "doctor_view_last_params",
        JSON.stringify({ addr: viewAddr, op: viewOp }),
      );
      setToast({
        message: `⚡ ${dec.length} record(s) loaded from cache`,
        type: "success",
      });
      setViewLoading(false);
      return;
    }

    try {
      // 1. Fetch encrypted records from backend
      setToast({
        message: "Fetching relevant records and Decrypting...",
        type: "info",
      });
      const { data } = await API.post("/records/view", {
        patientAddress: viewAddr,
        userAddress: walletAddress,
        operation: viewOp,
      });

      if (!data.records?.length) {
        setToast({ message: "No matching records found", type: "info" });
        setViewLoading(false);
        return;
      }

      // Cache the encrypted records (never decrypted data)
      saveDoctorCache(walletAddress, viewAddr, viewOp, data.records);

      // 2. Decrypt each record client-side
      const decryptedRecords = await decryptAll(data.records);

      setViewRecords(decryptedRecords);
      if (decryptedRecords.length > 0) {
        sessionStorage.setItem(
          "doctor_view_last_params",
          JSON.stringify({ addr: viewAddr, op: viewOp }),
        );
        setToast({
          message: `${decryptedRecords.length} record(s) decrypted — encrypted data cached`,
          type: "success",
        });
      } else {
        setToast({
          message:
            "Could not decrypt any records. Check your access permissions.",
          type: "error",
        });
      }
    } catch (err) {
      setToast({
        message: err.response?.data?.error || "Failed to fetch records",
        type: "error",
      });
    } finally {
      setViewLoading(false);
    }
  };

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
          Search and view patient records you have been granted access to
        </p>
      </div>

      <Card>
        <form onSubmit={handleView} className="grid gap-4 md:grid-cols-3 mb-6">
          <Input
            id="v-addr"
            label="Patient Address"
            placeholder="0x…"
            value={viewAddr}
            onChange={(e) => setViewAddr(e.target.value)}
            required
          />
          <div>
            <label
              htmlFor="v-op"
              className="block text-sm font-medium text-text-secondary mb-1.5"
            >
              Operation
            </label>
            <select
              id="v-op"
              value={viewOp}
              onChange={(e) => setViewOp(e.target.value)}
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
          <div className="flex items-end">
            <Button
              type="submit"
              variant="secondary"
              loading={viewLoading}
              className="w-full"
              onClick={() => setToast(false)}
            >
              <Search className="w-4 h-4" /> Search Records
            </Button>
          </div>
        </form>

        {viewLoading ? (
          <div className="flex justify-center py-8">
            <Spinner size="lg" />
          </div>
        ) : viewRecords.length === 0 ? (
          <div className="text-center py-8">
            <ClipboardList className="w-10 h-10 text-text-muted mx-auto mb-2" />
            <p className="text-text-secondary text-sm">
              Search for patient records above.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {viewRecords.map((rec) => (
              <Card
                key={rec.cid}
                className="bg-surface hover:border-accent/30 transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="px-2.5 py-0.5 rounded-full bg-accent/10 text-accent text-xs font-semibold uppercase">
                    {rec.metadata?.recordType || "record"}
                  </span>
                  <span className="text-xs text-text-muted">
                    {new Date(
                      Number(rec.timestamp) * 1000,
                    ).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-sm text-text-secondary mb-1">
                  <strong>CID:</strong>{" "}
                  <span className="font-mono text-xs break-all">{rec.cid}</span>
                </p>

                {/* ── Issued By ── */}
                {rec.issuedByDoctor && rec.issuedByDoctor !== "0x0000000000000000000000000000000000000000" && (
                  <p className="text-sm text-text-secondary mb-1">
                    <strong>🩺 Issued by Doctor:</strong>{" "}
                    <span className="font-mono text-xs">{rec.issuedByDoctor.slice(0, 6)}…{rec.issuedByDoctor.slice(-4)}</span>
                  </p>
                )}
                {rec.issuedByLab && rec.issuedByLab !== "0x0000000000000000000000000000000000000000" && (
                  <p className="text-sm text-text-secondary mb-1">
                    <strong>🔬 Issued by Lab:</strong>{" "}
                    <span className="font-mono text-xs">{rec.issuedByLab.slice(0, 6)}…{rec.issuedByLab.slice(-4)}</span>
                  </p>
                )}
                {/* Fallback: check metadata */}
                {(!rec.issuedByDoctor || rec.issuedByDoctor === "0x0000000000000000000000000000000000000000") &&
                 (!rec.issuedByLab || rec.issuedByLab === "0x0000000000000000000000000000000000000000") && (
                  <>
                    {(rec.metadata?.doctorAddress || rec.record?.doctorAddress) && (
                      <p className="text-sm text-text-secondary mb-1">
                        <strong>🩺 Issued by Doctor:</strong>{" "}
                        <span className="font-mono text-xs">
                          {(rec.metadata?.doctorAddress || rec.record?.doctorAddress).slice(0, 6)}…{(rec.metadata?.doctorAddress || rec.record?.doctorAddress).slice(-4)}
                        </span>
                      </p>
                    )}
                    {rec.metadata?.labAddress && (
                      <p className="text-sm text-text-secondary mb-1">
                        <strong>🔬 Issued by Lab:</strong>{" "}
                        <span className="font-mono text-xs">{rec.metadata.labAddress.slice(0, 6)}…{rec.metadata.labAddress.slice(-4)}</span>
                      </p>
                    )}
                  </>
                )}

                {rec.metadata?.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {rec.metadata.tags.map((t) => (
                      <span
                        key={t}
                        className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs"
                      >
                        {t}
                      </span>
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
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

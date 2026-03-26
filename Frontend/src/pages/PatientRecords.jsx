import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import API from '../api/axios';
import { Card, Button, Spinner, Toast } from '../components/UI';
import { FileText, RefreshCw, ArrowLeft, Trash2 } from 'lucide-react';
import {
  decryptAESKeyWithNaCl,
  decryptRecordLocal,
  decryptPdfLocal,
} from '../utils/naclCrypto';

// ─── Cache helpers (localStorage, keyed by wallet address) ───

function getCacheKey(address) {
  return `medirecord_cache_${address?.toLowerCase()}`;
}

function loadCache(address) {
  try {
    const raw = localStorage.getItem(getCacheKey(address));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCache(address, cacheMap) {
  try {
    localStorage.setItem(getCacheKey(address), JSON.stringify(cacheMap));
  } catch {
    // localStorage quota exceeded — silently skip caching
  }
}

function clearCache(address) {
  localStorage.removeItem(getCacheKey(address));
}

// ─────────────────────────────────────────────

export default function PatientRecords() {
  const { walletAddress, naclPrivateKey, sessionKey } = useAuth();
  const navigate = useNavigate();

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [fromCache, setFromCache] = useState(false);

  // ── On mount: load from cache first, then fetch any new records ──
  useEffect(() => {
    if (!walletAddress) return;

    const cached = loadCache(walletAddress);
    if (Object.keys(cached).length > 0) {
      setRecords(Object.values(cached));
      setFromCache(true);
    } else {
      fetchRecords();
    }
  }, [walletAddress]);

  const fetchRecords = async (forceRefresh = false) => {
    if (!walletAddress) {
      setToast({ message: 'Connect your wallet first', type: 'error' });
      return;
    }
    if (!naclPrivateKey && !sessionKey) {
      setToast({ message: 'Encryption keys not available. Please re-login.', type: 'error' });
      return;
    }

    setLoading(true);
    setFromCache(false);

    // Load existing cache so we can skip already-decrypted records
    const existingCache = loadCache(walletAddress);

    try {
      const { data } = await API.post('/records/view', {
        patientAddress: walletAddress,
        userAddress: walletAddress,
        operation: '*',
      });

      if (!data.records?.length) {
        setToast({ message: 'No records found', type: 'info' });
        setLoading(false);
        return;
      }

      const updatedCache = { ...existingCache };
      const decryptedRecords = [];

      for (const rec of data.records) {
        // ── Cache hit: skip decryption ──
        if (updatedCache[rec.cid]) {
          decryptedRecords.push(updatedCache[rec.cid]);
          continue;
        }

        // ── Cache miss: decrypt and store ──
        try {
          let aesKeyBytes;

          if (naclPrivateKey && rec.encryptedAESKey && rec.nonce && rec.senderPublicKey) {
            aesKeyBytes = decryptAESKeyWithNaCl(
              rec.encryptedAESKey,
              rec.nonce,
              rec.senderPublicKey,
              naclPrivateKey
            );
          }

          if (!aesKeyBytes) {
            console.warn(`[PatientRecords] No key for CID ${rec.cid}`);
            continue;
          }

          const decryptedRecord = await decryptRecordLocal(
            rec.encryptedPayload.cipherText,
            aesKeyBytes,
            rec.encryptedPayload.iv,
            rec.encryptedPayload.authTag
          );

          // Decrypt PDF if present (diagnostics records)
          let pdfBase64 = null;
          if (rec.encryptedPayload.pdfData && rec.encryptedPayload.pdfAuthTag) {
            try {
              pdfBase64 = await decryptPdfLocal(
                rec.encryptedPayload.pdfData,
                aesKeyBytes,
                rec.encryptedPayload.iv,
                rec.encryptedPayload.pdfAuthTag
              );
            } catch (pdfErr) {
              console.warn(`[PatientRecords] PDF decrypt failed for CID ${rec.cid}:`, pdfErr.message);
            }
          }

          const entry = {
            cid: rec.cid,
            metadata: rec.metadata,
            record: decryptedRecord,
            pdfBase64,  // will be null for non-diagnostics records
            timestamp: rec.timestamp,
            issuedByDoctor: rec.issuedByDoctor,
          };

          updatedCache[rec.cid] = entry;
          decryptedRecords.push(entry);
        } catch (err) {
          console.warn(`[PatientRecords] Failed to decrypt CID ${rec.cid}:`, err.message);
        }
      }

      // Persist updated cache
      saveCache(walletAddress, updatedCache);
      setRecords(decryptedRecords);

      if (decryptedRecords.length > 0) {
        const newCount = decryptedRecords.length - Object.keys(existingCache).length;
        setToast({
          message: newCount > 0
            ? `Loaded ${decryptedRecords.length} record(s) (${newCount} newly decrypted)`
            : `All ${decryptedRecords.length} record(s) loaded from cache`,
          type: 'success',
        });
      } else {
        setToast({ message: 'Could not decrypt any records', type: 'error' });
      }
    } catch (err) {
      setToast({ message: err.response?.data?.error || err.message || 'Failed to fetch records', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleClearCache = () => {
    clearCache(walletAddress);
    setRecords([]);
    setFromCache(false);
    setToast({ message: 'Cache cleared. Records will be re-decrypted on next load.', type: 'info' });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6 animate-fade-in">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* ── Back button ── */}
      <button
        onClick={() => navigate('/patient')}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary transition-colors cursor-pointer">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold bg-linear-to-r from-accent to-primary bg-clip-text text-transparent">
            My Medical Records
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            {fromCache
              ? '⚡ Loaded from local cache — no decryption needed'
              : 'Records are decrypted locally using your session key'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {records.length > 0 && (
            <Button variant="ghost" onClick={handleClearCache} title="Clear local cache">
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
          <Button variant="secondary" onClick={() => fetchRecords(true)} loading={loading}>
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
        </div>
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : records.length === 0 ? (
        <Card className="text-center py-12">
          <FileText className="w-12 h-12 text-text-muted mx-auto mb-3" />
          <p className="text-text-secondary mb-4">No records found. Records will appear here after they&apos;re created.</p>
          <Button onClick={() => fetchRecords()}>Load Records</Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {records.map((rec) => (
            <Card key={rec.cid} className="hover:border-accent/30 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <span className="px-2.5 py-0.5 rounded-full bg-accent/10 text-accent text-xs font-semibold uppercase">
                  {rec.metadata?.recordType || rec.record?.recordType || 'record'}
                </span>
                <span className="text-xs text-text-muted">
                  {new Date(Number(rec.timestamp) * 1000).toLocaleDateString()}
                </span>
              </div>

              {rec.record?.patientName && (
                <p className="text-sm font-medium text-text-primary mb-1">
                  👤 {rec.record.patientName}
                  {rec.record.patientAge ? `, ${rec.record.patientAge} yrs` : ''}
                  {rec.record.patientGender ? ` · ${rec.record.patientGender}` : ''}
                </p>
              )}

              {rec.record?.diagnosis && (
                <p className="text-sm text-text-secondary mb-1">
                  <strong>Diagnosis:</strong> {rec.record.diagnosis}
                </p>
              )}

              {rec.record?.bloodGroup && (
                <p className="text-sm text-text-secondary mb-1">
                  <strong>Blood Group:</strong> {rec.record.bloodGroup}
                </p>
              )}

              <p className="text-xs text-text-muted font-mono break-all mt-1">{rec.cid}</p>

              {rec.metadata?.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {rec.metadata.tags.slice(0, 4).map((t) => (
                    <span key={t} className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs">{t}</span>
                  ))}
                  {rec.metadata.tags.length > 4 && (
                    <span className="px-2 py-0.5 rounded-md bg-surface text-text-muted text-xs">
                      +{rec.metadata.tags.length - 4}
                    </span>
                  )}
                </div>
              )}

              <div className="mt-4 pt-3 border-t border-border/50">
                <Button variant="secondary" className="w-full text-xs py-2"
                  onClick={() => navigate(`/record/${rec.cid}`, { state: { recordData: rec } })}>
                  <FileText className="w-4 h-4" /> View Full Record
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

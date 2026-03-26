import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import API from '../api/axios';
import { Card, Button, Input, Spinner, Toast } from '../components/UI';
import { Search, ClipboardList, FileText, ArrowLeft } from 'lucide-react';
import OPERATIONS from '../constants/operations';
import {
  decryptAESKeyWithNaCl,
  decryptRecordLocal,
  decryptPdfLocal,
} from '../utils/naclCrypto';

// ── Session-level cache (cleared when doctor returns to dashboard) ──
const CACHE_KEY = 'doctor_view_cache';

function loadSessionCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveSessionCache(cacheMap) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(cacheMap)); } catch {}
}

function buildCacheId(patientAddr, operation) {
  return `${patientAddr.toLowerCase()}_${operation}`;
}

export default function ViewRecords() {
  const { walletAddress, naclPrivateKey } = useAuth();
  const navigate = useNavigate();

  const [toast, setToast] = useState(null);
  const [viewAddr, setViewAddr] = useState('');
  const [viewOp, setViewOp] = useState('');
  const [viewRecords, setViewRecords] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);

  // ── Restore last search results from session cache on mount ──
  useState(() => {
    try {
      const lastParams = JSON.parse(sessionStorage.getItem('doctor_view_last_params') || 'null');
      if (lastParams) {
        setViewAddr(lastParams.addr);
        setViewOp(lastParams.op);
        const cache = loadSessionCache();
        const cacheId = buildCacheId(lastParams.addr, lastParams.op);
        if (cache[cacheId]) {
          setViewRecords(cache[cacheId]);
        }
      }
    } catch {}
  });

  /* ── View Patient Records (Doctor flow) ── */
  const handleView = async (e) => {
    e.preventDefault();
    setViewRecords([]);

    if (!naclPrivateKey) {
      setToast({ message: 'Encryption keys not available. Please re-login.', type: 'error' });
      return;
    }

    // ── Check session cache first ──
    const cacheId = buildCacheId(viewAddr, viewOp);
    const cache = loadSessionCache();
    if (cache[cacheId]) {
      setViewRecords(cache[cacheId]);
      setToast({ message: `⚡ Loaded ${cache[cacheId].length} record(s) from cache`, type: 'success' });
      return;
    }

    setViewLoading(true);
    try {
      // 1. Fetch encrypted records from backend
      const { data } = await API.post('/records/view', {
        patientAddress: viewAddr,
        userAddress: walletAddress,
        operation: viewOp,
      });

      if (!data.records?.length) {
        setToast({ message: 'No matching records found', type: 'info' });
        setViewLoading(false);
        return;
      }

      // 2. Decrypt each record client-side using NaCl private key
      const decryptedRecords = [];

      for (const rec of data.records) {
        try {
          if (!rec.encryptedAESKey || !rec.nonce || !rec.senderPublicKey) {
            console.warn(`[ViewRecords] Missing key data for CID ${rec.cid}`);
            continue;
          }

          // NaCl decrypt the AES key
          const aesKeyBytes = decryptAESKeyWithNaCl(
            rec.encryptedAESKey,
            rec.nonce,
            rec.senderPublicKey,
            naclPrivateKey
          );

          // Decrypt the record
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
              console.warn(`[ViewRecords] PDF decrypt failed for CID ${rec.cid}:`, pdfErr.message);
            }
          }

          decryptedRecords.push({
            cid: rec.cid,
            metadata: rec.metadata,
            record: decryptedRecord,
            pdfBase64,
            timestamp: rec.timestamp,
            issuedByDoctor: rec.issuedByDoctor,
          });
        } catch (err) {
          console.warn(`[ViewRecords] Failed to decrypt CID ${rec.cid}:`, err.message);
        }
      }

      setViewRecords(decryptedRecords);
      if (decryptedRecords.length > 0) {
        // Save to session cache
        cache[cacheId] = decryptedRecords;
        saveSessionCache(cache);
        sessionStorage.setItem('doctor_view_last_params', JSON.stringify({ addr: viewAddr, op: viewOp }));
        setToast({ message: 'Access granted!', type: 'success' });
      } else {
        setToast({ message: 'Could not decrypt any records. Check your access permissions.', type: 'error' });
      }
    } catch (err) {
      setToast({ message: err.response?.data?.error || 'Failed to fetch records', type: 'error' });
    } finally {
      setViewLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6 animate-fade-in">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <button onClick={() => navigate('/doctor')}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary transition-colors cursor-pointer">
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
          <Input id="v-addr" label="Patient Address" placeholder="0x…"
            value={viewAddr} onChange={(e) => setViewAddr(e.target.value)} required />
          <div>
            <label htmlFor="v-op" className="block text-sm font-medium text-text-secondary mb-1.5">Operation</label>
            <select id="v-op" value={viewOp} onChange={(e) => setViewOp(e.target.value)} required
              className="w-full px-4 py-2.5 rounded-xl bg-surface-input border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40">
              <option value="" disabled>Select operation…</option>
              {OPERATIONS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <Button type="submit" variant="secondary" loading={viewLoading} className="w-full">
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
              <Card key={rec.cid} className="bg-surface hover:border-accent/30 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <span className="px-2.5 py-0.5 rounded-full bg-accent/10 text-accent text-xs font-semibold uppercase">
                    {rec.metadata?.recordType || 'record'}
                  </span>
                  <span className="text-xs text-text-muted">
                    {new Date(Number(rec.timestamp) * 1000).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-sm text-text-secondary mb-1">
                  <strong>CID:</strong> <span className="font-mono text-xs break-all">{rec.cid}</span>
                </p>
                {rec.metadata?.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {rec.metadata.tags.map((t) => (
                      <span key={t} className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs">{t}</span>
                    ))}
                  </div>
                )}
                {rec.record && (
                  <div className="mt-4 pt-3 border-t border-border/50">
                    <Button variant="secondary" className="w-full text-xs py-2"
                      onClick={() => navigate(`/record/${rec.cid}`, { state: { recordData: rec, isDoctor: true } })}>
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

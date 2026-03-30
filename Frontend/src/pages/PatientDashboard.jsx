import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import API from '../api/axios';
import { grantAccessOnChain } from '../utils/blockchain';
import { Card, Button, Spinner, Toast } from '../components/UI';
import { ShieldPlus, ShieldOff, RefreshCw, Inbox, CheckCircle, XCircle, ChevronRight, FileText } from 'lucide-react';
import OPERATIONS from '../constants/operations';
import {
  decryptAESKeyWithNaCl,
  encryptAESKeyWithNaCl,
} from '../utils/naclCrypto';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

export default function PatientDashboard() {
  const { user, walletAddress, naclPrivateKey } = useAuth();
  const navigate = useNavigate();

  const [pendingRequests, setPendingRequests] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [approvingId, setApprovingId] = useState(null);
  const [durations, setDurations] = useState({}); // Tracking duration per request ID
  const [toast, setToast] = useState(null);

  /* ── Fetch pending access requests ── */
  const fetchPendingRequests = useCallback(async () => {
    if (!walletAddress) return;
    setPendingLoading(true);
    try {
      const { data } = await API.get(`/requests/patient/${walletAddress}`);
      setPendingRequests(data.requests || []);
    } catch (err) {
      console.warn('Failed to fetch pending requests:', err.message);
    } finally {
      setPendingLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => { fetchPendingRequests(); }, [fetchPendingRequests]);

  /* ── Approve a pending request ── */
  const handleApproveRequest = async (request) => {
    if (!naclPrivateKey) {
      setToast({ message: 'Encryption keys not available. Please re-login.', type: 'error' });
      return;
    }

    setApprovingId(request.id);
    try {
      // 1. Fetch doctor's NaCl public key
      setToast({ message: 'Fetching doctor encryption key…', type: 'info' });
      const { data: doctorData } = await API.get(`/auth/public-key/${request.doctor_address}`);
      const doctorNaClPubKey = doctorData.user.naclPublicKey;

      if (!doctorNaClPubKey) {
        throw new Error('Doctor has no NaCl public key registered');
      }

      // 2. Grant on-chain access (MetaMask popup)
      const durationSeconds = durations[request.id] ? parseInt(durations[request.id]) : 86400;
      setToast({ message: 'Confirm the transaction in MetaMask…', type: 'info' });
      await grantAccessOnChain(request.doctor_address, request.operation, request.purpose, durationSeconds);

      // 3. Fetch patient's encrypted records to re-wrap keys
      setToast({ message: 'Fetching your records…', type: 'info' });
      const { data: recData } = await API.post('/records/view', {
        patientAddress: walletAddress,
        userAddress: walletAddress,
        operation: request.operation,
      });
      const records = recData.records || [];

      // 4. For each record: decrypt AES key client-side, send to backend for NaCl re-encryption
      setToast({ message: 'Re-encrypting keys for doctor…', type: 'info' });
      let keysGranted = 0;
      let keysFailed = 0;

      for (const rec of records) {
        try {
          let aesKeyBytes;

          // Decrypt AES key with NaCl private key
          if (naclPrivateKey && rec.encryptedAESKey && rec.nonce && rec.senderPublicKey) {
            aesKeyBytes = decryptAESKeyWithNaCl(
              rec.encryptedAESKey,
              rec.nonce,
              rec.senderPublicKey,
              naclPrivateKey
            );
          }

          if (!aesKeyBytes) {
            keysFailed++;
            continue;
          }

          // Re-encrypt the AES key for the doctor using patient's NaCl private key
          const { encryptedKey, nonce: encNonce } = encryptAESKeyWithNaCl(
            aesKeyBytes,
            doctorNaClPubKey,
            naclPrivateKey
          );

          // Derive patient's NaCl public key from private key
          const patientSecKey = naclUtil.decodeBase64(naclPrivateKey);
          const patientPubKey = naclUtil.encodeBase64(
            nacl.box.keyPair.fromSecretKey(patientSecKey).publicKey
          );

          await API.post('/access/grant', {
            cid: rec.cid,
            patientAddress: walletAddress,
            doctorAddress: request.doctor_address,
            encryptedAESKey: encryptedKey,
            nonce: encNonce,
            senderNaClPublicKey: patientPubKey,
            operation: request.operation,
          });
          keysGranted++;
        } catch (grantErr) {
          keysFailed++;
          console.warn(`[ApproveRequest] Key re-wrap failed for CID ${rec.cid}:`, grantErr.message);
        }
      }

      // 5. Mark backend request as approved
      await API.put(`/requests/${request.id}/status`, { status: 'approved' });

      if (keysGranted === 0 && records.length > 0) {
        setToast({
          message: `Request approved, but NO keys could be shared (${keysFailed} failed).`,
          type: 'warning',
        });
      } else {
        setToast({
          message: `Request approved! ${keysGranted} record key(s) shared.${keysFailed > 0 ? ` (${keysFailed} skipped)` : ''}`,
          type: 'success',
        });
      }
      fetchPendingRequests();
    } catch (err) {
      setToast({ message: err.message || 'Approval failed', type: 'error' });
    } finally {
      setApprovingId(null);
    }
  };

  /* ── Reject a pending request ── */
  const handleRejectRequest = async (request) => {
    setApprovingId(request.id);
    try {
      await API.put(`/requests/${request.id}/status`, { status: 'rejected' });
      setToast({ message: 'Request rejected', type: 'success' });
      fetchPendingRequests();
    } catch (err) {
      setToast({ message: err.message || 'Reject failed', type: 'error' });
    } finally {
      setApprovingId(null);
    }
  };

  const handleDurationChange = (reqId, value) => {
    setDurations((prev) => ({ ...prev, [reqId]: value }));
  };

  const opLabel = (val) => OPERATIONS.find((o) => o.value === val)?.label || val;

  /* ── Quick action items ── */
  const quickActions = [
    {
      title: 'Grant Access',
      description: 'Manually grant a doctor access to your records',
      icon: ShieldPlus,
      color: 'success',
      path: '/patient/grant-access',
    },
    {
      title: 'Revoke Access',
      description: 'Remove a doctor\'s access to your records',
      icon: ShieldOff,
      color: 'danger',
      path: '/patient/revoke-access',
    },
    {
      title: 'View My Records',
      description: 'View your personal medical history and records',
      icon: FileText,
      color: 'primary',
      path: '/patient/my-records',
    },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8 animate-fade-in">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Patient Dashboard
          </h1>
          <p className="text-text-secondary text-sm mt-1">Welcome, {walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'Patient'}</p>
        </div>
        <Button variant="secondary" onClick={fetchPendingRequests} loading={pendingLoading}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {/* ── Quick Actions ── */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Quick Actions</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {quickActions.map((action) => (
            <button key={action.path} onClick={() => navigate(action.path)}
              className={`group flex items-center gap-4 p-5 rounded-2xl bg-surface-card border border-border
                hover:border-${action.color}/40 hover:shadow-lg hover:shadow-${action.color}/5 transition-all duration-200 text-left cursor-pointer`}>
              <div className={`p-3 rounded-xl bg-${action.color}/10`}>
                <action.icon className={`w-6 h-6 text-${action.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-text-primary group-hover:text-primary transition-colors">{action.title}</p>
                <p className="text-xs text-text-secondary mt-0.5">{action.description}</p>
              </div>
              <ChevronRight className="w-5 h-5 text-text-muted group-hover:text-primary transition-colors shrink-0" />
            </button>
          ))}
        </div>
      </section>

      {/* ── Pending Access Requests ── */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Inbox className="w-5 h-5 text-warning" /> Pending Access Requests
          {pendingRequests.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-warning/10 text-warning text-xs font-bold">{pendingRequests.length}</span>
          )}
        </h2>

        {pendingLoading ? (
          <div className="flex justify-center py-8"><Spinner size="lg" /></div>
        ) : pendingRequests.length === 0 ? (
          <Card className="text-center py-8">
            <Inbox className="w-10 h-10 text-text-muted mx-auto mb-2" />
            <p className="text-text-secondary text-sm">No pending access requests.</p>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {pendingRequests.map((req) => (
              <Card key={req.id} className="hover:border-warning/30 transition-colors">
                <div className="mb-3">
                  <span className="px-2.5 py-0.5 rounded-full bg-warning/10 text-warning text-xs font-semibold uppercase">
                    {opLabel(req.operation)}
                  </span>
                </div>
                <p className="text-sm text-text-secondary mb-1">
                  <strong>Doctor:</strong>{' '}
                  <span className="font-mono text-xs break-all">{req.doctor_address}</span>
                </p>
                <p className="text-sm text-text-secondary mb-1">
                  <strong>Purpose:</strong> {req.purpose}
                </p>
                <p className="text-xs text-text-muted mb-3">
                  Requested: {new Date(req.created_at).toLocaleString()}
                </p>
                
                <div className="mb-4">
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    Access Duration
                  </label>
                  <select
                    value={durations[req.id] || "86400"}
                    onChange={(e) => handleDurationChange(req.id, e.target.value)}
                    className="w-full px-3 py-1.5 text-sm rounded-lg bg-surface-input border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="28800">8 Hours</option>
                    <option value="86400">24 Hours (1 Day)</option>
                    <option value="259200">72 Hours (3 Days)</option>
                    <option value="604800">7 Days</option>
                    <option value="1209600">14 Days</option>
                    <option value="2592000">30 Days</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleApproveRequest(req)}
                    loading={approvingId === req.id}
                    className="flex-1"
                  >
                    <CheckCircle className="w-4 h-4" /> Approve
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => handleRejectRequest(req)}
                    loading={approvingId === req.id}
                    className="flex-1"
                  >
                    <XCircle className="w-4 h-4" /> Reject
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

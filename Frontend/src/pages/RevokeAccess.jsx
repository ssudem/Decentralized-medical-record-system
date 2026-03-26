import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import API from '../api/axios';
import { revokeAccessOnChain } from '../utils/blockchain';
import { Card, Button, Input, Toast } from '../components/UI';
import { ShieldOff, ArrowLeft } from 'lucide-react';
import OPERATIONS from '../constants/operations';

export default function RevokeAccess() {
  const { walletAddress } = useAuth();
  const navigate = useNavigate();

  const [toast, setToast] = useState(null);
  const [records, setRecords] = useState([]);
  const [revokeForm, setRevokeForm] = useState({ doctorAddress: '', operation: '' });
  const [revokeLoading, setRevokeLoading] = useState(false);

  /* ── Fetch records (needed to revoke off-chain keys) ── */
  const fetchRecords = useCallback(async () => {
    if (!walletAddress) return;
    try {
      const { data } = await API.post('/records/view', {
        patientAddress: walletAddress,
        userAddress: walletAddress,
        operation: '*',
      });
      setRecords(data.records || []);
    } catch { /* silent */ }
  }, [walletAddress]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  /* ── Revoke Access ── */
  const handleRevoke = async (e) => {
    e.preventDefault();
    setRevokeLoading(true);
    try {
      // 1. Revoke on-chain (MetaMask popup)
      setToast({ message: 'Confirm revoke in MetaMask…', type: 'info' });
      await revokeAccessOnChain(revokeForm.doctorAddress, revokeForm.operation);

      // 2. Remove off-chain encrypted keys from DB
      for (const rec of records) {
        try {
          await API.post('/access/revoke', { cid: rec.cid, doctorAddress: revokeForm.doctorAddress });
        } catch { /* skip */ }
      }

      setToast({ message: 'Access revoked successfully!', type: 'success' });
      setRevokeForm({ doctorAddress: '', operation: '' });
    } catch (err) {
      setToast({ message: err.message || 'Revoke failed', type: 'error' });
    } finally {
      setRevokeLoading(false);
    }
  };

  const setR = (key) => (e) => setRevokeForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6 animate-fade-in">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <button onClick={() => navigate('/patient')}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary transition-colors cursor-pointer">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-danger to-warning bg-clip-text text-transparent">
          Revoke Access
        </h1>
        <p className="text-text-secondary text-sm mt-1">Remove a doctor's access to your medical records</p>
      </div>

      <Card>
        <form onSubmit={handleRevoke} className="grid gap-4 md:grid-cols-2">
          <Input id="r-doctor" label="Doctor Ethereum Address" placeholder="0x…" value={revokeForm.doctorAddress} onChange={setR('doctorAddress')} required />
          <div>
            <label htmlFor="r-op" className="block text-sm font-medium text-text-secondary mb-1.5">Operation</label>
            <select id="r-op" value={revokeForm.operation} onChange={setR('operation')} required
              className="w-full px-4 py-2.5 rounded-xl bg-surface-input border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40">
              <option value="" disabled>Select operation…</option>
              {OPERATIONS.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" variant="danger" loading={revokeLoading}><ShieldOff className="w-4 h-4" /> Revoke Access</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

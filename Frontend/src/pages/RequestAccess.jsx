import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import API from '../api/axios';
import { Card, Button, Input, Toast } from '../components/UI';
import { SendHorizonal, Mail, ArrowLeft } from 'lucide-react';
import OPERATIONS from '../constants/operations';

export default function RequestAccess() {
  const { walletAddress } = useAuth();
  const navigate = useNavigate();

  const [toast, setToast] = useState(null);
  const [reqForm, setReqForm] = useState({ patientAddress: '', operation: '', purpose: '' });
  const [reqLoading, setReqLoading] = useState(false);
  const setReq = (key) => (e) => setReqForm((f) => ({ ...f, [key]: e.target.value }));

  const handleRequestAccess = async (e) => {
    e.preventDefault();
    setReqLoading(true);
    try {
      await API.post('/requests', {
        patientAddress: reqForm.patientAddress,
        doctorAddress: walletAddress,
        operation: reqForm.operation,
        purpose: reqForm.purpose,
      });
      setToast({ message: 'Access request sent to patient!', type: 'success' });
      setReqForm({ patientAddress: '', operation: '', purpose: '' });
    } catch (err) {
      setToast({ message: err.response?.data?.error || 'Failed to send request', type: 'error' });
    } finally {
      setReqLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6 animate-fade-in">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <button onClick={() => navigate('/doctor')}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary transition-colors cursor-pointer">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-warning to-accent bg-clip-text text-transparent">
          Request Access from Patient
        </h1>
        <p className="text-text-secondary text-sm mt-1">Send an access request to a patient. They can approve it from their dashboard.</p>
      </div>

      <Card>
        <form onSubmit={handleRequestAccess} className="grid gap-4 md:grid-cols-2">
          <Input id="req-paddr" label="Patient Ethereum Address" placeholder="0x…"
            value={reqForm.patientAddress} onChange={setReq('patientAddress')} required />
          <div>
            <label htmlFor="req-op" className="block text-sm font-medium text-text-secondary mb-1.5">Operation</label>
            <select id="req-op" value={reqForm.operation} onChange={setReq('operation')} required
              className="w-full px-4 py-2.5 rounded-xl bg-surface-input border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40">
              <option value="" disabled>Select operation…</option>
              {OPERATIONS.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>
          </div>
          <Input id="req-purpose" label="Purpose" placeholder="Routine diabetes follow-up" value={reqForm.purpose} onChange={setReq('purpose')} required className="md:col-span-2" />
          <div className="md:col-span-2">
            <Button type="submit" loading={reqLoading}><SendHorizonal className="w-4 h-4" /> Send Request</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

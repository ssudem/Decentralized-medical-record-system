import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import API from '../api/axios';
import { removeHospitalOnChain } from '../utils/blockchain';
import { Card, Button, Input, Toast } from '../components/UI';
import { Building2, Search, ShieldCheck, Trash2 } from 'lucide-react';

export default function AdminPanel() {
  const { walletAddress, isSuperAdmin } = useAuth();
  const [toast, setToast] = useState(null);

  // ── Add Hospital ──
  const [hospAddr, setHospAddr] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  // ── Remove Hospital ──
  const [removeAddr, setRemoveAddr] = useState('');
  const [removeLoading, setRemoveLoading] = useState(false);

  // ── Status Check ──
  const [checkAddr, setCheckAddr] = useState('');
  const [checkResult, setCheckResult] = useState(null);
  const [checkLoading, setCheckLoading] = useState(false);

  /* ── Add Hospital ── */
  const handleAddHospital = async (e) => {
    e.preventDefault();
    setAddLoading(true);
    try {
      const { data } = await API.post('/hospitals/add', { hospitalAddress: hospAddr });
      setToast({ message: data.message, type: 'success' });
      setHospAddr('');
    } catch (err) {
      setToast({ message: err.response?.data?.error || 'Failed to add hospital', type: 'error' });
    } finally {
      setAddLoading(false);
    }
  };

  /* ── Remove Hospital ── */
  const handleRemoveHospital = async (e) => {
    e.preventDefault();
    if (!removeAddr) return;
    setRemoveLoading(true);
    try {
      const { data } = await API.post('/hospitals/remove', { hospitalAddress: removeAddr });
      setToast({ message: data.message, type: 'success' });
      setRemoveAddr('');
    } catch (err) {
      setToast({ message: err.response?.data?.error || 'Failed to remove hospital', type: 'error' });
    } finally {
      setRemoveLoading(false);
    }
  };

  /* ── Check Status ── */
  const handleCheckHospital = async () => {
    if (!checkAddr) return;
    setCheckLoading(true);
    setCheckResult(null);
    try {
      const { data } = await API.get(`/hospitals/${checkAddr}/status`);
      setCheckResult({ type: 'hospital', ...data });
    } catch {
      setToast({ message: 'Lookup failed', type: 'error' });
    } finally {
      setCheckLoading(false);
    }
  };

  const handleCheckDoctor = async () => {
    if (!checkAddr) return;
    setCheckLoading(true);
    setCheckResult(null);
    try {
      const { data } = await API.get(`/hospitals/doctor/${checkAddr}`);
      const isLinked = data.hospitalAddress && data.hospitalAddress !== '0x0000000000000000000000000000000000000000';
      setCheckResult({ type: 'doctor', ...data, isLinked });
    } catch {
      setToast({ message: 'Lookup failed', type: 'error' });
    } finally {
      setCheckLoading(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center animate-fade-in">
        <ShieldCheck className="w-12 h-12 text-warning mx-auto mb-4" />
        <h1 className="text-xl font-bold text-text-primary mb-2">Access Denied</h1>
        <p className="text-text-secondary text-sm">This panel is only accessible to the SuperAdmin wallet.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8 animate-fade-in">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <div>
        <h1 className="text-3xl font-bold bg-linear-to-r from-primary to-accent bg-clip-text text-transparent">
          SuperAdmin Panel
        </h1>
        <p className="text-text-secondary text-sm mt-1">
          Wallet: <span className="font-mono text-xs text-primary">{walletAddress}</span>
        </p>
      </div>

      {/* ── Register Hospital ── */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-primary" /> Register Hospital
        </h2>
        <Card>
          <form onSubmit={handleAddHospital} className="flex gap-3 items-end">
            <Input id="hosp-addr" label="Hospital Ethereum Address" placeholder="0x…"
              value={hospAddr} onChange={(e) => setHospAddr(e.target.value)} required className="flex-1" />
            <Button type="submit" loading={addLoading}>
              <Building2 className="w-4 h-4" /> Add Hospital
            </Button>
          </form>
        </Card>
      </section>

      {/* ── Remove Hospital ── */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Trash2 className="w-5 h-5 text-danger" /> Remove Hospital
        </h2>
        <Card>
          <form onSubmit={handleRemoveHospital} className="flex gap-3 items-end">
            <Input id="remove-hosp-addr" label="Hospital Ethereum Address" placeholder="0x…"
              value={removeAddr} onChange={(e) => setRemoveAddr(e.target.value)} required className="flex-1" />
            <Button type="submit" loading={removeLoading} variant="danger">
              <Trash2 className="w-4 h-4" /> Remove Hospital
            </Button>
          </form>
          <p className="text-xs text-text-muted mt-3">
            ⚠️ Removing a hospital will automatically revoke all doctors and labs under it.
          </p>
        </Card>
      </section>

      {/* ── Status Lookup ── */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Search className="w-5 h-5 text-accent" /> Status Lookup
        </h2>
        <Card>
          <div className="flex gap-3 items-end mb-4">
            <Input id="chk-addr" label="Ethereum Address" placeholder="0x…"
              value={checkAddr} onChange={(e) => setCheckAddr(e.target.value)} className="flex-1" />
            <Button type="button" variant="secondary" onClick={handleCheckHospital} loading={checkLoading}>
              <Building2 className="w-4 h-4" /> Hospital?
            </Button>
            <Button type="button" variant="secondary" onClick={handleCheckDoctor} loading={checkLoading}>
              <ShieldCheck className="w-4 h-4" /> Doctor?
            </Button>
          </div>

          {checkResult && (
            <div className={`p-3 rounded-xl border text-sm animate-fade-in ${
              (checkResult.type === 'hospital' ? checkResult.isValid : checkResult.isLinked)
                ? 'bg-success/5 border-success/20 text-success'
                : 'bg-warning/5 border-warning/20 text-warning'
            }`}>
              <ShieldCheck className="w-4 h-4 inline mr-1.5" />
              {checkResult.type === 'hospital'
                ? (checkResult.isValid
                    ? `✅ ${checkResult.address} is a registered hospital.`
                    : `⚠️ ${checkResult.address} is NOT a registered hospital.`)
                : (checkResult.isLinked
                    ? `✅ Doctor ${checkResult.doctorAddress} is linked to hospital ${checkResult.hospitalAddress}.`
                    : `⚠️ Doctor ${checkResult.doctorAddress} is NOT linked to any hospital.`)}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button, Card, Toast } from '../components/UI';
import { UserPlus, Wallet } from 'lucide-react';
import {
  signFixedMessage,
  deriveKeyFromSignature,
  generateNaClKeyPair,
  encryptNaClPrivateKey,
} from '../utils/naclCrypto';
import { registerUserOnChain, isUserRegisteredOnChain } from '../utils/blockchain';

export default function Register() {
  const { connectWallet, walletAddress } = useAuth();
  const navigate = useNavigate();

  const [role, setRole] = useState('patient');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // 1. Ensure wallet is connected
      const addr = walletAddress || (await connectWallet());
      if (!addr) throw new Error('Wallet not connected');

      // 2. Check if already registered on-chain
      setToast({ message: 'Checking registration status…', type: 'info' });
      const alreadyRegistered = await isUserRegisteredOnChain(addr);
      if (alreadyRegistered) {
        setToast({ message: 'This wallet is already registered!', type: 'error' });
        setLoading(false);
        return;
      }

      // 3. Generate NaCl keypair
      setToast({ message: 'Generating encryption keys…', type: 'info' });
      const { publicKey: naclPub, secretKey: naclSec } = generateNaClKeyPair();

      // 4. Sign the fixed message for NaCl key encryption (MetaMask popup)
      setToast({ message: 'Sign the key protection message in MetaMask…', type: 'info' });
      const keySignature = await signFixedMessage(addr);
      const derivedKey = await deriveKeyFromSignature(keySignature);

      // 5. Encrypt NaCl private key with derived key
      const { encryptedKey, iv, authTag } = await encryptNaClPrivateKey(naclSec, derivedKey);

      // 6. Pack IV + AuthTag into metadata string (pipe-separated)
      const metadata = `${iv}|${authTag}`;

      // 7. Register directly on blockchain (MetaMask popup — gas tx)
      setToast({ message: 'Confirm the registration transaction in MetaMask…', type: 'info' });
      await registerUserOnChain(role, naclPub, encryptedKey, metadata);

      setToast({ message: 'Registered successfully on the blockchain!', type: 'success' });
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      const msg = err?.reason || err?.message || 'Registration failed';
      setToast({ message: msg, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      <Card className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <UserPlus className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary">Create Account</h1>
          <p className="text-text-secondary text-sm mt-1">Join the decentralized medical record system</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Role</label>
            <select id="reg-role" value={role} onChange={(e) => setRole(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-surface-input border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40">
              <option value="patient">Patient</option>
              <option value="doctor">Doctor</option>
              <option value="diagnostics">Diagnostics Lab</option>
            </select>
          </div>

          {/* Wallet */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Ethereum Wallet</label>
            {walletAddress ? (
              <p className="flex items-center gap-1.5 text-sm text-primary font-mono">
                <Wallet className="w-4 h-4" /> {walletAddress}
              </p>
            ) : (
              <Button type="button" variant="secondary" onClick={connectWallet} className="w-full">
                <Wallet className="w-4 h-4" /> Connect MetaMask
              </Button>
            )}
          </div>

          <Button type="submit" loading={loading} className="w-full mt-2">
            <UserPlus className="w-4 h-4" /> Register
          </Button>
        </form>

        <p className="text-center text-sm text-text-muted mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-primary hover:text-primary-light transition-colors font-medium">Sign In</Link>
        </p>
      </Card>
    </div>
  );
}

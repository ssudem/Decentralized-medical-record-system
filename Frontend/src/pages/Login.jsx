import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import API from '../api/axios';
import { Button, Card, Toast } from '../components/UI';
import { LogIn, Wallet } from 'lucide-react';
import {
  signFixedMessage,
  deriveKeyFromSignature,
  decryptNaClPrivateKey,
} from '../utils/naclCrypto';

export default function Login() {
  const { login, connectWallet, walletAddress, setNaclPrivateKey, isSuperAdmin, isHospitalAdmin } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const handleLogin = async () => {
    setLoading(true);
    try {
      // 1. Ensure wallet is connected
      const addr = walletAddress || (await connectWallet());
      if (!addr) throw new Error('Wallet not connected');

      // 2. Generate timestamp-based challenge
      const timestamp = Math.floor(Date.now() / 1000);
      const challengeMsg = `Sign this message to verify your identity on MediRecord.\n\nTimestamp: ${timestamp}`;

      // 3. Sign the challenge with MetaMask (1st popup — for auth)
      setToast({ message: 'Sign the login message in MetaMask…', type: 'info' });
      const authSignature = await window.ethereum.request({
        method: 'personal_sign',
        params: [challengeMsg, addr],
      });

      // 4. Send signature + timestamp to backend for verification
      const { data } = await API.post('/auth/login', {
        ethereumAddress: addr,
        signature: authSignature,
        timestamp,
      });
      login(data); // sets token + user in AuthContext

      // 5. Sign the fixed message for NaCl key decryption (2nd popup — for encryption keys)
      setToast({ message: 'Sign the key unlock message in MetaMask…', type: 'info' });
      const keySignature = await signFixedMessage(addr);
      const derivedKey = await deriveKeyFromSignature(keySignature);

      // 6. Decrypt NaCl private key (keys come from blockchain via backend)
      const naclSecretKeyBase64 = await decryptNaClPrivateKey(
        {
          encryptedKey: data.user.encryptedNaclPrivateKey,
          iv: data.user.naclKeyIv,
          authTag: data.user.naclKeyAuthTag,
        },
        derivedKey
      );
      setNaclPrivateKey(naclSecretKeyBase64);

      // 7. Navigate to dashboard
      const dest = data.user.role === 'doctor' ? '/doctor' : data.user.role === 'diagnostics' ? '/diagnostics' : '/patient';
      navigate(dest);
    } catch (err) {
      setToast({ message: err.response?.data?.error || err.message || 'Login failed', type: 'error' });
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
            <LogIn className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary">Welcome Back</h1>
          <p className="text-text-secondary text-sm mt-1">Sign in with your MetaMask wallet</p>
        </div>

        {isSuperAdmin || isHospitalAdmin ? (
          <div className="text-center space-y-4">
            <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
              <p className="text-sm text-text-secondary">
                Your connected wallet is recognized as an authorized 
                <span className="font-semibold text-primary ml-1">
                  {isSuperAdmin ? 'Super Admin' : 'Hospital Admin'}
                </span>.
              </p>
              <p className="text-xs text-text-muted mt-2">
                No need to sign in with an account. You can proceed directly to your admin panel.
              </p>
            </div>
            
            <Button 
              onClick={() => navigate(isSuperAdmin ? '/admin' : '/hospital-admin')} 
              className="w-full"
            >
              Go to {isSuperAdmin ? 'Admin Panel' : 'Hospital Panel'}
            </Button>
          </div>
        ) : (
          <>
            {walletAddress && (
              <div className="mb-6 p-3 rounded-xl bg-surface-light border border-border">
                <p className="flex items-center gap-2 text-sm text-primary font-mono justify-center">
                  <Wallet className="w-4 h-4" /> {walletAddress}
                </p>
              </div>
            )}

            <Button onClick={handleLogin} loading={loading} className="w-full">
              <Wallet className="w-4 h-4" /> Sign In with MetaMask
            </Button>

            <p className="text-center text-sm text-text-muted mt-6">
              Don&apos;t have an account?{' '}
              <Link to="/register" className="text-primary hover:text-primary-light transition-colors font-medium">Create one</Link>
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

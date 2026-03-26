import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getSuperAdmin, isHospitalValidOnChain } from '../utils/blockchain';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]                       = useState(null);
  const [token, setToken]                     = useState(() => sessionStorage.getItem('medirecord_token'));
  const [naclPrivateKey, setNaclPrivateKey]   = useState(null);  // Base64 NaCl secret key (in memory only)
  const [walletAddress, setWalletAddress]     = useState(null);
  const [isSuperAdmin, setIsSuperAdmin]       = useState(false);
  const [isHospitalAdmin, setIsHospitalAdmin] = useState(false);

  useEffect(() => {
    if (token) sessionStorage.setItem('medirecord_token', token);
    else sessionStorage.removeItem('medirecord_token');
  }, [token]);

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) { alert('Please install MetaMask'); return null; }
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    setWalletAddress(accounts[0]);
    return accounts[0];
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    const handler = (accounts) => setWalletAddress(accounts[0] || null);
    window.ethereum.on('accountsChanged', handler);
    return () => window.ethereum.removeListener('accountsChanged', handler);
  }, []);

  /* ── Check if connected wallet is SuperAdmin or Hospital ── */
  useEffect(() => {
    if (!walletAddress) {
      setIsSuperAdmin(false);
      setIsHospitalAdmin(false);
      return;
    }
    (async () => {
      try {
        const [admin, isHosp] = await Promise.all([
          getSuperAdmin(),
          isHospitalValidOnChain(walletAddress),
        ]);
        setIsSuperAdmin(admin.toLowerCase() === walletAddress.toLowerCase());
        setIsHospitalAdmin(isHosp);
      } catch {
        setIsSuperAdmin(false);
        setIsHospitalAdmin(false);
      }
    })();
  }, [walletAddress]);

  const login = useCallback((loginResponse) => {
    setToken(loginResponse.token);
    setUser(loginResponse.user);
    if (loginResponse.user?.ethereumAddress) {
      setWalletAddress(loginResponse.user.ethereumAddress);
    }
    // NaCl private key is set separately after MetaMask signature-based decryption
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setNaclPrivateKey(null);
    sessionStorage.removeItem('medirecord_token');
  }, []);

  const value = {
    user, token,
    naclPrivateKey, setNaclPrivateKey,
    walletAddress, isSuperAdmin, isHospitalAdmin,
    connectWallet, login, logout,
    isAuthenticated: !!token && !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

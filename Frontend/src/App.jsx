import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { AlertTriangle } from 'lucide-react';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Register from './pages/Register';
import PatientDashboard from './pages/PatientDashboard';
import PatientRecords from './pages/PatientRecords';
import DoctorDashboard from './pages/DoctorDashboard';
import AdminPanel from './pages/AdminPanel';
import HospitalPanel from './pages/HospitalPanel';
import RecordViewer from './pages/RecordViewer';
import GrantAccess from './pages/GrantAccess';
import RevokeAccess from './pages/RevokeAccess';
import CreateRecord from './pages/CreateRecord';
import ViewRecords from './pages/ViewRecords';
import RequestAccess from './pages/RequestAccess';
import DiagnosticsDashboard from './pages/DiagnosticsDashboard';
import UploadDiagnostics from './pages/UploadDiagnostics';

function ProtectedRoute({ children, allowedRole }) {
  const { isAuthenticated, user, walletAddress } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  
  if (allowedRole && user?.role !== allowedRole) {
    const home = user?.role === 'doctor' ? '/doctor' : user?.role === 'diagnostics' ? '/diagnostics' : '/patient';
    return <Navigate to={home} replace />;
  }

  // Ensure active MetaMask wallet matches logged-in user account
  if (user?.ethereumAddress && walletAddress && user.ethereumAddress.toLowerCase() !== walletAddress.toLowerCase()) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 text-center animate-fade-in flex flex-col items-center justify-center min-h-[60vh]">
        <AlertTriangle className="w-16 h-16 text-warning mb-4 opacity-80" />
        <h1 className="text-3xl font-bold text-warning mb-2">Account Mismatch</h1>
        <p className="text-text-secondary">
          Your active MetaMask wallet (<span className="font-mono text-xs">{walletAddress || "None"}</span>) doesn't match your logged-in account (<span className="font-mono text-xs">{user.ethereumAddress}</span>).
        </p>
        <p className="text-text-secondary mt-2">
          Please switch back to your registered wallet in MetaMask to view this page.
        </p>
      </div>
    );
  }

  return children;
}

function AppRoutes() {
  const { isAuthenticated, user } = useAuth();

  const roleHome = user?.role === 'doctor' ? '/doctor' : user?.role === 'diagnostics' ? '/diagnostics' : '/patient';

  return (
    <Routes>
      <Route path="/login"    element={isAuthenticated ? <Navigate to={roleHome} replace /> : <Login />} />
      <Route path="/register" element={isAuthenticated ? <Navigate to={roleHome} replace /> : <Register />} />

      {/* Patient routes */}
      <Route path="/patient"              element={<ProtectedRoute allowedRole="patient"><PatientDashboard /></ProtectedRoute>} />
      <Route path="/patient/my-records"   element={<ProtectedRoute allowedRole="patient"><PatientRecords /></ProtectedRoute>} />
      <Route path="/patient/grant-access" element={<ProtectedRoute allowedRole="patient"><GrantAccess /></ProtectedRoute>} />
      <Route path="/patient/revoke-access" element={<ProtectedRoute allowedRole="patient"><RevokeAccess /></ProtectedRoute>} />

      {/* Doctor routes */}
      <Route path="/doctor"               element={<ProtectedRoute allowedRole="doctor"><DoctorDashboard /></ProtectedRoute>} />
      <Route path="/doctor/create-record" element={<ProtectedRoute allowedRole="doctor"><CreateRecord /></ProtectedRoute>} />
      <Route path="/doctor/view-records"  element={<ProtectedRoute allowedRole="doctor"><ViewRecords /></ProtectedRoute>} />
      <Route path="/doctor/request-access" element={<ProtectedRoute allowedRole="doctor"><RequestAccess /></ProtectedRoute>} />

      {/* Diagnostics lab routes */}
      <Route path="/diagnostics"                element={<ProtectedRoute allowedRole="diagnostics"><DiagnosticsDashboard /></ProtectedRoute>} />
      <Route path="/diagnostics/upload-report"  element={<ProtectedRoute allowedRole="diagnostics"><UploadDiagnostics /></ProtectedRoute>} />

      {/* Shared / admin routes */}
      <Route path="/record/:cid" element={<ProtectedRoute><RecordViewer /></ProtectedRoute>} />
      <Route path="/admin"          element={<AdminPanel />} />
      <Route path="/hospital-admin" element={<HospitalPanel />} />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <div className="min-h-screen flex flex-col">
            <Navbar />
            <main className="flex-1">
              <AppRoutes />
            </main>
          </div>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>

  );
}

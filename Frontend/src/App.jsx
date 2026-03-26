import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
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
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (allowedRole && user?.role !== allowedRole) {
    const home = user?.role === 'doctor' ? '/doctor' : user?.role === 'diagnostics' ? '/diagnostics' : '/patient';
    return <Navigate to={home} replace />;
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
      <AuthProvider>
        <div className="min-h-screen flex flex-col">
          <Navbar />
          <main className="flex-1">
            <AppRoutes />
          </main>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}

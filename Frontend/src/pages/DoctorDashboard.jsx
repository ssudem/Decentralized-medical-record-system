import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import API from "../api/axios";
import { Card, Toast } from "../components/UI";
import {
  FilePlus,
  Search,
  Mail,
  ChevronRight,
  AlertTriangle,
  Building2,
  Stethoscope,
} from "lucide-react";
import SPECIALTIES from "../constants/specialties";

export default function DoctorDashboard() {
  const { user, walletAddress } = useAuth();
  const navigate = useNavigate();

  const [toast, setToast] = useState(null);

  // ── Specialty selection ──
  const [specialty, setSpecialty] = useState(() => {
    return localStorage.getItem(`doctor_specialty_${walletAddress}`) || "general";
  });

  const handleSpecialtyChange = (e) => {
    const val = e.target.value;
    setSpecialty(val);
    localStorage.setItem(`doctor_specialty_${walletAddress}`, val);
  };

  // ── Hospital linkage check ──
  const [hospitalAddr, setHospitalAddr] = useState(null);
  const [hospitalCheckDone, setHospitalCheckDone] = useState(false);

  useEffect(() => {
    if (!walletAddress) return;
    (async () => {
      try {
        const { data } = await API.get(`/hospitals/doctor/${walletAddress}`);
        const addr = data.hospitalAddress;
        const isLinked =
          addr && addr !== "0x0000000000000000000000000000000000000000";
        setHospitalAddr(isLinked ? addr : null);
      } catch {
        setHospitalAddr(null);
      } finally {
        setHospitalCheckDone(true);
      }
    })();

    // Clear doctor view-records cache when returning to dashboard
    sessionStorage.removeItem('doctor_view_cache');
    sessionStorage.removeItem('doctor_view_last_params');
  }, [walletAddress]);

  /* ── Quick action items ── */
  const quickActions = [
    {
      title: "Create Medical Record",
      description:
        "Look up a patient and create a new encrypted medical record",
      icon: FilePlus,
      color: "primary",
      path: "/doctor/create-record",
    },
    {
      title: "View Patient Records",
      description:
        "Search and view patient records you have been granted access to",
      icon: Search,
      color: "accent",
      path: "/doctor/view-records",
    },
    {
      title: "Request Access",
      description: "Send an access request to a patient for approval",
      icon: Mail,
      color: "warning",
      path: "/doctor/request-access",
    },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8 animate-fade-in">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* ── Hospital warning ── */}
      {hospitalCheckDone && !hospitalAddr && (
        <div className="p-4 rounded-xl bg-warning/5 border border-warning/30 flex items-start gap-3 animate-fade-in">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-warning">
              Not linked to any hospital
            </p>
            <p className="text-xs text-text-secondary mt-1">
              Your wallet is not authorized by any hospital on the blockchain.
              You cannot upload records until a hospital admin authorizes you.
              Visit the{" "}
              <a
                href="/admin"
                className="text-primary hover:underline font-medium"
              >
                Admin Panel
              </a>{" "}
              or contact your hospital administrator.
            </p>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div>
        <h1 className="text-3xl font-bold bg-linear-to-r from-primary to-accent bg-clip-text text-transparent">
          Doctor Dashboard
        </h1>
        <div className="flex items-center gap-3 mt-1">
          <p className="text-text-secondary text-sm flex items-center gap-2">
            Welcome, Dr. {walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'Doctor'}
          </p>
          <div className="flex items-center gap-2 border-l border-border pl-3">
            <Stethoscope className="w-4 h-4 text-text-muted" />
            <select
              value={specialty}
              onChange={handleSpecialtyChange}
              className="px-2 py-1 text-sm rounded-lg bg-surface border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
            >
              <option value="" disabled>Select Specialty</option>
              {SPECIALTIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          {hospitalAddr && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-success/10 text-success text-xs font-medium border-l border-border pl-3 ml-1">
              <Building2 className="w-3 h-3" /> Hospital:{" "}
              {hospitalAddr.slice(0, 6)}…{hospitalAddr.slice(-4)}
            </span>
          )}
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <section>
        <h2 className="text-lg font-semibold text-text-primary mb-4">
          Quick Actions
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {quickActions.map((action) => (
            <button
              key={action.path}
              onClick={() => navigate(action.path)}
              className={`group flex items-center gap-4 p-5 rounded-2xl bg-surface-card border border-border
                hover:border-${action.color}/40 hover:shadow-lg hover:shadow-${action.color}/5 transition-all duration-200 text-left cursor-pointer`}
            >
              <div className={`p-3 rounded-xl bg-${action.color}/10`}>
                <action.icon className={`w-6 h-6 text-${action.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-text-primary group-hover:text-primary transition-colors">
                  {action.title}
                </p>
                <p className="text-xs text-text-secondary mt-0.5">
                  {action.description}
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-text-muted group-hover:text-primary transition-colors shrink-0" />
            </button>
          ))}
        </div>
      </section>

      {/* ── Overview Stats ── */}
      <section>
        <Card className="text-center py-10">
          <p className="text-text-secondary text-sm">
            Use the quick actions above to create records, search patient
            records, or request access from patients.
          </p>
        </Card>
      </section>
    </div>
  );
}

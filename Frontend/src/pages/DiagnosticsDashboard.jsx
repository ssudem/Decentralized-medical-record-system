import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import API from "../api/axios";
import { Card, Toast } from "../components/UI";
import UserAddress from "../components/UserAddress";
import {
  Upload,
  ChevronRight,
  AlertTriangle,
  Building2,
  FlaskConical,
} from "lucide-react";
import { getDiagnosticsLabHospital } from "../utils/blockchain";
import useDiagnosticsAuth from "../utils/useDiagnosticsAuth";

export default function DiagnosticsDashboard() {
  const { user, walletAddress } = useAuth();
  const navigate = useNavigate();

  const [toast, setToast] = useState(null);

  // ── Hospital linkage check ──
  const { isAuthorized: isHospitalLinked, hospitalAddr, loading: hospitalCheckDoneLoading } = useDiagnosticsAuth(walletAddress);
  const hospitalCheckDone = !hospitalCheckDoneLoading;

  /* ── Quick action items ── */
  const quickActions = [
    {
      title: "Upload Diagnostics Report",
      description:
        "Upload a PDF report (X-ray, MRI, blood test) with JSON lab data for a patient",
      icon: Upload,
      color: "primary",
      path: "/diagnostics/upload-report",
    },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8 animate-fade-in">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* ── Hospital warning ── */}
      {hospitalCheckDone && !isHospitalLinked && (
        <div className="p-4 rounded-xl bg-warning/5 border border-warning/30 flex items-start gap-3 animate-fade-in">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-warning">
              Not linked to any hospital
            </p>
            <p className="text-xs text-text-secondary mt-1">
              Your wallet is not authorized by any hospital on the blockchain.
              You cannot upload reports until a hospital admin authorizes your
              diagnostics lab. Contact your hospital administrator.
            </p>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div>
        <h1 className="text-3xl font-bold bg-linear-to-r from-primary to-accent bg-clip-text text-transparent">
          Diagnostics Lab Dashboard
        </h1>
        <div className="flex items-center gap-3 mt-1">
          <p className="text-text-secondary text-sm flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-accent" />
            Welcome, {user?.name || (walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'Lab')}
          </p>
          {isHospitalLinked && hospitalAddr && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-success/10 text-success text-xs font-medium border-l border-border pl-3 ml-1">
              <Building2 className="w-3 h-3" /> Hospital:{" "}
              <UserAddress address={hospitalAddr} />
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

      {/* ── Overview ── */}
      <section>
        <Card className="text-center py-10 !border-surface-input">
          <p className="text-text-secondary text-sm">
            Use the quick action above to upload encrypted diagnostics reports
            for patients. Reports are encrypted with the patient&apos;s public key
            and stored on IPFS.
          </p>
        </Card>
      </section>
    </div>
  );
}


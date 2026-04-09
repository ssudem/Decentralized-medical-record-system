import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card, Button } from '../components/UI';
import { ArrowLeft, User, Stethoscope, Droplets, Activity, ClipboardList, Clock, FileText, FileDown, FlaskConical } from 'lucide-react';

export default function RecordViewer() {
  const { state } = useLocation();
  const navigate = useNavigate();

  // If accessed directly without state, go back
  if (!state || !state.recordData) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-text-primary mb-4">No Record Data Found</h2>
        <Button onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /> Go Back</Button>
      </div>
    );
  }

  const { record, metadata, cid, timestamp, pdfBase64, issuedByDoctor, issuedByLab } = state.recordData;
  const isDoctor = state.isDoctor || false;

  const DetailRow = ({ icon: Icon, label, value, colSpan = false }) => {
    if (!value) return null;
    return (
      <div className={`p-4 rounded-xl bg-surface border border-border flex items-start gap-4 ${colSpan ? 'md:col-span-2' : ''}`}>
        <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0 mt-0.5">
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-text-secondary mb-1">{label}</p>
          <div className="text-sm text-text-primary whitespace-pre-wrap">{value}</div>
        </div>
      </div>
    );
  };

  const VitalsGrid = ({ vitals }) => {
    if (!vitals || Object.keys(vitals).length === 0) return null;
    const icons = {
      'Heart Rate': Activity,
      'Blood Pressure': Activity,
      'Temperature': Activity,
      'Weight': User,
    };
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:col-span-2">
        {Object.entries(vitals).map(([key, val]) => {
          const VIcon = icons[key] || Activity;
          return (
            <div key={key} className="p-3 rounded-xl bg-surface border border-border flex flex-col items-center justify-center text-center gap-2">
              <VIcon className="w-5 h-5 text-accent" />
              <div>
                <p className="text-xs text-text-secondary">{key}</p>
                <p className="text-sm font-bold text-text-primary">{val}</p>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6 animate-fade-in">
      {/* ── Top Nav ── */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" className="pl-0 hover:bg-transparent hover:text-primary transition-colors" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5 mr-1" /> Back to Dashboard
        </Button>
        <span className="text-xs font-mono text-text-muted bg-surface-light px-3 py-1.5 rounded-full border border-border">
          CID: {cid.slice(0, 8)}…{cid.slice(-6)}
        </span>
      </div>

      {/* ── Header Card ── */}
      <Card className="bg-gradient-to-br from-surface-card to-surface-light border-primary/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
        
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-text-primary">{record.patientName || 'Unknown Patient'}</h1>
              <span className="px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-bold uppercase tracking-wider">
                {record.recordType || metadata?.recordType || 'Medical Record'}
              </span>
            </div>
            
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 text-sm text-text-secondary">
              <div className="flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-primary" />
                <span>Specialty: <strong className="text-text-primary">{record.specialty || metadata?.specialty || 'General'}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                <span>Date: <strong className="text-text-primary">{new Date(record.createdAt || Number(timestamp)*1000).toLocaleString()}</strong></span>
              </div>
              {/* ── Issued By ── */}
              {(() => {
                const ZERO = "0x0000000000000000000000000000000000000000";
                const docAddr = (issuedByDoctor && issuedByDoctor !== ZERO) ? issuedByDoctor
                  : (metadata?.doctorAddress || record?.doctorAddress || null);
                const labAddr = (issuedByLab && issuedByLab !== ZERO) ? issuedByLab
                  : (metadata?.labAddress || null);
                return (
                  <>
                    {docAddr && (
                      <div className="flex items-center gap-2">
                        <Stethoscope className="w-4 h-4 text-success" />
                        <span>Doctor: <strong className="font-mono text-text-primary">{docAddr.slice(0, 6)}…{docAddr.slice(-4)}</strong></span>
                      </div>
                    )}
                    {labAddr && (
                      <div className="flex items-center gap-2">
                        <FlaskConical className="w-4 h-4 text-accent" />
                        <span>Lab: <strong className="font-mono text-text-primary">{labAddr.slice(0, 6)}…{labAddr.slice(-4)}</strong></span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {metadata?.tags?.length > 0 && (
            <div className="flex-shrink-0 max-w-xs">
              <p className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wider">Tags</p>
              <div className="flex flex-wrap gap-2">
                {metadata.tags.map(t => (
                  <span key={t} className="px-2.5 py-1 rounded-md bg-surface border border-border text-text-primary text-xs font-medium shadow-sm">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ── Details Grid ── */}
      <Card>
        <h2 className="text-lg font-bold text-text-primary mb-6 flex items-center gap-2 border-b border-border pb-4">
          <FileText className="w-5 h-5 text-accent" /> Clinical Details
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <VitalsGrid vitals={record.vitalSigns} />
          
          <DetailRow icon={ClipboardList} label="Diagnosis" value={record.diagnosis} colSpan={true} />
          <DetailRow icon={Stethoscope} label="Symptoms" value={record.symptoms} />
          <DetailRow icon={Activity} label="Prescription" value={record.prescription} />
          <DetailRow icon={Droplets} label="Lab Results" value={record.labResults} colSpan={true} />
          
          {/* Lab Report specific fields (from Diagnostics Upload) */}
          {record.testName && <DetailRow icon={FlaskConical} label="Test Name" value={record.testName} colSpan={true} />}
          {record.result && <DetailRow icon={Activity} label="Result" value={`${record.result} ${record.unit || ''}`} />}
          {record.referenceRange && <DetailRow icon={Activity} label="Reference Range" value={record.referenceRange} />}
          
          {(record.followUp || record.notes) && (
            <div className="md:col-span-2 mt-4 space-y-4 pt-4 border-t border-border/50">
              <DetailRow icon={Clock} label="Follow Up Plan" value={record.followUp} colSpan={true} />
              <DetailRow icon={FileText} label="Additional Notes" value={record.notes} colSpan={true} />
            </div>
          )}
        </div>
      </Card>
      
      {/* ── PDF Viewer (Diagnostics) ── */}
      {pdfBase64 && (
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
              <FileDown className="w-5 h-5 text-accent" /> Attached Document
            </h2>
            <Button variant="secondary" onClick={() => {
              // Convert base64 to blob and open in new tab
              const byteChars = atob(pdfBase64);
              const byteArray = new Uint8Array(byteChars.length);
              for (let i = 0; i < byteChars.length; i++) {
                byteArray[i] = byteChars.charCodeAt(i);
              }
              const blob = new Blob([byteArray], { type: 'application/pdf' });
              const url = URL.createObjectURL(blob);
              window.open(url, '_blank');
            }}>
              <FileDown className="w-4 h-4" /> Open PDF in New Tab
            </Button>
          </div>
        </Card>
      )}
      
      {/* ── Raw JSON Fallback (Bottom) ── */}
      <details className="mt-8 group">
        <summary className="text-sm font-medium text-text-muted hover:text-text-primary cursor-pointer transition-colors flex items-center gap-2 select-none">
          <span className="w-4 h-4 rounded bg-surface border border-border flex items-center justify-center group-open:bg-primary group-open:border-primary group-open:text-white transition-colors">
            <span className="text-[10px] transform group-open:rotate-90 transition-transform">▶</span>
          </span>
          View Raw Decrypted JSON
        </summary>
        <div className="mt-4 p-4 rounded-xl bg-[#0d1117] border border-border overflow-x-auto shadow-inner">
          <pre className="text-xs text-[#c9d1d9] font-mono leading-relaxed">
            {JSON.stringify(record, null, 2)}
          </pre>
        </div>
      </details>
    </div>
  );
}

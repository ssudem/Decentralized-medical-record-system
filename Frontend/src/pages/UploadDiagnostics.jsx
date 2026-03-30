import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import API from "../api/axios";
import { addRecordLabOnChain } from "../utils/blockchain";
import { Card, Button, Input, Toast } from "../components/UI";
import { Upload, ArrowLeft, FileText, FlaskConical, FileUp } from "lucide-react";
import { encryptAESKeyWithNaCl } from "../utils/naclCrypto";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

export default function UploadDiagnostics() {
  const { walletAddress, naclPrivateKey } = useAuth();
  const navigate = useNavigate();

  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);

  // Form state
  const [patientAddress, setPatientAddress] = useState("");
  const [patientName, setPatientName] = useState("");
  const [pdfFile, setPdfFile] = useState(null);
  const [recordType, setRecordType] = useState("diagnostics_report");
  const [tags, setTags] = useState("diagnostics");

  // Upload mode toggle
  const [uploadMode, setUploadMode] = useState("upload"); // 'upload' | 'form'

  // Lab report JSON fields
  const [testName, setTestName] = useState("");
  const [result, setResult] = useState("");
  const [unit, setUnit] = useState("");
  const [referenceRange, setReferenceRange] = useState("");
  const [notes, setNotes] = useState("");

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type === "application/pdf") {
      setPdfFile(file);
    } else {
      setToast({ message: "Only PDF files are allowed", type: "error" });
      e.target.value = "";
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!patientAddress) {
      setToast({ message: "Patient address is required", type: "error" });
      return;
    }
    if (uploadMode === "upload" && !pdfFile) {
      setToast({ message: "Please select a PDF file to upload", type: "error" });
      return;
    }
    if (uploadMode === "form" && (!testName || !result)) {
      setToast({ message: "Test Name and Result are required in form mode", type: "error" });
      return;
    }

    setLoading(true);
    try {
      // Build lab report JSON
      const labReport = {
        patientName,
        testName,
        result,
        unit,
        referenceRange,
        notes,
        labWallet: walletAddress,
        uploadedAt: new Date().toISOString(),
      };

      // Build FormData for multipart upload
      const formData = new FormData();
      formData.append("pdfFile", pdfFile);
      formData.append("patientAddress", patientAddress);
      formData.append("labReport", JSON.stringify(labReport));
      formData.append("recordType", recordType);
      formData.append("tags", JSON.stringify(tags.split(",").map((t) => t.trim()).filter(Boolean)));

      // 1. Upload to backend (encrypts + stores on IPFS)
      setToast({ message: "Encrypting and uploading to IPFS…", type: "info" });
      const { data } = await API.post("/diagnostics/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      if (!data.success || !data.cid) {
        throw new Error(data.error || "Upload failed");
      }

      // 1b. Encrypt AES key for the patient using lab's NaCl key
      setToast({ message: "Securing encryption key for patient…", type: "info" });
      if (!naclPrivateKey) throw new Error("Lab encryption keys not available. Re-login.");

      const aesKeyBytes = Uint8Array.from(atob(data.aesKeyBase64), c => c.charCodeAt(0));
      const { encryptedKey, nonce: encNonce } = encryptAESKeyWithNaCl(
        aesKeyBytes,
        data.patientNaClPublicKey,  // returned by the backend
        naclPrivateKey
      );

      // Derive lab's NaCl public key from private key
      const labSecKey = naclUtil.decodeBase64(naclPrivateKey);
      const labPubKey = naclUtil.encodeBase64(
        nacl.box.keyPair.fromSecretKey(labSecKey).publicKey
      );

      await API.post('/access/store-key', {
        cid: data.cid,
        userAddress: patientAddress,
        encryptedAESKey: encryptedKey,
        nonce: encNonce,
        senderNaClPublicKey: labPubKey,
      });

      // 2. Register CID on blockchain via MetaMask
      setToast({ message: "Confirm the blockchain transaction in MetaMask…", type: "info" });
      await addRecordLabOnChain(patientAddress, data.cid);

      setToast({
        message: `Report uploaded successfully! CID: ${data.cid.slice(0, 12)}…`,
        type: "success",
      });

      // Reset form
      setPatientAddress("");
      setPatientName("");
      setPdfFile(null);
      setTestName("");
      setResult("");
      setUnit("");
      setReferenceRange("");
      setNotes("");
    } catch (err) {
      const msg = err?.response?.data?.error || err?.reason || err?.message || "Upload failed";
      setToast({ message: msg, type: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6 animate-fade-in">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/diagnostics")}
          className="p-2 rounded-lg hover:bg-surface-light text-text-muted hover:text-primary transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <FlaskConical className="w-6 h-6 text-accent" />
            Upload Diagnostics Report
          </h1>
          <p className="text-text-secondary text-sm mt-0.5">
            Encrypt and upload a report with lab data for a patient
          </p>
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="flex rounded-xl border border-border overflow-hidden w-fit">
        <button type="button"
          onClick={() => setUploadMode('upload')}
          className={`px-5 py-2.5 text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer
            ${uploadMode === 'upload' ? 'bg-primary text-white' : 'bg-surface-card text-text-secondary hover:text-text-primary'}`}>
          <FileUp className="w-4 h-4" /> Upload PDF
        </button>
        <button type="button"
          onClick={() => { setUploadMode('form'); setPdfFile(null); }}
          className={`px-5 py-2.5 text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer
            ${uploadMode === 'form' ? 'bg-primary text-white' : 'bg-surface-card text-text-secondary hover:text-text-primary'}`}>
          <FileText className="w-4 h-4" /> Fill Form
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Patient Info */}
        <Card>
          <h2 className="text-lg font-semibold text-text-primary mb-4">Patient Information</h2>
          <div className="space-y-4">
            <Input
              id="diag-patient-name"
              label="Patient Name"
              placeholder="e.g. John Doe"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              required
            />
            <Input
              id="diag-patient"
              label="Patient Ethereum Address"
              placeholder="0x…"
              value={patientAddress}
              onChange={(e) => setPatientAddress(e.target.value)}
              required
            />
          </div>
        </Card>

        {/* PDF Upload — only in upload mode */}
        {uploadMode === 'upload' && (
        <Card>
          <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            PDF Report
          </h2>
          <div className="space-y-3">
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              Select PDF File (X-ray, MRI, Blood Test, etc.)
            </label>
            <div className="relative">
              <input
                id="diag-pdf"
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileChange}
                className="block w-full text-sm text-text-secondary file:mr-4 file:py-2.5 file:px-4
                  file:rounded-xl file:border-0 file:text-sm file:font-semibold
                  file:bg-primary/10 file:text-primary hover:file:bg-primary/20
                  file:cursor-pointer file:transition-colors
                  rounded-xl border border-border bg-surface-input p-2"
              />
            </div>
            {pdfFile && (
              <p className="text-xs text-success flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                {pdfFile.name} ({(pdfFile.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>
        </Card>
        )}

        {/* Lab Report JSON Fields */}
        <Card>
          <h2 className="text-lg font-semibold text-text-primary mb-4">Lab Report Data</h2>
          <div className="space-y-4">
            <Input id="diag-test" label="Test Name" placeholder="e.g. Complete Blood Count (CBC)"
              value={testName} onChange={(e) => setTestName(e.target.value)} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input id="diag-result" label="Result" placeholder="e.g. 12.5"
                value={result} onChange={(e) => setResult(e.target.value)} />
              <Input id="diag-unit" label="Unit" placeholder="e.g. g/dL"
                value={unit} onChange={(e) => setUnit(e.target.value)} />
              <Input id="diag-ref" label="Reference Range" placeholder="e.g. 12.0 – 16.0"
                value={referenceRange} onChange={(e) => setReferenceRange(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Notes</label>
              <textarea
                id="diag-notes"
                rows={3}
                placeholder="Additional observations or comments…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-surface-input border border-border text-text-primary
                  focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
              />
            </div>
          </div>
        </Card>

        {/* Metadata */}
        <Card>
          <h2 className="text-lg font-semibold text-text-primary mb-4">Record Metadata</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Record Type</label>
              <select
                id="diag-type"
                value={recordType}
                onChange={(e) => setRecordType(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-surface-input border border-border text-text-primary
                  focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="diagnostics_report">Diagnostics Report</option>
                <option value="xray">X-Ray</option>
                <option value="mri">MRI</option>
                <option value="ct_scan">CT Scan</option>
                <option value="blood_test">Blood Test</option>
                <option value="urinalysis">Urinalysis</option>
                <option value="pathology">Pathology</option>
              </select>
            </div>
            <Input
              id="diag-tags"
              label="Tags (comma separated)"
              placeholder="diagonostics, blood_test, CBC"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>
        </Card>

        {/* Submit */}
        <Button type="submit" loading={loading} className="w-full">
          <Upload className="w-4 h-4" />
          Encrypt & Upload Report
        </Button>
      </form>
    </div>
  );
}

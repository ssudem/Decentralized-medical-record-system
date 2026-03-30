import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import API from "../api/axios";
import { addRecordOnChain } from "../utils/blockchain";
import { Card, Button, Input, Toast } from "../components/UI";
import { Upload, ArrowLeft, X, FileText, FileUp } from "lucide-react";
import OPERATIONS from "../constants/operations";
import SPECIALTIES from "../constants/specialties";
import { encryptAESKeyWithNaCl } from "../utils/naclCrypto";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

export default function CreateRecord() {
  const { walletAddress, naclPrivateKey } = useAuth();
  const navigate = useNavigate();

  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);

  // ── Patient identity ──
  const [patientAddress, setPatientAddress] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientAge, setPatientAge] = useState("");
  const [patientGender, setPatientGender] = useState("");
  const [bloodGroup, setBloodGroup] = useState("");
  const [allergies, setAllergies] = useState("");

  // ── Clinical ──
  const [recordType, setRecordType] = useState("consultation");
  const [specialty, setSpecialty] = useState("");
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [treatment, setTreatment] = useState("");
  const [prescription, setPrescription] = useState("");
  const [labResults, setLabResults] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [notes, setNotes] = useState("");

  // ── Vitals ──
  const [bp, setBp] = useState("");
  const [pulse, setPulse] = useState("");
  const [temperature, setTemperature] = useState("");
  const [weight, setWeight] = useState("");

  // ── Tags ──
  const [selectedOps, setSelectedOps] = useState([]);
  const [customTags, setCustomTags] = useState("");
  const [medicalTags, setMedicalTags] = useState({});

  // ── Upload mode toggle ──
  const [uploadMode, setUploadMode] = useState("form"); // 'form' | 'pdf'
  const [pdfFile, setPdfFile] = useState(null);

  // Fetch operation → tag mapping from backend (single source of truth)
  useEffect(() => {
    API.get("/config/operation-tags")
      .then(({ data }) => setMedicalTags(data))
      .catch(() => console.warn("Could not load operation tags"));
  }, []);

  const toggleOp = (val) =>
    setSelectedOps((prev) =>
      prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val],
    );

  const selectedTags = [
    ...new Set(selectedOps.flatMap((op) => medicalTags[op] || [])),
  ];

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!patientAddress) {
      setToast({ message: "Patient address is required", type: "error" });
      return;
    }
    if (uploadMode === "pdf" && !pdfFile) {
      setToast({
        message: "Please select a PDF file to upload",
        type: "error",
      });
      return;
    }
    if (uploadMode === "form" && selectedOps.length === 0) {
      setToast({
        message: "At least one operation is required",
        type: "error",
      });
      return;
    }

    setLoading(true);
    try {
      // 1. Fetch patient's NaCl public key
      setToast({ message: "Fetching patient encryption key…", type: "info" });
      const { data: pkData } = await API.get(
        `/auth/public-key/${patientAddress}`,
      );
      const patientNaClPublicKey = pkData.user.naclPublicKey;
      if (!patientNaClPublicKey)
        throw new Error("Patient has no NaCl public key registered");

      // 2. Build tags
      const allTags = [
        ...selectedTags,
        ...customTags
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
      ];
      if (allTags.length === 0) allTags.push(recordType);

      // 3. Build vitals (only include non-empty values)
      const vitalSigns = {};
      if (bp) vitalSigns["Blood Pressure"] = bp;
      if (pulse) vitalSigns["Heart Rate"] = `${pulse} bpm`;
      if (temperature) vitalSigns["Temperature"] = `${temperature} °C`;
      if (weight) vitalSigns["Weight"] = `${weight} kg`;

      // 4. Build full record
      const record = {
        // Patient identity
        patientName,
        patientAge: patientAge ? Number(patientAge) : undefined,
        patientGender,
        bloodGroup,
        allergies,
        // Clinical
        recordType,
        specialty: specialty || "general",
        chiefComplaint,
        symptoms,
        diagnosis,
        treatment,
        prescription,
        labResults,
        followUp,
        notes,
        // Vitals
        vitalSigns: Object.keys(vitalSigns).length > 0 ? vitalSigns : undefined,
        // Meta
        tags: allTags,
        operations: selectedOps,
        createdAt: new Date().toISOString(),
        doctorAddress: walletAddress,
      };

      // 5. Upload to backend
      setToast({ message: "Encrypting and uploading record…", type: "info" });

      let data;
      if (pdfFile) {
        // Use FormData when a PDF is attached
        const formData = new FormData();
        formData.append("pdfFile", pdfFile);
        formData.append("patientAddress", patientAddress);
        formData.append("patientNaClPublicKey", patientNaClPublicKey);
        formData.append("doctorAddress", walletAddress);
        formData.append("record", JSON.stringify(record));
        const resp = await API.post("/records", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        data = resp.data;
      } else {
        const resp = await API.post("/records", {
          patientAddress,
          patientNaClPublicKey,
          doctorAddress: walletAddress,
          record,
        });
        data = resp.data;
      }
      if (!data.success || !data.cid)
        throw new Error(data.error || "Upload failed");

      // 5b. Encrypt AES key for the patient using doctor's NaCl key
      setToast({
        message: "Securing encryption key for patient…",
        type: "info",
      });
      if (!naclPrivateKey)
        throw new Error("Doctor encryption keys not available. Re-login.");

      const aesKeyBytes = Uint8Array.from(atob(data.aesKeyBase64), (c) =>
        c.charCodeAt(0),
      );
      const { encryptedKey, nonce: encNonce } = encryptAESKeyWithNaCl(
        aesKeyBytes,
        patientNaClPublicKey,
        naclPrivateKey,
      );

      // Derive doctor's NaCl public key from private key
      const doctorSecKey = naclUtil.decodeBase64(naclPrivateKey);
      const doctorPubKey = naclUtil.encodeBase64(
        nacl.box.keyPair.fromSecretKey(doctorSecKey).publicKey,
      );

      await API.post("/access/store-key", {
        cid: data.cid,
        userAddress: patientAddress,
        encryptedAESKey: encryptedKey,
        nonce: encNonce,
        senderNaClPublicKey: doctorPubKey,
      });

      // 6. Register CID on blockchain
      setToast({
        message: "Confirm the blockchain transaction in MetaMask…",
        type: "info",
      });
      await addRecordOnChain(patientAddress, data.cid);

      setToast({
        message: `Record created! CID: ${data.cid.slice(0, 12)}…`,
        type: "success",
      });

      // Reset
      setPatientAddress("");
      setPatientName("");
      setPatientAge("");
      setPatientGender("");
      setBloodGroup("");
      setAllergies("");
      setChiefComplaint("");
      setSymptoms("");
      setDiagnosis("");
      setTreatment("");
      setPrescription("");
      setLabResults("");
      setFollowUp("");
      setNotes("");
      setBp("");
      setPulse("");
      setTemperature("");
      setWeight("");
      setSelectedOps([]);
      setSpecialty("");
      setCustomTags("");
      setPdfFile(null);
    } catch (err) {
      setToast({
        message:
          err?.response?.data?.error || err?.reason || err?.message || "Failed",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6 animate-fade-in">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <button
        onClick={() => navigate("/doctor")}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div>
        <h1 className="text-3xl font-bold bg-linear-to-r from-primary to-accent bg-clip-text text-transparent">
          Create Medical Record
        </h1>
        <p className="text-text-secondary text-sm mt-1">
          All fields are encrypted before leaving your browser
        </p>
      </div>

      {/* ─── Mode Toggle ─── */}
      <div className="flex rounded-xl border border-border overflow-hidden w-fit">
        <button
          type="button"
          onClick={() => {
            setUploadMode("form");
            setPdfFile(null);
          }}
          className={`px-5 py-2.5 text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer
            ${uploadMode === "form" ? "bg-primary text-white" : "bg-surface-card text-text-secondary hover:text-text-primary"}`}
        >
          <FileText className="w-4 h-4" /> Fill Form
        </button>
        <button
          type="button"
          onClick={() => setUploadMode("pdf")}
          className={`px-5 py-2.5 text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer
            ${uploadMode === "pdf" ? "bg-primary text-white" : "bg-surface-card text-text-secondary hover:text-text-primary"}`}
        >
          <FileUp className="w-4 h-4" /> Upload PDF Report
        </button>
      </div>

      <form onSubmit={handleCreate} className="space-y-6">
        {/* ─── Patient Identity ─── */}
        <Card>
          <h2 className="text-lg font-semibold text-text-primary mb-4">
            Patient Information
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Input
                id="cr-addr"
                label="Patient Ethereum Address *"
                placeholder="0x…"
                value={patientAddress}
                onChange={(e) => setPatientAddress(e.target.value)}
                required
              />
            </div>
            <Input
              id="cr-name"
              label="Patient Full Name"
              placeholder="e.g. Aisha Khan"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
            />
            <Input
              id="cr-age"
              label="Age"
              type="number"
              placeholder="e.g. 34"
              value={patientAge}
              onChange={(e) => setPatientAge(e.target.value)}
            />
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                Gender
              </label>
              <select
                id="cr-gender"
                value={patientGender}
                onChange={(e) => setPatientGender(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-surface-input border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Select…</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                Blood Group
              </label>
              <select
                id="cr-blood"
                value={bloodGroup}
                onChange={(e) => setBloodGroup(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-surface-input border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Select…</option>
                {["A+", "A−", "B+", "B−", "AB+", "AB−", "O+", "O−"].map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <Input
                id="cr-allergy"
                label="Known Allergies"
                placeholder="e.g. Penicillin, Shellfish (or 'None')"
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
              />
            </div>
          </div>
        </Card>

        {/* ─── PDF Upload (only in pdf mode) ─── */}
        {uploadMode === "pdf" && (
          <Card>
            <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
              <FileUp className="w-5 h-5 text-primary" /> Attach PDF Document
            </h2>
            <div className="space-y-3">
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                Select PDF File (Prescription, X-ray, Report, etc.)
              </label>
              <div className="relative">
                <input
                  id="cr-pdf"
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (file && file.type === "application/pdf") {
                      setPdfFile(file);
                    } else {
                      setToast({
                        message: "Only PDF files are allowed",
                        type: "error",
                      });
                      e.target.value = "";
                    }
                  }}
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

        {/* ─── Vitals (form mode only) ─── */}
        {uploadMode === "form" && (
          <Card>
            <h2 className="text-lg font-semibold text-text-primary mb-4">
              Vital Signs
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Input
                id="cr-bp"
                label="Blood Pressure"
                placeholder="120/80 mmHg"
                value={bp}
                onChange={(e) => setBp(e.target.value)}
              />
              <Input
                id="cr-hr"
                label="Heart Rate (bpm)"
                placeholder="72"
                value={pulse}
                onChange={(e) => setPulse(e.target.value)}
              />
              <Input
                id="cr-temp"
                label="Temperature (°C)"
                placeholder="37.0"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
              />
              <Input
                id="cr-wt"
                label="Weight (kg)"
                placeholder="65"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </div>
          </Card>
        )}

        {/* ─── Record Metadata (always visible) ─── */}
        <Card>
          <h2 className="text-lg font-semibold text-text-primary mb-4">
            Record Metadata
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                Record Type
              </label>
              <select
                id="cr-type"
                value={recordType}
                onChange={(e) => setRecordType(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-surface-input border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="consultation">Consultation</option>
                <option value="lab_result">Lab Result</option>
                <option value="prescription">Prescription</option>
                <option value="imaging">Imaging</option>
                <option value="discharge_summary">Discharge Summary</option>
                <option value="follow_up">Follow-Up</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                Specialty
              </label>
              <select
                id="cr-specialty"
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-surface-input border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Select specialty…</option>
                {SPECIALTIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        {/* ─── Clinical Details (form mode only) ─── */}
        {uploadMode === "form" && (
          <Card>
            <h2 className="text-lg font-semibold text-text-primary mb-4">
              Clinical Details
            </h2>
            <div className="space-y-4">
              <Input
                id="cr-cc"
                label="Chief Complaint"
                placeholder="e.g. Chest pain since 2 days"
                value={chiefComplaint}
                onChange={(e) => setChiefComplaint(e.target.value)}
              />

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  Symptoms
                </label>
                <textarea
                  id="cr-sym"
                  rows={2}
                  placeholder="e.g. Fatigue, excessive thirst, frequent urination…"
                  value={symptoms}
                  onChange={(e) => setSymptoms(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-surface-input border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                />
              </div>

              <Input
                id="cr-diag"
                label="Diagnosis"
                placeholder="e.g. Type-2 Diabetes Mellitus"
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
              />

              <Input
                id="cr-treat"
                label="Treatment Plan"
                placeholder="e.g. Metformin 500mg twice daily"
                value={treatment}
                onChange={(e) => setTreatment(e.target.value)}
              />

              <Input
                id="cr-rx"
                label="Prescription"
                placeholder="e.g. Metformin 500mg, Paracetamol 650mg"
                value={prescription}
                onChange={(e) => setPrescription(e.target.value)}
              />

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  Lab Results
                </label>
                <textarea
                  id="cr-lab"
                  rows={2}
                  placeholder="e.g. HbA1c: 8.2%, FBS: 180 mg/dL…"
                  value={labResults}
                  onChange={(e) => setLabResults(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-surface-input border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                />
              </div>

              <Input
                id="cr-fu"
                label="Follow-Up Plan"
                placeholder="e.g. Review in 4 weeks, repeat HbA1c"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
              />

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  Additional Notes
                </label>
                <textarea
                  id="cr-notes"
                  rows={2}
                  placeholder="Any other clinical observations…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-surface-input border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                />
              </div>
            </div>
          </Card>
        )}

        {/* ─── Operations / Tags ─── */}
        <Card>
          <h2 className="text-lg font-semibold text-text-primary mb-4">
            Operations & Tags *
          </h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {OPERATIONS.map((op) => {
              const active = selectedOps.includes(op.value);
              return (
                <button
                  key={op.value}
                  type="button"
                  onClick={() => toggleOp(op.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer
                    ${active ? "bg-primary text-white border-primary" : "bg-surface border-border text-text-secondary hover:border-primary/50"}`}
                >
                  {active && <X className="w-3 h-3 inline mr-1" />}
                  {op.label}
                </button>
              );
            })}
          </div>
          {selectedTags.length > 0 && (
            <div className="mb-3">
              <span className="text-xs text-text-muted">Auto-tags: </span>
              {selectedTags.map((t) => (
                <span
                  key={t}
                  className="inline-block px-2 py-0.5 mr-1 mb-1 rounded-md bg-primary/10 text-primary text-xs"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          <Input
            id="cr-tags"
            label="Extra Tags (comma separated)"
            placeholder="HbA1c, fasting, followup"
            value={customTags}
            onChange={(e) => setCustomTags(e.target.value)}
          />
        </Card>

        <Button type="submit" loading={loading} className="w-full">
          <Upload className="w-4 h-4" /> Encrypt & Upload Record
        </Button>
      </form>
    </div>
  );
}

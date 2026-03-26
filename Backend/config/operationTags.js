/**
 * ============================================================
 *  config/operationTags.js
 *  Maps smart-contract operations to filterable record tags
 * ============================================================
 *
 *  CALLER OVERVIEW
 *  ───────────────
 *  OPERATION_TAG_MAP  → read by isRecordRelevant(); no direct HTTP caller
 *  isRecordRelevant() → called by the BACKEND (routes/records.js) during the
 *                       DOCTOR view flow to filter which IPFS records fall
 *                       within the scope of the doctor's permitted operation.
 *                       PATIENTS bypass this filter and receive all their records.
 *
 *  No private keys or sensitive data are involved in this module.
 *
 *  HOW IT WORKS
 *  ────────────
 *  When a doctor has permission for an operation (e.g. "diabetes_check"),
 *  the backend uses this mapping to decide which IPFS records are
 *  relevant by matching against each record's metadata.tags[].
 *
 *  If ANY tag in a record's metadata matches ANY tag in the operation's
 *  list, that record is considered relevant and will be decrypted.
 *  This ensures a doctor can ONLY see records related to their
 *  granted purpose — enforce Purpose-Bound access (PB-CRDA).
 */

const OPERATION_TAG_MAP = {
  // Endocrinology / Diabetes
  diabetes_check: [
    "diabetes", "blood_sugar", "glucose", "HbA1c",
    "endocrinology", "insulin", "metabolic"
  ],

  // Oncology / Cancer
  cancer_risk_analysis: [
    "oncology", "tumor", "biopsy", "radiology",
    "pathology", "cancer", "chemotherapy", "mammogram"
  ],

  // Allergy / Immunology
  allergy_summary: [
    "allergy", "immunology", "reaction", "sensitivity",
    "anaphylaxis", "antihistamine"
  ],

  // Cardiology
  cardiac_review: [
    "cardiology", "ECG", "echocardiogram", "blood_pressure",
    "heart", "cholesterol", "lipid", "arrhythmia"
  ],

  // Pulmonology
  pulmonary_review: [
    "pulmonology", "lung", "asthma", "spirometry",
    "respiratory", "oxygen_saturation"
  ],

  // View only diagnostic lab reports
  view_diagnostics: ["diagnostics"],

  // General — matches everything (full access)
  general_checkup: ["*"],

  // Self-view — patient viewing their own records (wildcard)
  self_view: ["*"]
};

/**
 * Check if a record's tags match the given operation.
 * @caller  BACKEND — routes/records.js (POST /view), DOCTOR path only.
 *          Patients skip this check entirely (they always see all their records).
 *          No private key or sensitive data is input or output by this function.
 *
 * @param {string}   operation  - The operation name from the smart contract
 * @param {string[]} recordTags - The tags from the record's IPFS metadata
 * @returns {boolean} true if the record is relevant to the operation
 */
function isRecordRelevant(operation, recordTags) {
  const opTags = OPERATION_TAG_MAP[operation];

  // Unknown operation → no match (deny by default)
  if (!opTags) {
    console.warn(`[TagFilter] Unknown operation "${operation}" — no tags mapped, denying access`);
    return false;
  }

  // Wildcard → matches everything
  if (opTags.includes("*")) return true;

  // Check if ANY record tag matches ANY operation tag (case-insensitive)
  const opTagsLower = opTags.map(t => t.toLowerCase());
  const match = recordTags.some(tag => opTagsLower.includes(tag.toLowerCase()));
  console.log(`[TagFilter] operation="${operation}" opTags=[${opTagsLower}] recordTags=[${recordTags}] → match=${match}`);
  return match;
}

module.exports = { OPERATION_TAG_MAP, isRecordRelevant };

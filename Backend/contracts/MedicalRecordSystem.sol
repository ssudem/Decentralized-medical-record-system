// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * ============================================================
 *  MedicalRecordSystem.sol
 *  Decentralized Medical Record System — PB-CRDA MVP
 * ============================================================
 *
 *  PURPOSE
 *  -------
 *  Implements Purpose-Bound & Computation-Restricted Data Access
 *  (PB-CRDA) for medical records stored off-chain on IPFS.
 *
 *  HOW IT WORKS
 *  ------------
 *  1.  SuperAdmin (deployer) registers trusted Hospitals.
 *  2.  Hospitals authorize individual Doctors.
 *  3.  Doctors upload encrypted medical files to IPFS, then call
 *      uploadRecord() to link the CID to a patient on-chain.
 *  4.  Patients call grantAccess() to whitelist a specific
 *      computation (e.g. "diabetes_check") for a specific Doctor.
 *  5.  The Node.js backend (acting as SuperAdmin) verifies the
 *      permission via checkPermission(), fetches the CIDs via
 *      getPatientRecords(), retrieves & decrypts the file from
 *      IPFS, runs the permitted computation IN-MEMORY, and
 *      returns ONLY the computed result — never raw data.
 *
 *  NO Break-Glass / emergency-access features are included.
 * ============================================================
 */
contract MedicalRecordSystem {
    // ─────────────────────────────────────────────
    //  STATE VARIABLES
    // ─────────────────────────────────────────────

    /**
     * @dev The address that deployed the contract.
     *      In production this would be a regulatory body
     *      (e.g. Ministry of Health). The Node.js backend
     *      uses this same wallet so it inherits superAdmin
     *      privileges — specifically, the ability to call
     *      getPatientRecords() for ANY patient.
     */
    address public superAdmin;

    // ─────────────────────────────────────────────
    //  STRUCTS
    // ─────────────────────────────────────────────

    /**
     * @dev Represents one medical record pointer.
     *      Actual data lives on IPFS (encrypted).
     *      Only the hash (CID) is stored on-chain.
     */
    struct Record {
        string ipfsHash; // Content Identifier on IPFS
        address issuedByDoctor; // Doctor who uploaded this record. If 0x0, it might be a lab.
        address issuedByLab; // Lab that uploaded this record. If 0x0, it might be a doctor.
        uint256 timestamp; // Block timestamp at upload time
    }

    // ─────────────────────────────────────────────
    //  MAPPINGS  (on-chain registry)
    // ─────────────────────────────────────────────

    // ── 1. Trust Hierarchy ──

    /**
     * @dev Tracks which addresses are verified hospitals.
     *      true  → address is a valid hospital
     *      false → not registered (default)
     */
    mapping(address => bool) public validHospitals;

    /**
     * @dev Links a Doctor address to the Hospital that
     *      authorized them. address(0) means unregistered.
     */
    mapping(address => address) public doctorToHospital;

    /**
     * @dev Links a Diagnostics Lab address to the Hospital that
     *      authorized them. address(0) means unregistered.
     */
    mapping(address => address) public diagnosticsLabToHospital;

    // ── 2. Data Ownership ──

    /**
     * @dev Patient address → array of Record structs.
     *      Marked `private` so external contracts can NOT
     *      read it directly. Access is gated by
     *      getPatientRecords() which enforces caller checks.
     */
    mapping(address => Record[]) private patientRecords;

    // ── 3. PB-CRDA Permission Matrix (Time-Bound) ──

    /**
     * @dev Three-level mapping:
     *        Patient → Doctor → Operation string → uint256 (expiry timestamp)
     *
     *      Example: accessPermissions[alice][drBob]["diabetes_check"] = 1743292800
     *      means Alice has granted Dr Bob permission to run ONLY the
     *      "diabetes_check" computation on her records UNTIL that Unix timestamp.
     *
     *      Value meanings:
     *        0                     → never granted or revoked
     *        > block.timestamp     → active (not yet expired)
     *        <= block.timestamp    → expired
     */
    mapping(address => mapping(address => mapping(string => uint256)))
        public accessPermissions;

    // ─────────────────────────────────────────────
    //  EVENTS  (immutable on-chain audit trail)
    // ─────────────────────────────────────────────

    /// @dev Emitted when SuperAdmin adds a new hospital
    event HospitalAdded(address indexed hospital);

    /// @dev Emitted when SuperAdmin removes a hospital
    event HospitalRemoved(address indexed hospital);

    /// @dev Emitted when a hospital authorizes a new doctor
    event DoctorAuthorized(address indexed doctor, address indexed hospital);

    /// @dev Emitted when a hospital authorizes a new diagnostics lab
    event DiagnosticsLabAuthorized(
        address indexed lab,
        address indexed hospital
    );

    /// @dev Emitted when a hospital revokes a diagnostics lab's authorization
    event DiagnosticsLabUnauthorized(
        address indexed lab,
        address indexed hospital
    );

    /// @dev Emitted when a doctor or lab uploads a record for a patient
    event RecordUploaded(
        address indexed patient,
        address indexed issuer,
        string ipfsHash
    );

    /// @dev Emitted when a hospital revokes a doctor's authorization
    event DoctorUnauthorized(address indexed doctor, address indexed hospital);

    /**
     * @dev Emitted when a patient grants time-bound permission.
     *      `purpose` is a human-readable justification string
     *      (e.g. "Annual wellness screening") logged immutably
     *      for compliance & auditability.
     *      `expiresAt` records the exact expiry timestamp.
     */
    event AccessGranted(
        address indexed patient,
        address indexed doctor,
        string operation,
        string purpose,
        uint256 expiresAt
    );

    /// @dev Emitted when a patient revokes a previously granted operation
    event AccessRevoked(
        address indexed patient,
        address indexed doctor,
        string operation
    );

    /**
     * @dev Emitted when a doctor accesses a patient's records.
     *      Logs the operation the doctor specified, creating an
     *      immutable audit trail of every record access.
     */
    event DoctorRecordAccess(
        address indexed doctor,
        address indexed patient,
        string operation,
        uint256 timestamp
    );

    /**
     * @dev Emitted by the Node.js server (via a Doctor wallet)
     *      AFTER completing a computation. `resultHash` is a
     *      SHA-256 digest of the computed output — proving the
     *      computation happened without revealing the result.
     */
    event ComputationLogged(
        address indexed doctor,
        address indexed patient,
        string operation,
        string resultHash
    );

    // ─────────────────────────────────────────────
    //  MODIFIERS  (access-control guards)
    // ─────────────────────────────────────────────

    /// @dev Restricts a function to the contract deployer only
    modifier onlyAdmin() {
        require(msg.sender == superAdmin, "Only Super Admin can perform this");
        _;
    }

    /// @dev Restricts a function to registered hospitals
    modifier onlyHospital() {
        require(
            validHospitals[msg.sender],
            "Only verified Hospitals can perform this"
        );
        _;
    }

    /**
     * @dev Restricts a function to doctors who are:
     *      1. Linked to a hospital  (doctorToHospital != 0x0)
     *      2. Whose hospital is still marked valid
     *      This two-step check ensures a doctor loses access
     *      if their hospital is later removed.
     */
    modifier onlyDoctor() {
        require(
            doctorToHospital[msg.sender] != address(0),
            "Unauthorized: Not linked to any hospital"
        );
        require(
            validHospitals[doctorToHospital[msg.sender]],
            "Unauthorized: Parent hospital is no longer valid"
        );
        _;
    }

    /**
     * @dev Restricts a function to diagnostics labs who are:
     *      1. Linked to a hospital  (diagnosticsLabToHospital != 0x0)
     *      2. Whose hospital is still marked valid
     */
    modifier onlyDiagnosticsLab() {
        require(
            diagnosticsLabToHospital[msg.sender] != address(0),
            "Unauthorized: Not linked to any hospital"
        );
        require(
            validHospitals[diagnosticsLabToHospital[msg.sender]],
            "Unauthorized: Parent hospital is no longer valid"
        );
        _;
    }

    // ─────────────────────────────────────────────
    //  CONSTRUCTOR
    // ─────────────────────────────────────────────

    /**
     * @dev Sets the deployer as superAdmin.
     *      The same wallet's private key must be loaded in the
     *      Node.js server's .env (SERVER_PRIVATE_KEY) so that
     *      the backend can call getPatientRecords() as superAdmin.
     */
    constructor() {
        superAdmin = msg.sender;
    }

    // =========================================================
    //  1.  IDENTITY & TRUST MANAGEMENT
    // =========================================================

    /**
     * @notice Register a new hospital address.
     * @dev    Only the SuperAdmin (deployer) can call this.
     *         Once added, the hospital can authorize doctors.
     * @param  _hospital  Ethereum address of the hospital
     */
    function addHospital(address _hospital) external onlyAdmin {
        // Mark address as a valid hospital in the registry
        validHospitals[_hospital] = true;

        // Log the event so off-chain systems can index it
        emit HospitalAdded(_hospital);
    }

    /**
     * @notice Remove a hospital from the registry.
     * @dev    Only the SuperAdmin (deployer) can call this.
     *         Once removed, all doctors and labs under this hospital
     *         will automatically lose their authority because the
     *         onlyDoctor / onlyDiagnosticsLab modifiers check
     *         validHospitals[parentHospital].
     * @param  _hospital  Ethereum address of the hospital to remove
     */
    function removeHospital(address _hospital) external onlyAdmin {
        require(
            validHospitals[_hospital],
            "Hospital is not currently registered"
        );

        // Revoke hospital status
        validHospitals[_hospital] = false;

        emit HospitalRemoved(_hospital);
    }

    /**
     * @notice Authorize a doctor under the calling hospital.
     * @dev    msg.sender must be a registered hospital.
     *         The doctor ↔ hospital link is stored so we can
     *         verify the doctor's authority later.
     * @param  _doctor  Ethereum address of the doctor
     */
    function authorizeDoctor(address _doctor) external onlyHospital {
        // ── NEW: one-hospital-per-doctor rule ──
        require(
            doctorToHospital[_doctor] == address(0),
            "Doctor is already linked to a hospital. Unauthorize them first."
        );
        // Create the doctor → hospital mapping
        doctorToHospital[_doctor] = msg.sender;
        emit DoctorAuthorized(_doctor, msg.sender);
    }

    function unauthorizeDoctor(address _doctor) external onlyHospital {
        // ── Guard 1: doctor must actually be registered ──
        require(
            doctorToHospital[_doctor] != address(0),
            "Doctor is not currently authorized"
        );

        // ── Guard 2: only the hospital that authorized them can revoke ──
        require(
            doctorToHospital[_doctor] == msg.sender,
            "Only the authorizing hospital can revoke this doctor"
        );

        // Wipe the link — resets to default (address(0))
        doctorToHospital[_doctor] = address(0);

        emit DoctorUnauthorized(_doctor, msg.sender);
    }

    /**
     * @notice Authorize a diagnostics lab under the calling hospital.
     * @param  _lab  Ethereum address of the diagnostics lab
     */
    function authorizeDiagnosticsLab(address _lab) external onlyHospital {
        diagnosticsLabToHospital[_lab] = msg.sender;

        emit DiagnosticsLabAuthorized(_lab, msg.sender);
    }

    /**
     * @notice Revoke a diagnostics lab's authorization.
     * @dev    Only the hospital that authorized the lab can revoke it.
     *         Mirrors the unauthorizeDoctor() pattern.
     * @param  _lab  Ethereum address of the diagnostics lab
     */
    function unauthorizeDiagnosticsLab(address _lab) external onlyHospital {
        // ── Guard 1: lab must actually be registered ──
        require(
            diagnosticsLabToHospital[_lab] != address(0),
            "Diagnostics lab is not currently authorized"
        );

        // ── Guard 2: only the hospital that authorized them can revoke ──
        require(
            diagnosticsLabToHospital[_lab] == msg.sender,
            "Only the authorizing hospital can revoke this diagnostics lab"
        );

        // Wipe the link — resets to default (address(0))
        diagnosticsLabToHospital[_lab] = address(0);

        emit DiagnosticsLabUnauthorized(_lab, msg.sender);
    }

    // =========================================================
    //  2.  RECORD ISSUANCE  (Doctor / Lab → Patient)
    // =========================================================

    /**
     * @notice Upload a medical record hash for a patient.
     * @dev    The doctor encrypts the file, uploads it to IPFS,
     *         obtains the CID, and then calls this function.
     *         The contract merely stores the CID pointer and
     *         assigns ownership to the patient address.
     *
     * @param  _patient   Address of the patient who owns the record
     * @param  _ipfsHash  IPFS Content Identifier (CID) of the
     *                    encrypted medical file
     */
    function uploadRecord(
        address _patient,
        string memory _ipfsHash
    ) external onlyDoctor {
        // Push a new Record into the patient's on-chain array.
        // block.timestamp provides an immutable creation time.
        patientRecords[_patient].push(
            Record({
                ipfsHash: _ipfsHash,
                issuedByDoctor: msg.sender,
                issuedByLab: address(0),
                timestamp: block.timestamp
            })
        );

        // Emit event for off-chain indexing / UI notifications
        emit RecordUploaded(_patient, msg.sender, _ipfsHash);
    }

    /**
     * @notice Upload a medical record hash for a patient.
     * @dev    Called by a Diagnostics Lab.
     */
    function uploadRecordLab(
        address _patient,
        string memory _ipfsHash
    ) external onlyDiagnosticsLab {
        patientRecords[_patient].push(
            Record({
                ipfsHash: _ipfsHash,
                issuedByDoctor: address(0),
                issuedByLab: msg.sender,
                timestamp: block.timestamp
            })
        );

        emit RecordUploaded(_patient, msg.sender, _ipfsHash);
    }

    // =========================================================
    //  3.  PB-CRDA PERMISSION SYSTEM  (Patient-controlled)
    // =========================================================

    /**
     * @notice Grant a doctor TIME-BOUND permission to run a specific
     *         computation on your medical records.
     *
     * @dev    Only the PATIENT (msg.sender) can call this.
     *         The permission auto-expires after `_durationSeconds`.
     *         The patient can also revoke it early via revokeAccess().
     *
     * @param  _doctor           Address of the doctor being granted access
     * @param  _operation        Exact computation name to whitelist,
     *                           e.g. "diabetes_check", "cancer_risk_analysis"
     * @param  _purpose          Human-readable reason for granting access,
     *                           e.g. "Annual wellness screening"
     * @param  _durationSeconds  How long the permission lasts in seconds.
     *                           Common values: 1 days, 7 days, 30 days
     */
    function grantAccess(
        address _doctor,
        string memory _operation,
        string memory _purpose,
        uint256 _durationSeconds
    ) external {
        // Duration must be at least 1 hour and at most 365 days
        require(
            _durationSeconds >= 1 hours && _durationSeconds <= 365 days,
            "Duration must be between 1 hour and 365 days"
        );

        // Calculate the expiry timestamp
        uint256 expiresAt = block.timestamp + _durationSeconds;

        // Store the expiry timestamp for this
        // (patient, doctor, operation) tuple.
        accessPermissions[msg.sender][_doctor][_operation] = expiresAt;

        // The purpose + expiry are logged immutably in the event
        // so regulators can prove informed consent and its bounds.
        emit AccessGranted(
            msg.sender,
            _doctor,
            _operation,
            _purpose,
            expiresAt
        );
    }

    /**
     * @notice Revoke a previously granted permission immediately.
     * @dev    Sets the expiry to 0, which is always < block.timestamp,
     *         so checkPermission() will return false immediately.
     *         This acts as a manual override — the patient can kill
     *         access before the time-bound expiry is reached.
     *
     * @param  _doctor     Address of the doctor
     * @param  _operation  Computation to revoke
     */
    function revokeAccess(address _doctor, string memory _operation) external {
        // Set expiry to 0 → always expired (0 < any block.timestamp)
        accessPermissions[msg.sender][_doctor][_operation] = 0;

        emit AccessRevoked(msg.sender, _doctor, _operation);
    }

    /**
     * @notice Check whether a patient's grant to a doctor is still active.
     *
     * @dev    Returns true ONLY if the stored expiry timestamp is
     *         strictly greater than the current block.timestamp.
     *         Zero or any past timestamp returns false.
     *
     * @param  _patient    Patient address
     * @param  _doctor     Doctor address
     * @param  _operation  Computation name to check
     * @return bool        true if permission is active, false if expired/revoked
     */
    function checkPermission(
        address _patient,
        address _doctor,
        string memory _operation
    ) external view returns (bool) {
        return
            accessPermissions[_patient][_doctor][_operation] > block.timestamp;
    }

    /**
     * @notice View when a specific grant expires.
     *
     * @dev    Returns the raw expiry timestamp. Useful for UIs
     *         to display "Access expires in 5 days" etc.
     *         Returns 0 if never granted or already revoked.
     *
     * @param  _patient    Patient address
     * @param  _doctor     Doctor address
     * @param  _operation  Computation name
     * @return uint256     Unix timestamp of expiry (0 = no grant)
     */
    function getAccessExpiry(
        address _patient,
        address _doctor,
        string memory _operation
    ) external view returns (uint256) {
        return accessPermissions[_patient][_doctor][_operation];
    }

    // =========================================================
    //  4.  DATA RETRIEVAL & AUDIT LOGGING
    // =========================================================

    /**
     * @notice Retrieve all IPFS record hashes for a patient.
     *
     * @dev    SECURITY: Allowed callers:
     *           • A Doctor with a granted permission for the
     *             specified `_operation` on this patient.
     *             The access is logged via the DoctorRecordAccess event.
     *           • The SuperAdmin (backend execution layer).
     *
     *         NOTE: This is NOT a view function because it emits
     *         an event to create an immutable audit log of every
     *         doctor access.  Patients should use myRecords().
     *
     * @param  _patient    Address of the patient
     * @param  _operation  The specific computation / purpose the
     *                     doctor intends to perform, e.g. "diabetes_check"
     * @return Record[]    Array of Record structs (CID, doctor, timestamp)
     */
    function getPatientRecords(
        address _patient,
        string memory _operation
    ) external returns (Record[] memory) {
        if (msg.sender == superAdmin) {
            // SuperAdmin (backend) can access any patient's records
            // without specifying a purpose — used by the secure
            // execution layer which already enforces PB-CRDA.
            return patientRecords[_patient];
        }

        // ── Doctor path ──
        // 1. Caller must be a valid doctor
        require(
            doctorToHospital[msg.sender] != address(0),
            "Unauthorized: Not linked to any hospital"
        );
        require(
            validHospitals[doctorToHospital[msg.sender]],
            "Unauthorized: Parent hospital is no longer valid"
        );

        // 2. Doctor must have an active (non-expired) permission
        require(
            accessPermissions[_patient][msg.sender][_operation] >
                block.timestamp,
            "Access Denied: No permission or permission expired"
        );

        // 3. Log the access immutably on-chain
        emit DoctorRecordAccess(
            msg.sender,
            _patient,
            _operation,
            block.timestamp
        );

        return patientRecords[_patient];
    }

    /**
     * @notice Patients can view their own medical records.
     *
     * @dev    Can ONLY be called by the patient themselves.
     *         This is a view function (no gas cost) because
     *         patients accessing their own data does not need
     *         to be logged on-chain — it is their own data.
     *
     * @return Record[]  Array of Record structs (CID, doctor, timestamp)
     */
    function myRecords() external view returns (Record[] memory) {
        return patientRecords[msg.sender];
    }

    /**
     * @notice Log a completed computation on the blockchain.
     *
     * @dev    Called by the Node.js backend (via a Doctor's wallet
     *         or the server wallet acting on behalf of a Doctor)
     *         AFTER a computation finishes. This creates an
     *         immutable proof that:
     *           1. The doctor had permission (re-checked here).
     *           2. The computation was executed.
     *           3. The result digest is permanently recorded.
     *
     * @param  _patient     Patient whose data was computed on
     * @param  _operation   The computation that was executed
     * @param  _resultHash  SHA-256 hash of the computation result
     */
    function logComputation(
        address _patient,
        string memory _operation,
        string memory _resultHash
    ) external onlyDoctor {
        // Re-verify permission at log-time to ensure
        // it wasn't revoked or expired between compute and log.
        require(
            accessPermissions[_patient][msg.sender][_operation] >
                block.timestamp,
            "Cannot log: No permission or permission expired"
        );

        emit ComputationLogged(msg.sender, _patient, _operation, _resultHash);
    }
}

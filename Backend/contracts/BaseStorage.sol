// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract BaseStorage {

    address public immutable superAdmin;

    struct Record {
        address issuedByDoctor;
        address issuedByLab;
        uint64 timestamp;
        string ipfsHash;
    }

    mapping(address => bool) public validHospitals;
    mapping(address => address) public doctorToHospital;
    mapping(address => address) public diagnosticsLabToHospital;

    mapping(address => Record[]) internal patientRecords;

    // GAS OPT: bytes32 key instead of string — eliminates dynamic hashing on every SSTORE/SLOAD
    mapping(address => mapping(address => mapping(bytes32 => uint256)))
        internal _accessPermissions;

    // CUSTOM ERRORS (save gas vs require strings)
    error Unauthorized();
    error NotRegistered();
    error AlreadyLinked();
    error InvalidDuration();
    error AccessDenied();

    // EVENTS — bytes32 instead of dynamic string saves ~200+ gas per emit
    event HospitalAdded(address indexed hospital);
    event HospitalRemoved(address indexed hospital);

    event DoctorAuthorized(address indexed doctor, address indexed hospital);
    event DoctorUnauthorized(address indexed doctor, address indexed hospital);

    event DiagnosticsLabAuthorized(address indexed lab, address indexed hospital);
    event DiagnosticsLabUnauthorized(address indexed lab, address indexed hospital);

    event RecordUploaded(address indexed patient, address indexed issuer, bytes32 ipfsHash);

    event AccessGranted(address indexed patient, address indexed doctor, bytes32 indexed operation, bytes32 purpose, uint256 expiresAt);
    event AccessRevoked(address indexed patient, address indexed doctor, bytes32 indexed operation);

    event DoctorRecordAccess(address indexed doctor, address indexed patient, bytes32 indexed operation, uint256 timestamp);
    event ComputationLogged(address indexed doctor, address indexed patient, bytes32 indexed operation, bytes32 resultHash);

    constructor() {
        superAdmin = msg.sender;
    }

    /// @notice ABI-compatible public getter — mirrors the old auto-generated getter
    ///         for `mapping(address => mapping(address => mapping(string => uint256))) public accessPermissions`
    function accessPermissions(
        address _patient,
        address _doctor,
        string calldata _operation
    ) external view returns (uint256) {
        return _accessPermissions[_patient][_doctor][keccak256(bytes(_operation))];
    }
}
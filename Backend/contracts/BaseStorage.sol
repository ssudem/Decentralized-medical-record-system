// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract BaseStorage {

    address public superAdmin;

    struct Record {
        string ipfsHash;
        uint256 timestamp;
        address issuedByDoctor;
        address issuedByLab;
    }

    mapping(address => bool) public validHospitals;
    mapping(address => address) public doctorToHospital;
    mapping(address => address) public diagnosticsLabToHospital;

    mapping(address => Record[]) internal patientRecords;

    mapping(address => mapping(address => mapping(string => uint256)))
        public accessPermissions;

    // EVENTS 
    event HospitalAdded(address indexed hospital);
    event HospitalRemoved(address indexed hospital);

    event DoctorAuthorized(address indexed doctor, address indexed hospital);
    event DoctorUnauthorized(address indexed doctor, address indexed hospital);

    event DiagnosticsLabAuthorized(address indexed lab, address indexed hospital);
    event DiagnosticsLabUnauthorized(address indexed lab, address indexed hospital);

    event RecordUploaded(address indexed patient, address indexed issuer, string ipfsHash);

    event AccessGranted(address indexed patient, address indexed doctor, string operation, string purpose, uint256 expiresAt);
    event AccessRevoked(address indexed patient, address indexed doctor, string operation);

    event DoctorRecordAccess(address indexed doctor, address indexed patient, string operation, uint256 timestamp);
    event ComputationLogged(address indexed doctor, address indexed patient, string operation, string resultHash);
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./Hospital.sol";

contract DoctorAndDiagnostics is Hospital {
    modifier onlyDoctor() {
        // GAS OPT: cache storage read once, reuse local variable
        address hospital = doctorToHospital[msg.sender];
        if (hospital == address(0) || !validHospitals[hospital]) revert Unauthorized();
        _;
    }

    modifier onlyDiagnosticsLab() {
        address hospital = diagnosticsLabToHospital[msg.sender];
        if (hospital == address(0) || !validHospitals[hospital]) revert Unauthorized();
        _;
    }

    function _uploadRecord(address _patient, string calldata _ipfsHash) internal {
        patientRecords[_patient].push(
            Record(msg.sender, address(0), uint64(block.timestamp), _ipfsHash)
        );

        // GAS OPT: emit hashed bytes32 instead of dynamic string
        emit RecordUploaded(_patient, msg.sender, keccak256(bytes(_ipfsHash)));
    }

    function _uploadRecordLab(
        address _patient,
        string calldata _ipfsHash
    ) internal {
        patientRecords[_patient].push(
            Record(address(0), msg.sender, uint64(block.timestamp), _ipfsHash)
        );

        emit RecordUploaded(_patient, msg.sender, keccak256(bytes(_ipfsHash)));
    }
}

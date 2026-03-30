// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Hospital.sol";

contract DoctorAndDiagnostics is Hospital {
    modifier onlyDoctor() {
        address hospital = doctorToHospital[msg.sender];
        require(
            hospital != address(0) && validHospitals[hospital],
            "Unauthorized doctor"
        );
        _;
    }

    modifier onlyDiagnosticsLab() {
        address hospital = diagnosticsLabToHospital[msg.sender];
        require(
            hospital != address(0) && validHospitals[hospital],
            "Unauthorized lab"
        );
        _;
    }

    function _uploadRecord(address _patient, string memory _ipfsHash) internal {
        patientRecords[_patient].push(
            Record(_ipfsHash, block.timestamp, msg.sender, address(0))
        );

        emit RecordUploaded(_patient, msg.sender, _ipfsHash);
    }

    function _uploadRecordLab(
        address _patient,
        string memory _ipfsHash
    ) internal {
        patientRecords[_patient].push(
            Record(_ipfsHash, block.timestamp, address(0), msg.sender)
        );

        emit RecordUploaded(_patient, msg.sender, _ipfsHash);
    }
}

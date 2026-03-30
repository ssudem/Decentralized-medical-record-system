// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Patient.sol";

contract MedicalRecordSystem is Patient {
    constructor() {
        superAdmin = msg.sender;
    }

    function addHospital(address _hospital) external onlyAdmin {
        _addHospital(_hospital);
    }

    function removeHospital(address _hospital) external onlyAdmin {
        _removeHospital(_hospital);
    }

    function authorizeDoctor(address _doctor) external onlyHospital {
        _authorizeDoctor(_doctor);
    }

    function unauthorizeDoctor(address _doctor) external onlyHospital {
        _unauthorizeDoctor(_doctor);
    }

    function authorizeDiagnosticsLab(address _lab) external onlyHospital {
        _authorizeLab(_lab);
    }

    function unauthorizeDiagnosticsLab(address _lab) external onlyHospital {
        _unauthorizeLab(_lab);
    }

    function uploadRecord(
        address _patient,
        string memory _ipfsHash
    ) external onlyDoctor {
        _uploadRecord(_patient, _ipfsHash);
    }

    function uploadRecordLab(
        address _patient,
        string memory _ipfsHash
    ) external onlyDiagnosticsLab {
        _uploadRecordLab(_patient, _ipfsHash);
    }

    function grantAccess(
        address _doctor,
        string memory _operation,
        string memory _purpose,
        uint256 _durationSeconds
    ) external {
        _grantAccess(_doctor, _operation, _purpose, _durationSeconds);
    }

    function revokeAccess(address _doctor, string memory _operation) external {
        _revokeAccess(_doctor, _operation);
    }

    function checkPermission(
        address _patient,
        address _doctor,
        string memory _operation
    ) public view returns (bool) {
        return _checkPermission(_patient, _doctor, _operation);
    }

    function getAccessExpiry(
        address _patient,
        address _doctor,
        string memory _operation
    ) external view returns (uint256) {
        return accessPermissions[_patient][_doctor][_operation];
    }

    function getPatientRecords(
        address _patient,
        string memory _operation
    ) external returns (Record[] memory) {
        return _getPatientRecords(_patient, _operation);
    }

    function myRecords() external view returns (Record[] memory) {
        return _myRecords();
    }
}

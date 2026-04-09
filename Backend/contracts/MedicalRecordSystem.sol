// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./Patient.sol";

contract MedicalRecordSystem is Patient {

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
        string calldata _ipfsHash
    ) external onlyDoctor {
        _uploadRecord(_patient, _ipfsHash);
    }

    function uploadRecordLab(
        address _patient,
        string calldata _ipfsHash
    ) external onlyDiagnosticsLab {
        _uploadRecordLab(_patient, _ipfsHash);
    }

    function grantAccess(
        address _doctor,
        string calldata _operation,
        string calldata _purpose,
        uint256 _durationSeconds
    ) external {
        _grantAccess(_doctor, _operation, _purpose, _durationSeconds);
    }

    function revokeAccess(address _doctor, string calldata _operation) external {
        _revokeAccess(_doctor, _operation);
    }

    function checkPermission(
        address _patient,
        address _doctor,
        string calldata _operation
    ) public view returns (bool) {
        return _checkPermission(_patient, _doctor, _operation);
    }

    function getAccessExpiry(
        address _patient,
        address _doctor,
        string calldata _operation
    ) external view returns (uint256) {
        return _accessPermissions[_patient][_doctor][keccak256(bytes(_operation))];
    }

    // GAS OPT: now `view` — event moved to logDoctorAccess()
    function getPatientRecords(
        address _patient,
        string calldata _operation
    ) external view returns (Record[] memory) {
        return _getPatientRecords(_patient, _operation);
    }

    /// @notice On-chain audit log for doctor record access — call separately when logging is needed.
    ///         This is a NEW function (additive ABI change, does not break existing callers).
    function logDoctorAccess(
        address _patient,
        string calldata _operation
    ) external {
        _logDoctorAccess(_patient, _operation);
    }

    function myRecords() external view returns (Record[] memory) {
        return _myRecords();
    }
}

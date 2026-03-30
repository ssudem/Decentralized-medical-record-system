// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DoctorAndDiagnostics.sol";

contract Patient is DoctorAndDiagnostics {

    function _grantAccess(
        address _doctor,
        string memory _operation,
        string memory _purpose,
        uint256 _durationSeconds
    ) internal {

        require(_durationSeconds >= 1 hours && _durationSeconds <= 365 days);

        uint256 expiresAt;
        unchecked {
            expiresAt = block.timestamp + _durationSeconds;
        }

        accessPermissions[msg.sender][_doctor][_operation] = expiresAt;

        emit AccessGranted(msg.sender, _doctor, _operation, _purpose, expiresAt);
    }

    function _revokeAccess(address _doctor, string memory _operation) internal {
        accessPermissions[msg.sender][_doctor][_operation] = 0;
        emit AccessRevoked(msg.sender, _doctor, _operation);
    }

    function _checkPermission(
        address _patient,
        address _doctor,
        string memory _operation
    ) internal view returns (bool) {
        return accessPermissions[_patient][_doctor][_operation] > block.timestamp;
    }

    function _getPatientRecords(address _patient, string memory _operation)
        internal
        returns (Record[] memory)
    {
        if (msg.sender == superAdmin) {
            return patientRecords[_patient];
        }

        address hospital = doctorToHospital[msg.sender];
        require(hospital != address(0) && validHospitals[hospital], "Unauthorized");

        require(
            accessPermissions[_patient][msg.sender][_operation] > block.timestamp,
            "Access denied"
        );

        emit DoctorRecordAccess(msg.sender, _patient, _operation, block.timestamp);

        return patientRecords[_patient];
    }


    function _myRecords() internal view returns (Record[] memory) {
        return patientRecords[msg.sender];
    }
}
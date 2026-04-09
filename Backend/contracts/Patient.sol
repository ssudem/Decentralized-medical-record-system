// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./DoctorAndDiagnostics.sol";

contract Patient is DoctorAndDiagnostics {

    function _grantAccess(
        address _doctor,
        string calldata _operation,
        string calldata _purpose,
        uint256 _durationSeconds
    ) internal {

        if (_durationSeconds < 1 hours || _durationSeconds > 365 days) revert InvalidDuration();

        uint256 expiresAt;
        unchecked {
            expiresAt = block.timestamp + _durationSeconds;
        }

        // GAS OPT: hash operation once, reuse for mapping key + event
        bytes32 opHash = keccak256(bytes(_operation));
        _accessPermissions[msg.sender][_doctor][opHash] = expiresAt;

        emit AccessGranted(msg.sender, _doctor, opHash, keccak256(bytes(_purpose)), expiresAt);
    }

    function _revokeAccess(address _doctor, string calldata _operation) internal {
        bytes32 opHash = keccak256(bytes(_operation));

        // GAS OPT: skip redundant SSTORE if already zero
        if (_accessPermissions[msg.sender][_doctor][opHash] == 0) return;

        delete _accessPermissions[msg.sender][_doctor][opHash];
        emit AccessRevoked(msg.sender, _doctor, opHash);
    }

    function _checkPermission(
        address _patient,
        address _doctor,
        string calldata _operation
    ) internal view returns (bool) {
        return _accessPermissions[_patient][_doctor][keccak256(bytes(_operation))] > block.timestamp;
    }

    // GAS OPT: now `view` — no event emission, no state change, cheaper static call
    function _getPatientRecords(address _patient, string calldata _operation)
        internal
        view
        returns (Record[] memory)
    {
        if (msg.sender == superAdmin) {
            return patientRecords[_patient];
        }

        // GAS OPT: cache storage reads
        address hospital = doctorToHospital[msg.sender];
        if (hospital == address(0) || !validHospitals[hospital]) revert Unauthorized();

        if (_accessPermissions[_patient][msg.sender][keccak256(bytes(_operation))] <= block.timestamp) revert AccessDenied();

        return patientRecords[_patient];
    }

    /// @notice Separate audit-log function — call after getPatientRecords if you need on-chain logging
    function _logDoctorAccess(address _patient, string calldata _operation) internal {
        address hospital = doctorToHospital[msg.sender];
        if (hospital == address(0) || !validHospitals[hospital]) revert Unauthorized();

        bytes32 opHash = keccak256(bytes(_operation));
        if (_accessPermissions[_patient][msg.sender][opHash] <= block.timestamp) revert AccessDenied();

        emit DoctorRecordAccess(msg.sender, _patient, opHash, block.timestamp);
    }

    function _myRecords() internal view returns (Record[] memory) {
        return patientRecords[msg.sender];
    }
}
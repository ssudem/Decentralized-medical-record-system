// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./SuperAdmin.sol";

contract Hospital is SuperAdmin {
    modifier onlyHospital() {
        if (!validHospitals[msg.sender]) revert Unauthorized();
        _;
    }

    function _authorizeDoctor(address _doctor) internal {
        if (doctorToHospital[_doctor] != address(0)) revert AlreadyLinked();
        doctorToHospital[_doctor] = msg.sender;
        emit DoctorAuthorized(_doctor, msg.sender);
    }

    function _unauthorizeDoctor(address _doctor) internal {
        address hospital = doctorToHospital[_doctor];
        if (hospital == address(0)) revert NotRegistered();
        if (hospital != msg.sender) revert Unauthorized();

        // GAS OPT: delete is cheaper than setting to address(0) for clearing storage
        delete doctorToHospital[_doctor];
        emit DoctorUnauthorized(_doctor, msg.sender);
    }

    function _authorizeLab(address _lab) internal {
        diagnosticsLabToHospital[_lab] = msg.sender;
        emit DiagnosticsLabAuthorized(_lab, msg.sender);
    }

    function _unauthorizeLab(address _lab) internal {
        address hospital = diagnosticsLabToHospital[_lab];
        if (hospital == address(0)) revert NotRegistered();
        if (hospital != msg.sender) revert Unauthorized();

        delete diagnosticsLabToHospital[_lab];
        emit DiagnosticsLabUnauthorized(_lab, msg.sender);
    }
}

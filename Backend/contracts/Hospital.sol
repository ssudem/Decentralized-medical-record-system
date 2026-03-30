// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./SuperAdmin.sol";

contract Hospital is SuperAdmin {
    modifier onlyHospital() {
        require(validHospitals[msg.sender], "Only verified Hospitals");
        _;
    }

    function _authorizeDoctor(address _doctor) internal {
        require(doctorToHospital[_doctor] == address(0), "Already linked");
        doctorToHospital[_doctor] = msg.sender;
        emit DoctorAuthorized(_doctor, msg.sender);
    }

    function _unauthorizeDoctor(address _doctor) internal {
        address hospital = doctorToHospital[_doctor];
        require(hospital != address(0), "Not authorized");
        require(hospital == msg.sender, "Not your doctor");

        doctorToHospital[_doctor] = address(0);
        emit DoctorUnauthorized(_doctor, msg.sender);
    }

    function _authorizeLab(address _lab) internal {
        diagnosticsLabToHospital[_lab] = msg.sender;
        emit DiagnosticsLabAuthorized(_lab, msg.sender);
    }

    function _unauthorizeLab(address _lab) internal {
        address hospital = diagnosticsLabToHospital[_lab];
        require(hospital != address(0), "Not authorized");
        require(hospital == msg.sender, "Not your lab");

        diagnosticsLabToHospital[_lab] = address(0);
        emit DiagnosticsLabUnauthorized(_lab, msg.sender);
    }
}

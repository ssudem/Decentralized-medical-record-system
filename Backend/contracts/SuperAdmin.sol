// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./BaseStorage.sol";

contract SuperAdmin is BaseStorage {
    modifier onlyAdmin() {
        require(msg.sender == superAdmin, "Only Super Admin can perform this");
        _;
    }

    function _addHospital(address _hospital) internal {
        validHospitals[_hospital] = true;
        emit HospitalAdded(_hospital);
    }

    function _removeHospital(address _hospital) internal {
        require(validHospitals[_hospital], "Hospital not registered");
        validHospitals[_hospital] = false;
        emit HospitalRemoved(_hospital);
    }
}

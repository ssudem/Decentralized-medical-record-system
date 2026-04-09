// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./BaseStorage.sol";

contract SuperAdmin is BaseStorage {
    modifier onlyAdmin() {
        if (msg.sender != superAdmin) revert Unauthorized();
        _;
    }

    function _addHospital(address _hospital) internal {
        // GAS OPT: skip redundant SSTORE if already valid (saves ~2900 gas on duplicate calls)
        if (validHospitals[_hospital]) return;
        validHospitals[_hospital] = true;
        emit HospitalAdded(_hospital);
    }

    function _removeHospital(address _hospital) internal {
        if (!validHospitals[_hospital]) revert NotRegistered();
        validHospitals[_hospital] = false;
        emit HospitalRemoved(_hospital);
    }
}

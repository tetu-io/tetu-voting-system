// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VotingCore} from "./VotingCore.sol";

contract VotingCoreV2 is VotingCore {
    function initializeV2() external reinitializer(2) {}

    function version() external pure returns (string memory) {
        return "v2";
    }
}

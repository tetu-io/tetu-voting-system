// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Vote Token", "MVT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

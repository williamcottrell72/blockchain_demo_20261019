// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {CurveTokenFactory} from "../src/CurveTokenFactory.sol";

contract DeployCurveTokenFactory is Script {
    function run() external returns (CurveTokenFactory factory) {
        uint256 creationFee = vm.envOr("CREATION_FEE", uint256(0.01 ether));
        address initialOwner = vm.envOr("INITIAL_OWNER", msg.sender);

        vm.startBroadcast();
        factory = new CurveTokenFactory(creationFee, initialOwner);
        vm.stopBroadcast();
    }
}

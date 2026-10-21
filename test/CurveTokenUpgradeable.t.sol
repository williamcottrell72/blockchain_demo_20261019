// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {CurveToken} from "../src/CurveToken.sol";
import {CurveTokenFactory} from "../src/CurveTokenFactory.sol";
import {CurveTokenUpgradeable} from "../src/CurveTokenUpgradeable.sol";

/// @dev Example second version: same storage layout, new logic.
contract CurveTokenUpgradeableV2 is CurveTokenUpgradeable {
    function version() external pure override returns (uint256) {
        return 2;
    }

    function greeting() external pure returns (string memory) {
        return "upgraded";
    }
}

contract CurveTokenUpgradeableTest is Test {
    CurveTokenFactory private factory;

    address private owner = address(0xA11CE);
    address private creator = address(0xB0B);
    address private buyer = address(0xBEEF);
    uint256 private fee = 0.01 ether;
    uint256 private upgradeFee = 0.005 ether;

    function setUp() public {
        factory = new CurveTokenFactory(fee, owner, upgradeFee);
        vm.deal(creator, 10 ether);
        vm.deal(buyer, 10 ether);
    }

    function _linearConfig() private pure returns (CurveToken.BondingCurveConfig memory) {
        return
            CurveToken.BondingCurveConfig({
                curveType: 1, basePrice: 10, slope: 2, reserveRatioBps: 1_000, maxSupply: 100
            });
    }

    function _createUpgradeable(uint256 initialSupply) private returns (CurveTokenUpgradeable) {
        vm.prank(creator);
        address token = factory.createUpgradeableToken{
            value: fee + upgradeFee
        }("Proxy Token", "PRXY", initialSupply, _linearConfig());
        return CurveTokenUpgradeable(token);
    }

    function _implementationOf(address proxy) private view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967Utils.IMPLEMENTATION_SLOT))));
    }

    function testCreateUpgradeableTokenDeploysInitializedProxy() public {
        CurveTokenUpgradeable token = _createUpgradeable(5);

        assertTrue(factory.isUpgradeable(address(token)));
        assertEq(factory.tokenCount(), 1);
        assertEq(factory.tokenCreator(address(token)), creator);
        assertEq(address(factory).balance, fee + upgradeFee);
        assertEq(_implementationOf(address(token)), factory.upgradeableImplementation());
        assertEq(token.name(), "Proxy Token");
        assertEq(token.symbol(), "PRXY");
        assertEq(token.owner(), creator);
        assertEq(token.factory(), address(factory));
        assertEq(token.balanceOf(creator), 5);
        assertEq(token.version(), 1);
        assertEq(token.quoteMintCost(3), 66);
    }

    function testFixedTokenIsNotUpgradeable() public {
        CurveToken.BondingCurveConfig memory config;

        vm.prank(creator);
        address token = factory.createToken{value: fee}("Fixed", "FIX", 0, config);

        assertFalse(factory.isUpgradeable(token));
    }

    function testCreateUpgradeableTokenRequiresExtraFee() public {
        CurveToken.BondingCurveConfig memory config;

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(CurveTokenFactory.FeeTooLow.selector, fee + upgradeFee, fee));
        factory.createUpgradeableToken{value: fee}("Proxy Token", "PRXY", 0, config);
    }

    function testOwnerCanUpdateBondingCurve() public {
        CurveTokenUpgradeable token = _createUpgradeable(0);
        CurveToken.BondingCurveConfig memory newConfig =
            CurveToken.BondingCurveConfig({curveType: 0, basePrice: 7, slope: 0, reserveRatioBps: 2_500, maxSupply: 0});

        vm.prank(creator);
        token.updateBondingCurve(newConfig);

        (uint8 curveType, uint256 basePrice,, uint256 reserveRatioBps, uint256 maxSupply) = token.bondingCurve();
        assertEq(curveType, 0);
        assertEq(basePrice, 7);
        assertEq(reserveRatioBps, 2_500);
        assertEq(maxSupply, 0);
        assertEq(token.quoteMintCost(3), 21);
    }

    function testNonOwnerCannotUpdateBondingCurve() public {
        CurveTokenUpgradeable token = _createUpgradeable(0);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, buyer));
        token.updateBondingCurve(_linearConfig());
    }

    function testUpdateBondingCurveRejectsCapBelowSupply() public {
        CurveTokenUpgradeable token = _createUpgradeable(50);
        CurveToken.BondingCurveConfig memory newConfig = _linearConfig();
        newConfig.maxSupply = 49;

        vm.prank(creator);
        vm.expectRevert(CurveTokenUpgradeable.CapExceeded.selector);
        token.updateBondingCurve(newConfig);
    }

    function testUpdateBondingCurveRejectsReserveAboveMax() public {
        CurveTokenUpgradeable token = _createUpgradeable(0);
        CurveToken.BondingCurveConfig memory newConfig = _linearConfig();
        newConfig.reserveRatioBps = 10_001;

        vm.prank(creator);
        vm.expectRevert(CurveTokenUpgradeable.InvalidConfig.selector);
        token.updateBondingCurve(newConfig);
    }

    function testOwnerCanUpgradeAndStateIsPreserved() public {
        CurveTokenUpgradeable token = _createUpgradeable(5);

        uint256 cost = token.quoteMintCost(3);
        vm.prank(buyer);
        token.mintFromCurve{value: cost}(3);

        CurveTokenUpgradeableV2 v2 = new CurveTokenUpgradeableV2();
        vm.prank(creator);
        token.upgradeToAndCall(address(v2), "");

        assertEq(_implementationOf(address(token)), address(v2));
        assertEq(token.version(), 2);
        assertEq(CurveTokenUpgradeableV2(address(token)).greeting(), "upgraded");
        assertEq(token.owner(), creator);
        assertEq(token.balanceOf(creator), 5);
        assertEq(token.balanceOf(buyer), 3);
        assertEq(token.totalSupply(), 8);
        assertEq(address(token).balance, cost);
        (,,,, uint256 maxSupply) = token.bondingCurve();
        assertEq(maxSupply, 100);
    }

    function testNonOwnerCannotUpgrade() public {
        CurveTokenUpgradeable token = _createUpgradeable(0);
        CurveTokenUpgradeableV2 v2 = new CurveTokenUpgradeableV2();

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, buyer));
        token.upgradeToAndCall(address(v2), "");
    }

    function testFactoryOwnerCannotUpgradeUserToken() public {
        CurveTokenUpgradeable token = _createUpgradeable(0);
        CurveTokenUpgradeableV2 v2 = new CurveTokenUpgradeableV2();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, owner));
        token.upgradeToAndCall(address(v2), "");
    }

    function testProxyCannotBeReinitialized() public {
        CurveTokenUpgradeable token = _createUpgradeable(0);

        vm.expectRevert(Initializable.InvalidInitialization.selector);
        token.initialize("Hijack", "HJK", buyer, 0, _linearConfig());
    }

    function testImplementationCannotBeInitialized() public {
        CurveTokenUpgradeable implementation = CurveTokenUpgradeable(factory.upgradeableImplementation());

        vm.expectRevert(Initializable.InvalidInitialization.selector);
        implementation.initialize("Hijack", "HJK", buyer, 0, _linearConfig());
    }

    function testFactoryOwnerCanSetImplementationForFutureTokens() public {
        CurveTokenUpgradeable existing = _createUpgradeable(0);
        CurveTokenUpgradeableV2 v2 = new CurveTokenUpgradeableV2();

        vm.prank(owner);
        factory.setUpgradeableImplementation(address(v2));

        CurveTokenUpgradeable fresh = _createUpgradeable(0);
        assertEq(fresh.version(), 2);
        assertEq(existing.version(), 1);
    }

    function testSetUpgradeableImplementationRejectsNonContract() public {
        vm.prank(owner);
        vm.expectRevert(CurveTokenFactory.InvalidImplementation.selector);
        factory.setUpgradeableImplementation(address(0x1234));
    }

    function testNonOwnerCannotChangeUpgradeSettings() public {
        vm.startPrank(creator);
        vm.expectRevert(CurveTokenFactory.NotAuthorized.selector);
        factory.setUpgradeabilityFee(0);
        vm.expectRevert(CurveTokenFactory.NotAuthorized.selector);
        factory.setUpgradeableImplementation(address(factory));
        vm.stopPrank();
    }
}

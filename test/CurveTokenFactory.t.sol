// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {CurveToken} from "../src/CurveToken.sol";
import {CurveTokenFactory} from "../src/CurveTokenFactory.sol";

contract CurveTokenFactoryTest is Test {
    CurveTokenFactory private factory;

    address private owner = address(0xA11CE);
    address private creator = address(0xB0B);
    address private withdrawer = address(0xCAFE);
    uint256 private fee = 0.01 ether;

    function setUp() public {
        factory = new CurveTokenFactory(fee, owner);
        vm.deal(creator, 10 ether);
    }

    function testCreateTokenCollectsFeeAndAssignsOwnership() public {
        CurveToken.BondingCurveConfig memory config = CurveToken.BondingCurveConfig({
            curveType: 1, basePrice: 1 gwei, slope: 2, reserveRatioBps: 5_000, maxSupply: 1_000_000 ether
        });

        vm.prank(creator);
        address tokenAddress = factory.createToken{value: fee}("Demo Token", "DEMO", 1_000 ether, config);

        CurveToken token = CurveToken(tokenAddress);

        assertEq(factory.tokenCount(), 1);
        assertEq(factory.tokenAt(0), tokenAddress);
        assertEq(factory.tokenCreator(tokenAddress), creator);
        assertEq(address(factory).balance, fee);
        assertEq(token.name(), "Demo Token");
        assertEq(token.symbol(), "DEMO");
        assertEq(token.owner(), creator);
        assertEq(token.balanceOf(creator), 1_000 ether);
        assertEq(token.totalSupply(), 1_000 ether);
    }

    function testCreateTokenRevertsWhenFeeIsTooLow() public {
        CurveToken.BondingCurveConfig memory config;

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(CurveTokenFactory.FeeTooLow.selector, fee, fee - 1));
        factory.createToken{value: fee - 1}("Demo Token", "DEMO", 0, config);
    }

    function testOwnerCanAuthorizeWithdrawerAndWithdrawFees() public {
        CurveToken.BondingCurveConfig memory config;

        vm.prank(creator);
        factory.createToken{value: fee}("Demo Token", "DEMO", 1 ether, config);

        vm.prank(owner);
        factory.setFeeWithdrawer(withdrawer, true);

        uint256 recipientBefore = withdrawer.balance;

        vm.prank(withdrawer);
        uint256 withdrawn = factory.withdrawFees(payable(withdrawer));

        assertEq(withdrawn, fee);
        assertEq(withdrawer.balance, recipientBefore + fee);
        assertEq(address(factory).balance, 0);
    }

    function testUnauthorizedAddressCannotWithdrawFees() public {
        vm.prank(creator);
        vm.expectRevert(CurveTokenFactory.NotAuthorized.selector);
        factory.withdrawFees(payable(creator));
    }

    function testTokenOwnerCanMintWithinCap() public {
        CurveToken.BondingCurveConfig memory config = CurveToken.BondingCurveConfig({
            curveType: 0, basePrice: 1 gwei, slope: 0, reserveRatioBps: 0, maxSupply: 3 ether
        });

        vm.prank(creator);
        CurveToken token = CurveToken(factory.createToken{value: fee}("Demo Token", "DEMO", 1 ether, config));

        vm.prank(creator);
        token.mint(creator, 2 ether);

        assertEq(token.totalSupply(), 3 ether);
        assertEq(token.balanceOf(creator), 3 ether);
    }

    function testTokenMintRevertsAboveCap() public {
        CurveToken.BondingCurveConfig memory config = CurveToken.BondingCurveConfig({
            curveType: 0, basePrice: 0, slope: 0, reserveRatioBps: 0, maxSupply: 1 ether
        });

        vm.prank(creator);
        CurveToken token = CurveToken(factory.createToken{value: fee}("Demo Token", "DEMO", 1 ether, config));

        vm.prank(creator);
        vm.expectRevert(CurveToken.CapExceeded.selector);
        token.mint(creator, 1);
    }

    function testQuoteMintCostUsesConfiguredCurve() public {
        CurveToken.BondingCurveConfig memory config = CurveToken.BondingCurveConfig({
            curveType: 1, basePrice: 10, slope: 2, reserveRatioBps: 1_000, maxSupply: 0
        });

        vm.prank(creator);
        CurveToken token = CurveToken(factory.createToken{value: fee}("Demo Token", "DEMO", 5, config));

        assertEq(token.quoteMintCost(3), 66);
    }
}

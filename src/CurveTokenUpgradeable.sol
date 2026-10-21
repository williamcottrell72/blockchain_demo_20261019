// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {CurveToken} from "./CurveToken.sol";

/// @notice Upgradeable twin of `CurveToken`, meant to sit behind an ERC-1967 proxy (UUPS pattern).
/// @dev The proxy holds all storage and ETH; this contract only supplies logic. Because the proxy
///      never runs this constructor, setup happens in `initialize`, and the upgrade entry point
///      (`upgradeToAndCall`, inherited from `UUPSUpgradeable`) lives here rather than in the proxy.
///      Future versions must keep the existing state variable order and only append new ones.
contract CurveTokenUpgradeable is Initializable, ERC20Upgradeable, OwnableUpgradeable, UUPSUpgradeable {
    address public factory;
    CurveToken.BondingCurveConfig public bondingCurve;

    error AmountZero();
    error CapExceeded();
    error IncorrectPayment(uint256 required, uint256 received);
    error InvalidConfig();
    error WithdrawalFailed();
    error ZeroAddress();

    event BondingCurveUpdated(CurveToken.BondingCurveConfig previousConfig, CurveToken.BondingCurveConfig newConfig);
    event CurveMint(address indexed buyer, uint256 amount, uint256 cost);
    event ProceedsWithdrawn(address indexed to, uint256 amount);

    /// @dev Locks the implementation contract itself so nobody can initialize and take it over.
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory tokenName,
        string memory tokenSymbol,
        address tokenOwner,
        uint256 initialSupply,
        CurveToken.BondingCurveConfig memory curveConfig
    ) external initializer {
        if (bytes(tokenName).length == 0 || bytes(tokenSymbol).length == 0) {
            revert InvalidConfig();
        }
        _validateCurve(curveConfig, initialSupply);

        __ERC20_init(tokenName, tokenSymbol);
        __Ownable_init(tokenOwner);

        factory = msg.sender;
        bondingCurve = curveConfig;

        if (initialSupply != 0) {
            _mintWithCap(tokenOwner, initialSupply);
        }
    }

    /// @notice Implementation version, so callers can see which logic the proxy currently points at.
    function version() external pure virtual returns (uint256) {
        return 1;
    }

    /// @notice Owner-only update of the stored curve parameters. Only upgradeable tokens offer this.
    function updateBondingCurve(CurveToken.BondingCurveConfig calldata newConfig) external onlyOwner {
        _validateCurve(newConfig, totalSupply());

        CurveToken.BondingCurveConfig memory previousConfig = bondingCurve;
        bondingCurve = newConfig;

        emit BondingCurveUpdated(previousConfig, newConfig);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mintWithCap(to, amount);
    }

    function burn(uint256 amount) external {
        if (amount == 0) revert AmountZero();
        _burn(msg.sender, amount);
    }

    function mintFromCurve(uint256 amount) external payable returns (uint256 cost) {
        cost = _quoteMintCost(amount);
        if (msg.value != cost) revert IncorrectPayment(cost, msg.value);

        _mintWithCap(msg.sender, amount);
        emit CurveMint(msg.sender, amount, cost);
    }

    function withdrawProceeds(address payable to) external onlyOwner returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();

        amount = address(this).balance;
        (bool success,) = to.call{value: amount}("");
        if (!success) revert WithdrawalFailed();

        emit ProceedsWithdrawn(to, amount);
    }

    function quoteMintCost(uint256 amount) external view returns (uint256) {
        return _quoteMintCost(amount);
    }

    /// @dev UUPS hook: only the token owner may point this proxy at new logic.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    function _validateCurve(CurveToken.BondingCurveConfig memory curveConfig, uint256 supply) internal pure {
        if (curveConfig.reserveRatioBps > 10_000) revert InvalidConfig();
        if (curveConfig.maxSupply != 0 && supply > curveConfig.maxSupply) revert CapExceeded();
    }

    function _quoteMintCost(uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;

        CurveToken.BondingCurveConfig memory curve = bondingCurve;
        if (curve.curveType == 0) {
            return curve.basePrice * amount;
        }

        uint256 supply = totalSupply();
        uint256 startingPrice = curve.basePrice + (curve.slope * supply);
        uint256 endingPrice = curve.basePrice + (curve.slope * (supply + amount - 1));
        return ((startingPrice + endingPrice) * amount) / 2;
    }

    function _mintWithCap(address to, uint256 amount) internal {
        if (amount == 0) revert AmountZero();

        uint256 newSupply = totalSupply() + amount;
        uint256 cap = bondingCurve.maxSupply;
        if (cap != 0 && newSupply > cap) revert CapExceeded();

        _mint(to, amount);
    }
}

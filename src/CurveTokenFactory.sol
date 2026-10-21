// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {CurveToken} from "./CurveToken.sol";
import {CurveTokenUpgradeable} from "./CurveTokenUpgradeable.sol";

/// @notice Deploys owner-controlled ERC20 tokens and collects a configurable creation fee.
/// @dev Tokens come in two flavors: fixed `CurveToken` contracts, or, for an extra
///      `upgradeabilityFee`, UUPS proxies that delegate to a shared `CurveTokenUpgradeable` implementation.
contract CurveTokenFactory {
    address public owner;
    uint256 public creationFee;
    uint256 public upgradeabilityFee;
    address public upgradeableImplementation;

    address[] private tokens;
    mapping(address token => address creator) public tokenCreator;
    mapping(address token => bool upgradeable) public isUpgradeable;
    mapping(address account => bool allowed) public feeWithdrawer;

    error FeeTooLow(uint256 required, uint256 received);
    error InvalidImplementation();
    error NotAuthorized();
    error ZeroAddress();
    error WithdrawalFailed();

    event CreationFeeUpdated(uint256 previousFee, uint256 newFee);
    event FeeWithdrawerUpdated(address indexed account, bool allowed);
    event UpgradeabilityFeeUpdated(uint256 previousFee, uint256 newFee);
    event UpgradeableImplementationUpdated(address indexed previousImplementation, address indexed newImplementation);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TokenCreated(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        uint256 initialSupply,
        CurveToken.BondingCurveConfig curveConfig
    );
    event UpgradeableTokenCreated(address indexed token, address indexed implementation);
    event FeesWithdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    modifier onlyFeeWithdrawer() {
        _checkFeeWithdrawer();
        _;
    }

    constructor(uint256 initialCreationFee, address initialOwner, uint256 initialUpgradeabilityFee) {
        if (initialOwner == address(0)) revert ZeroAddress();

        owner = initialOwner;
        creationFee = initialCreationFee;
        upgradeabilityFee = initialUpgradeabilityFee;
        upgradeableImplementation = address(new CurveTokenUpgradeable());
        emit OwnershipTransferred(address(0), initialOwner);
        emit CreationFeeUpdated(0, initialCreationFee);
        emit UpgradeabilityFeeUpdated(0, initialUpgradeabilityFee);
        emit UpgradeableImplementationUpdated(address(0), upgradeableImplementation);
    }

    function createToken(
        string calldata tokenName,
        string calldata tokenSymbol,
        uint256 initialSupply,
        CurveToken.BondingCurveConfig calldata curveConfig
    ) external payable returns (address token) {
        if (msg.value < creationFee) {
            revert FeeTooLow(creationFee, msg.value);
        }

        token = address(new CurveToken(tokenName, tokenSymbol, msg.sender, initialSupply, curveConfig));
        _registerToken(token, tokenName, tokenSymbol, initialSupply, curveConfig);
    }

    /// @notice Deploys an ERC-1967 proxy whose owner can later change curve parameters or upgrade its logic.
    function createUpgradeableToken(
        string calldata tokenName,
        string calldata tokenSymbol,
        uint256 initialSupply,
        CurveToken.BondingCurveConfig calldata curveConfig
    ) external payable returns (address token) {
        uint256 requiredFee = creationFee + upgradeabilityFee;
        if (msg.value < requiredFee) {
            revert FeeTooLow(requiredFee, msg.value);
        }

        address implementation = upgradeableImplementation;
        bytes memory initData = abi.encodeCall(
            CurveTokenUpgradeable.initialize, (tokenName, tokenSymbol, msg.sender, initialSupply, curveConfig)
        );
        token = address(new ERC1967Proxy(implementation, initData));
        isUpgradeable[token] = true;
        _registerToken(token, tokenName, tokenSymbol, initialSupply, curveConfig);

        emit UpgradeableTokenCreated(token, implementation);
    }

    function allTokens() external view returns (address[] memory) {
        return tokens;
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function tokenAt(uint256 index) external view returns (address) {
        return tokens[index];
    }

    function setCreationFee(uint256 newFee) external onlyOwner {
        uint256 previousFee = creationFee;
        creationFee = newFee;
        emit CreationFeeUpdated(previousFee, newFee);
    }

    function setUpgradeabilityFee(uint256 newFee) external onlyOwner {
        uint256 previousFee = upgradeabilityFee;
        upgradeabilityFee = newFee;
        emit UpgradeabilityFeeUpdated(previousFee, newFee);
    }

    /// @notice Changes the logic used by future upgradeable tokens. Existing proxies are untouched;
    ///         only each token's own owner can upgrade it.
    function setUpgradeableImplementation(address newImplementation) external onlyOwner {
        if (newImplementation.code.length == 0) revert InvalidImplementation();

        address previousImplementation = upgradeableImplementation;
        upgradeableImplementation = newImplementation;
        emit UpgradeableImplementationUpdated(previousImplementation, newImplementation);
    }

    function setFeeWithdrawer(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();

        feeWithdrawer[account] = allowed;
        emit FeeWithdrawerUpdated(account, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();

        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function withdrawFees(address payable to) external onlyFeeWithdrawer returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();

        amount = address(this).balance;
        (bool success,) = to.call{value: amount}("");
        if (!success) revert WithdrawalFailed();

        emit FeesWithdrawn(to, amount);
    }

    function _registerToken(
        address token,
        string calldata tokenName,
        string calldata tokenSymbol,
        uint256 initialSupply,
        CurveToken.BondingCurveConfig calldata curveConfig
    ) internal {
        tokens.push(token);
        tokenCreator[token] = msg.sender;

        emit TokenCreated(token, msg.sender, tokenName, tokenSymbol, initialSupply, curveConfig);
    }

    function _checkOwner() internal view {
        if (msg.sender != owner) revert NotAuthorized();
    }

    function _checkFeeWithdrawer() internal view {
        if (msg.sender != owner && !feeWithdrawer[msg.sender]) revert NotAuthorized();
    }
}

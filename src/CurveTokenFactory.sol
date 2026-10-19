// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CurveToken} from "./CurveToken.sol";

/// @notice Deploys owner-controlled ERC20 tokens and collects a configurable creation fee.
contract CurveTokenFactory {
    address public owner;
    uint256 public creationFee;

    address[] private tokens;
    mapping(address token => address creator) public tokenCreator;
    mapping(address account => bool allowed) public feeWithdrawer;

    error FeeTooLow(uint256 required, uint256 received);
    error NotAuthorized();
    error ZeroAddress();
    error WithdrawalFailed();

    event CreationFeeUpdated(uint256 previousFee, uint256 newFee);
    event FeeWithdrawerUpdated(address indexed account, bool allowed);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TokenCreated(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        uint256 initialSupply,
        CurveToken.BondingCurveConfig curveConfig
    );
    event FeesWithdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    modifier onlyFeeWithdrawer() {
        _checkFeeWithdrawer();
        _;
    }

    constructor(uint256 initialCreationFee, address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();

        owner = initialOwner;
        creationFee = initialCreationFee;
        emit OwnershipTransferred(address(0), initialOwner);
        emit CreationFeeUpdated(0, initialCreationFee);
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
        tokens.push(token);
        tokenCreator[token] = msg.sender;

        emit TokenCreated(token, msg.sender, tokenName, tokenSymbol, initialSupply, curveConfig);
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

    function _checkOwner() internal view {
        if (msg.sender != owner) revert NotAuthorized();
    }

    function _checkFeeWithdrawer() internal view {
        if (msg.sender != owner && !feeWithdrawer[msg.sender]) revert NotAuthorized();
    }
}

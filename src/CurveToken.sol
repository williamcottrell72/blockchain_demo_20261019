// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice ERC20 owned by the account that created it through the factory.
contract CurveToken is ERC20, Ownable {
    struct BondingCurveConfig {
        uint8 curveType;
        uint256 basePrice;
        uint256 slope;
        uint256 reserveRatioBps;
        uint256 maxSupply;
    }

    address public immutable FACTORY;
    BondingCurveConfig public bondingCurve;

    error AmountZero();
    error CapExceeded();
    error IncorrectPayment(uint256 required, uint256 received);
    error InvalidConfig();
    error WithdrawalFailed();
    error ZeroAddress();

    event CurveMint(address indexed buyer, uint256 amount, uint256 cost);
    event ProceedsWithdrawn(address indexed to, uint256 amount);

    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        address tokenOwner,
        uint256 initialSupply,
        BondingCurveConfig memory curveConfig
    ) ERC20(tokenName, tokenSymbol) Ownable(tokenOwner) {
        if (bytes(tokenName).length == 0 || bytes(tokenSymbol).length == 0) {
            revert InvalidConfig();
        }
        if (curveConfig.reserveRatioBps > 10_000) revert InvalidConfig();
        if (curveConfig.maxSupply != 0 && initialSupply > curveConfig.maxSupply) revert CapExceeded();

        FACTORY = msg.sender;
        bondingCurve = curveConfig;

        if (initialSupply != 0) {
            _mintWithCap(tokenOwner, initialSupply);
        }
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

    /// @notice Quotes a linear curve cost for minting `amount` from the current supply.
    /// @dev This helper does not collect reserve assets. It gives callers a deterministic
    ///      price surface to use in surrounding sale logic or frontends.
    function quoteMintCost(uint256 amount) external view returns (uint256) {
        return _quoteMintCost(amount);
    }

    function _quoteMintCost(uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;

        BondingCurveConfig memory curve = bondingCurve;
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

        super._mint(to, amount);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IMarketCalendar } from "./interfaces/IMarketCalendar.sol";

/// @notice Our project token: a mock tokenized T-bill fund share (sBILL).
/// Investors buy shares with tUSDC and redeem them at NAV, but only while the market is open.
/// NAV accrues at a fixed annual rate set at deployment, so no one posts prices for it.
/// The fund pays interest out of a tUSDC reserve funded at deployment.
contract SBill is ERC20 {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IMarketCalendar public immutable calendar;
    /// @notice Simple annual interest in basis points, e.g. 400 = 4.00%.
    uint256 public immutable apyBps;
    uint256 public immutable startTime;

    event Subscribed(address indexed investor, uint256 usdcIn, uint256 shares, uint256 nav);
    event Redeemed(address indexed investor, uint256 shares, uint256 usdcOut, uint256 nav);

    error MarketClosed();
    error ZeroAmount();

    constructor(IERC20 usdc_, IMarketCalendar calendar_, uint256 apyBps_) ERC20("Tokenized T-Bill Share", "sBILL") {
        usdc = usdc_;
        calendar = calendar_;
        apyBps = apyBps_;
        startTime = block.timestamp;
    }

    /// @notice tUSDC per sBILL, 18 decimals. Starts at 1.0 and grows linearly.
    function nav() public view returns (uint256) {
        return 1e18 + (1e18 * apyBps * (block.timestamp - startTime)) / (10_000 * 365 days);
    }

    function valueOf(uint256 shares) public view returns (uint256) {
        return (shares * nav()) / 1e18;
    }

    function subscribe(uint256 usdcAmount) external returns (uint256 shares) {
        if (!calendar.isOpen()) revert MarketClosed();
        if (usdcAmount == 0) revert ZeroAmount();
        uint256 price = nav();
        shares = (usdcAmount * 1e18) / price;
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        _mint(msg.sender, shares);
        emit Subscribed(msg.sender, usdcAmount, shares, price);
    }

    function redeem(uint256 shares) external returns (uint256 usdcOut) {
        if (!calendar.isOpen()) revert MarketClosed();
        if (shares == 0) revert ZeroAmount();
        uint256 price = nav();
        usdcOut = (shares * price) / 1e18;
        _burn(msg.sender, shares);
        usdc.safeTransfer(msg.sender, usdcOut);
        emit Redeemed(msg.sender, shares, usdcOut, price);
    }
}

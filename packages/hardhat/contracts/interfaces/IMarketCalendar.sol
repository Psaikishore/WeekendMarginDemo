// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice What the fund, the vault and the clearinghouse need to know about the T-bill market.
interface IMarketCalendar {
    function isOpen() external view returns (bool);

    function isWeekend() external view returns (bool);

    /// @notice Seconds until the market opens; 0 when it is open.
    function secondsUntilOpen() external view returns (uint256);

    /// @notice True for the demo calendar, whose weekend is switched by an operator.
    function isDemo() external view returns (bool);
}

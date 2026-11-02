// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IMarketCalendar } from "./interfaces/IMarketCalendar.sol";

/// @notice The real calendar: the T-bill market is closed from Friday 21:00 to Monday 14:00 UTC.
/// That is 4pm to 9am New York time in winter, 65 hours, the closure the financial analysis uses.
/// It has no owner and no settings, so nobody can change it. It does not know about holidays or
/// daylight saving, which the project report states as limits.
contract MarketCalendar is IMarketCalendar {
    uint256 private constant MONDAY_OPEN = 1 days + 14 hours;
    uint256 private constant FRIDAY_CLOSE = 5 days + 21 hours;

    /// @notice Seconds since Sunday 00:00 UTC. 1 January 1970 was a Thursday, 4 days after a Sunday.
    function secondsIntoWeek(uint256 timestamp) public pure returns (uint256) {
        return (timestamp + 4 days) % 7 days;
    }

    function isWeekend() public view returns (bool) {
        uint256 s = secondsIntoWeek(block.timestamp);
        return s < MONDAY_OPEN || s >= FRIDAY_CLOSE;
    }

    function isOpen() public view returns (bool) {
        return !isWeekend();
    }

    function secondsUntilOpen() external view returns (uint256) {
        uint256 s = secondsIntoWeek(block.timestamp);
        if (s < MONDAY_OPEN) return MONDAY_OPEN - s;
        if (s >= FRIDAY_CLOSE) return 7 days - s + MONDAY_OPEN;
        return 0;
    }

    function isDemo() external pure returns (bool) {
        return false;
    }
}

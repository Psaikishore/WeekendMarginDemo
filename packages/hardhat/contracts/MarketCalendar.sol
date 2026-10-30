// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IMarketCalendar } from "./interfaces/IMarketCalendar.sol";

/// @notice The real calendar: the T-bill market is closed from Saturday 00:00 to Monday 00:00 UTC.
/// It has no owner and no settings, so nobody can change when the weekend happens.
contract MarketCalendar is IMarketCalendar {
    /// @notice 0 = Sunday ... 6 = Saturday. 1 January 1970 was a Thursday (4).
    function dayOfWeek(uint256 timestamp) public pure returns (uint256) {
        return (timestamp / 1 days + 4) % 7;
    }

    function isWeekend() public view returns (bool) {
        uint256 day = dayOfWeek(block.timestamp);
        return day == 0 || day == 6;
    }

    function isOpen() public view returns (bool) {
        return !isWeekend();
    }

    function secondsUntilOpen() external view returns (uint256) {
        uint256 day = dayOfWeek(block.timestamp);
        if (day != 0 && day != 6) return 0;
        uint256 daysLeft = day == 6 ? 2 : 1;
        return daysLeft * 1 days - (block.timestamp % 1 days);
    }

    function isDemo() external pure returns (bool) {
        return false;
    }
}

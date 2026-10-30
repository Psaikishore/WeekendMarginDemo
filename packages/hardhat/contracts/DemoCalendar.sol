// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IMarketCalendar } from "./interfaces/IMarketCalendar.sol";

/// @notice Demo-only calendar. The operator switches the "weekend" on and off so the weekend path can
/// be shown on any day. It is used only by the labelled demo deployment; the main deployment uses
/// MarketCalendar, which nobody can change.
contract DemoCalendar is IMarketCalendar, Ownable {
    bool public weekend;

    event DemoWeekendSet(bool weekend);

    constructor(address operator) Ownable(operator) {}

    function setWeekend(bool weekend_) external onlyOwner {
        weekend = weekend_;
        emit DemoWeekendSet(weekend_);
    }

    function isWeekend() external view returns (bool) {
        return weekend;
    }

    function isOpen() external view returns (bool) {
        return !weekend;
    }

    /// @dev The demo weekend ends when the operator switches it off, so there is no countdown.
    function secondsUntilOpen() external view returns (uint256) {
        return weekend ? type(uint256).max : 0;
    }

    function isDemo() external pure returns (bool) {
        return true;
    }
}

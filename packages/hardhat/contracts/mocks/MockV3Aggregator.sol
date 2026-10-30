// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { AggregatorV3Interface } from "../interfaces/AggregatorV3Interface.sol";

/// @notice Local stand-in for the Chainlink BTC/USD feed. Used only on the Hardhat network.
contract MockV3Aggregator is AggregatorV3Interface {
    uint8 public immutable decimals;

    uint80 private roundId;
    int256 private answer;
    uint256 private updatedAt;

    constructor(uint8 decimals_, int256 initialAnswer) {
        decimals = decimals_;
        updateAnswer(initialAnswer);
    }

    function description() external pure returns (string memory) {
        return "Mock BTC / USD";
    }

    function updateAnswer(int256 newAnswer) public {
        setRoundData(newAnswer, block.timestamp);
    }

    /// @dev Lets tests publish a round with an old timestamp to exercise the staleness check.
    function setRoundData(int256 newAnswer, uint256 newUpdatedAt) public {
        roundId++;
        answer = newAnswer;
        updatedAt = newUpdatedAt;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }
}

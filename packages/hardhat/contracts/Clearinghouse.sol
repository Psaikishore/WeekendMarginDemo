// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SignedMath } from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";
import { SBill } from "./SBill.sol";
import { WeekendVault } from "./WeekendVault.sol";
import { IMarketCalendar } from "./interfaces/IMarketCalendar.sol";

/// @notice A small clearinghouse for Bitcoin perpetual swaps between two traders.
///
/// Each trade has one long and one short account. Settlement pays the price change since the last
/// settlement, plus funding, from the losing account to the winning one, in tUSDC. If the loser has
/// run out of tUSDC, the clearinghouse turns its sBILL into tUSDC: through the fund on business
/// days, and by selling it to the weekend vault (at a small discount) when the fund is closed.
///
/// The owner can pause new deposits and new trades, and post the funding rate within a fixed cap.
/// Settlement, liquidation, closing and withdrawals keep working while paused.
contract Clearinghouse is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Params {
        /// Oldest Chainlink price accepted, in seconds. Must be above the feed's 1-hour heartbeat.
        uint256 maxPriceAge;
        /// Margin needed to open a trade or withdraw, as a share of notional.
        uint256 initialMarginBps;
        /// Below this share of notional an account can be liquidated.
        uint256 maintenanceMarginBps;
        /// sBILL counts for (1 - haircut) of its NAV value as margin.
        uint256 weekdayHaircutBps;
        uint256 weekendHaircutBps;
        /// Paid to whoever liquidates an account, as a share of notional.
        uint256 liquidationRewardBps;
        /// Largest funding rate the owner may post, per hour, 18 decimals (1e18 = 100%).
        uint256 maxFundingRatePerHour;
    }

    struct Account {
        uint256 usdc;
        uint256 sbill;
        uint256 tradeId;
        uint256 offerId;
    }

    struct Offer {
        address maker;
        bool makerIsLong;
        uint256 size;
    }

    struct Trade {
        address long;
        address short;
        uint256 size;
        uint256 lastPrice;
        uint256 lastSettledAt;
        bool open;
    }

    uint256 private constant BPS = 10_000;

    IERC20 public immutable usdc;
    SBill public immutable sBill;
    WeekendVault public immutable vault;
    IMarketCalendar public immutable calendar;
    AggregatorV3Interface public immutable priceFeed;
    uint256 private immutable priceScale;

    uint256 public immutable maxPriceAge;
    uint256 public immutable initialMarginBps;
    uint256 public immutable maintenanceMarginBps;
    uint256 public immutable weekdayHaircutBps;
    uint256 public immutable weekendHaircutBps;
    uint256 public immutable liquidationRewardBps;
    uint256 public immutable maxFundingRatePerHour;

    /// @notice Funding per hour as a share of notional, 18 decimals. Positive: longs pay shorts.
    int256 public fundingRatePerHour;

    mapping(address => Account) public accounts;
    mapping(uint256 => Offer) public offers;
    mapping(uint256 => Trade) public trades;
    uint256 public nextOfferId = 1;
    uint256 public nextTradeId = 1;

    event Deposited(address indexed account, address indexed token, uint256 amount);
    event Withdrawn(address indexed account, address indexed token, uint256 amount);
    event OfferPosted(uint256 indexed offerId, address indexed maker, bool makerIsLong, uint256 size);
    event OfferCancelled(uint256 indexed offerId);
    event TradeOpened(
        uint256 indexed tradeId,
        address indexed long,
        address indexed short,
        uint256 size,
        uint256 price
    );
    event Settled(
        uint256 indexed tradeId,
        uint256 price,
        address payer,
        address receiver,
        uint256 amountDue,
        uint256 amountPaid
    );
    /// @dev `longPays` is the funding part of the settlement: positive when the long paid the short.
    event FundingApplied(uint256 indexed tradeId, int256 ratePerHour, uint256 elapsed, int256 longPays);
    event FundingRateUpdated(int256 ratePerHour);
    event CollateralConverted(address indexed account, uint256 sbillSold, uint256 usdcRaised, bool viaVault);
    event TradeClosed(uint256 indexed tradeId, uint256 price);
    event Liquidated(uint256 indexed tradeId, address indexed account, address indexed liquidator, uint256 reward);

    error InvalidParams();
    error ZeroAmount();
    error InvalidPrice(int256 answer);
    error IncompletePriceRound();
    error StalePrice(uint256 updatedAt);
    error HasOpenTrade();
    error HasActiveOffer();
    error NoActiveOffer();
    error OfferNotActive();
    error CannotTakeOwnOffer();
    error InsufficientBalance();
    error InsufficientMargin(uint256 value, uint256 required);
    error TradeNotOpen();
    error NotTradeParty();
    error UnexpectedVaultFill();
    error FundingRateTooHigh(int256 rate);
    error NotLiquidatable();

    constructor(
        IERC20 usdc_,
        SBill sBill_,
        WeekendVault vault_,
        IMarketCalendar calendar_,
        AggregatorV3Interface priceFeed_,
        Params memory params,
        address guardian
    ) Ownable(guardian) {
        if (
            params.maxPriceAge <= 1 hours ||
            params.maintenanceMarginBps == 0 ||
            params.maintenanceMarginBps >= params.initialMarginBps ||
            params.initialMarginBps > BPS ||
            params.weekdayHaircutBps >= BPS ||
            params.weekendHaircutBps >= BPS ||
            params.liquidationRewardBps >= params.maintenanceMarginBps ||
            params.maxFundingRatePerHour > 1e16
        ) revert InvalidParams();
        uint8 feedDecimals = priceFeed_.decimals();
        if (feedDecimals > 18) revert InvalidParams();

        usdc = usdc_;
        sBill = sBill_;
        vault = vault_;
        calendar = calendar_;
        priceFeed = priceFeed_;
        priceScale = 10 ** (18 - feedDecimals);

        maxPriceAge = params.maxPriceAge;
        initialMarginBps = params.initialMarginBps;
        maintenanceMarginBps = params.maintenanceMarginBps;
        weekdayHaircutBps = params.weekdayHaircutBps;
        weekendHaircutBps = params.weekendHaircutBps;
        liquidationRewardBps = params.liquidationRewardBps;
        maxFundingRatePerHour = params.maxFundingRatePerHour;

        // The vault pulls sBILL from here when it buys at the weekend.
        IERC20(address(sBill_)).forceApprove(address(vault_), type(uint256).max);
    }

    // ---------------------------------------------------------------- margin in and out

    function depositUsdc(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        accounts[msg.sender].usdc += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, address(usdc), amount);
    }

    function depositSBill(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        accounts[msg.sender].sbill += amount;
        IERC20(address(sBill)).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, address(sBill), amount);
    }

    function withdrawUsdc(uint256 amount) external nonReentrant {
        Account storage a = _prepareWithdrawal(amount);
        if (a.usdc < amount) revert InsufficientBalance();
        a.usdc -= amount;
        _checkMarginAfterWithdrawal(a);
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, address(usdc), amount);
    }

    function withdrawSBill(uint256 amount) external nonReentrant {
        Account storage a = _prepareWithdrawal(amount);
        if (a.sbill < amount) revert InsufficientBalance();
        a.sbill -= amount;
        _checkMarginAfterWithdrawal(a);
        IERC20(address(sBill)).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, address(sBill), amount);
    }

    // ---------------------------------------------------------------- trading

    /// @notice Offer to go long (or short) `size` BTC. Another account opens the trade by accepting.
    function postOffer(bool isLong, uint256 size) external whenNotPaused nonReentrant returns (uint256 offerId) {
        if (size == 0) revert ZeroAmount();
        Account storage a = accounts[msg.sender];
        if (a.tradeId != 0) revert HasOpenTrade();
        if (a.offerId != 0) revert HasActiveOffer();
        _requireMargin(msg.sender, size, _price(), initialMarginBps);

        offerId = nextOfferId++;
        offers[offerId] = Offer(msg.sender, isLong, size);
        a.offerId = offerId;
        emit OfferPosted(offerId, msg.sender, isLong, size);
    }

    function cancelOffer() external nonReentrant {
        Account storage a = accounts[msg.sender];
        uint256 offerId = a.offerId;
        if (offerId == 0) revert NoActiveOffer();
        delete offers[offerId];
        a.offerId = 0;
        emit OfferCancelled(offerId);
    }

    /// @notice Takes the other side of an offer. The trade opens at the current Chainlink price.
    function acceptOffer(uint256 offerId) external whenNotPaused nonReentrant returns (uint256 tradeId) {
        Offer memory o = offers[offerId];
        if (o.maker == address(0)) revert OfferNotActive();
        if (o.maker == msg.sender) revert CannotTakeOwnOffer();
        Account storage taker = accounts[msg.sender];
        if (taker.tradeId != 0) revert HasOpenTrade();
        if (taker.offerId != 0) revert HasActiveOffer();

        uint256 price = _price();
        _requireMargin(o.maker, o.size, price, initialMarginBps);
        _requireMargin(msg.sender, o.size, price, initialMarginBps);

        delete offers[offerId];
        accounts[o.maker].offerId = 0;

        (address long, address short) = o.makerIsLong ? (o.maker, msg.sender) : (msg.sender, o.maker);
        tradeId = nextTradeId++;
        trades[tradeId] = Trade(long, short, o.size, price, block.timestamp, true);
        accounts[long].tradeId = tradeId;
        accounts[short].tradeId = tradeId;
        emit TradeOpened(tradeId, long, short, o.size, price);
    }

    /// @notice Pays the price change and funding since the last settlement. Anyone can call it.
    function settle(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        if (!t.open) revert TradeNotOpen();
        _settle(tradeId, t, _price());
    }

    /// @notice Either side can close the trade; it settles at the current price first.
    function closeTrade(uint256 tradeId) external nonReentrant {
        Trade storage t = trades[tradeId];
        if (!t.open) revert TradeNotOpen();
        if (msg.sender != t.long && msg.sender != t.short) revert NotTradeParty();
        uint256 price = _price();
        _settle(tradeId, t, price);
        _close(tradeId, t, price);
    }

    /// @notice Closes a trade in which one side is below maintenance margin after settlement.
    /// Anyone can call it; the caller receives the liquidation reward in tUSDC.
    function liquidate(uint256 tradeId) external nonReentrant returns (uint256 reward) {
        Trade storage t = trades[tradeId];
        if (!t.open) revert TradeNotOpen();
        uint256 price = _price();
        _settle(tradeId, t, price);

        uint256 maintenance = requiredMargin(t.size, price, maintenanceMarginBps);
        address account;
        if (collateralValue(t.long) < maintenance) account = t.long;
        else if (collateralValue(t.short) < maintenance) account = t.short;
        else revert NotLiquidatable();

        reward = _collect(account, requiredMargin(t.size, price, liquidationRewardBps));
        _close(tradeId, t, price);
        usdc.safeTransfer(msg.sender, reward);
        emit Liquidated(tradeId, account, msg.sender, reward);
    }

    // ---------------------------------------------------------------- owner

    function setFundingRate(int256 ratePerHour) external onlyOwner {
        if (SignedMath.abs(ratePerHour) > maxFundingRatePerHour) revert FundingRateTooHigh(ratePerHour);
        fundingRatePerHour = ratePerHour;
        emit FundingRateUpdated(ratePerHour);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------- views

    /// @notice Latest Chainlink BTC/USD price scaled to 18 decimals, after staleness and sign checks.
    function latestPrice() external view returns (uint256) {
        return _price();
    }

    function haircutBps() public view returns (uint256) {
        return calendar.isOpen() ? weekdayHaircutBps : weekendHaircutBps;
    }

    /// @notice Margin value: tUSDC plus sBILL at NAV after today's haircut.
    function collateralValue(address who) public view returns (uint256) {
        Account storage a = accounts[who];
        return a.usdc + (sBill.valueOf(a.sbill) * (BPS - haircutBps())) / BPS;
    }

    /// @notice Gain (+) or loss (-) since the last settlement at `price`, including funding.
    function unsettledPnl(address who, uint256 price) public view returns (int256) {
        uint256 tradeId = accounts[who].tradeId;
        if (tradeId == 0) return 0;
        Trade storage t = trades[tradeId];
        (int256 longGain, ) = _longGain(t, price);
        return who == t.long ? longGain : -longGain;
    }

    /// @notice Margin value including unsettled gains, and the maintenance requirement, at the latest price.
    function accountHealth(address who) external view returns (int256 equity, uint256 maintenance, uint256 initial) {
        uint256 price = _price();
        equity = int256(collateralValue(who)) + unsettledPnl(who, price);
        uint256 tradeId = accounts[who].tradeId;
        if (tradeId != 0) {
            uint256 size = trades[tradeId].size;
            maintenance = requiredMargin(size, price, maintenanceMarginBps);
            initial = requiredMargin(size, price, initialMarginBps);
        }
    }

    function requiredMargin(uint256 size, uint256 price, uint256 bps) public pure returns (uint256) {
        return (Math.mulDiv(size, price, 1e18) * bps) / BPS;
    }

    // ---------------------------------------------------------------- internals

    function _price() internal view returns (uint256) {
        (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = priceFeed.latestRoundData();
        if (answer <= 0) revert InvalidPrice(answer);
        if (updatedAt == 0 || answeredInRound < roundId) revert IncompletePriceRound();
        if (block.timestamp - updatedAt > maxPriceAge) revert StalePrice(updatedAt);
        return uint256(answer) * priceScale;
    }

    /// @dev The long's gain since the last settlement (price move minus funding), and the funding part.
    function _longGain(Trade storage t, uint256 price) internal view returns (int256 gain, int256 fundingPaid) {
        int256 priceGain = (int256(t.size) * (int256(price) - int256(t.lastPrice))) / 1e18;
        int256 notional = int256(Math.mulDiv(t.size, price, 1e18));
        int256 elapsed = int256(block.timestamp - t.lastSettledAt);
        fundingPaid = (notional * fundingRatePerHour * elapsed) / (1e18 * 1 hours);
        gain = priceGain - fundingPaid;
    }

    function _settle(uint256 tradeId, Trade storage t, uint256 price) internal {
        (int256 longGain, int256 fundingPaid) = _longGain(t, price);
        uint256 elapsed = block.timestamp - t.lastSettledAt;
        (address payer, address receiver) = longGain > 0 ? (t.short, t.long) : (t.long, t.short);
        uint256 amountDue = SignedMath.abs(longGain);

        uint256 paid = amountDue == 0 ? 0 : _collect(payer, amountDue);
        accounts[receiver].usdc += paid;
        t.lastPrice = price;
        t.lastSettledAt = block.timestamp;
        emit Settled(tradeId, price, payer, receiver, amountDue, paid);
        if (fundingPaid != 0) emit FundingApplied(tradeId, fundingRatePerHour, elapsed, fundingPaid);
    }

    function _close(uint256 tradeId, Trade storage t, uint256 price) internal {
        t.open = false;
        accounts[t.long].tradeId = 0;
        accounts[t.short].tradeId = 0;
        emit TradeClosed(tradeId, price);
    }

    /// @dev Takes `amount` tUSDC from an account, converting its sBILL if it runs short.
    /// Returns what was actually collected, which is less than `amount` only if the account is empty.
    function _collect(address who, uint256 amount) internal returns (uint256 collected) {
        Account storage a = accounts[who];
        if (a.usdc >= amount) {
            a.usdc -= amount;
            return amount;
        }
        collected = a.usdc;
        uint256 shortfall = amount - collected;
        a.usdc = 0;
        if (a.sbill == 0) return collected;

        uint256 sbillSold;
        uint256 raised;
        bool viaVault = !calendar.isOpen();
        if (viaVault) {
            uint256 usdcOut = shortfall;
            if (vault.quoteSBillIn(usdcOut) > a.sbill) usdcOut = vault.quoteUsdcOut(a.sbill);
            sbillSold = vault.quoteSBillIn(usdcOut);
            a.sbill -= sbillSold;
            if (vault.buySBill(usdcOut) != sbillSold) revert UnexpectedVaultFill();
            raised = usdcOut;
        } else {
            sbillSold = Math.min(Math.mulDiv(shortfall, 1e18, sBill.nav(), Math.Rounding.Ceil), a.sbill);
            a.sbill -= sbillSold;
            raised = sBill.redeem(sbillSold);
        }

        // Rounding can raise a few wei more than needed; that stays in the account.
        if (raised > shortfall) {
            a.usdc += raised - shortfall;
            raised = shortfall;
        }
        collected += raised;
        emit CollateralConverted(who, sbillSold, raised, viaVault);
    }

    function _requireMargin(address who, uint256 size, uint256 price, uint256 bps) internal view {
        uint256 required = requiredMargin(size, price, bps);
        uint256 value = collateralValue(who);
        if (value < required) revert InsufficientMargin(value, required);
    }

    function _prepareWithdrawal(uint256 amount) internal returns (Account storage a) {
        if (amount == 0) revert ZeroAmount();
        a = accounts[msg.sender];
        if (a.tradeId != 0) {
            Trade storage t = trades[a.tradeId];
            _settle(a.tradeId, t, _price());
        }
    }

    function _checkMarginAfterWithdrawal(Account storage a) internal view {
        if (a.tradeId == 0) return;
        Trade storage t = trades[a.tradeId];
        _requireMargin(msg.sender, t.size, t.lastPrice, initialMarginBps);
    }
}

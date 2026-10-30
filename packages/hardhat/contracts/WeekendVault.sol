// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SBill } from "./SBill.sol";
import { IMarketCalendar } from "./interfaces/IMarketCalendar.sol";

/// @notice A pool of tUSDC that buys sBILL from the clearinghouse while the T-bill market is closed,
/// at NAV minus a fixed discount, and redeems it with the fund on the next business day.
///
/// sBILL inventory is valued at what the vault paid until it is redeemed, so the share price only
/// rises when the discount is actually realised. Withdrawals are capped at the cash the vault holds.
contract WeekendVault is ERC4626, Ownable {
    using SafeERC20 for IERC20;

    SBill public immutable sBill;
    IMarketCalendar public immutable calendar;
    uint256 public immutable discountBps;

    /// @notice Set once by the owner after the clearinghouse is deployed; cannot be changed afterwards.
    address public clearinghouse;
    /// @notice tUSDC paid for sBILL that has not been redeemed yet.
    uint256 public inventoryCost;

    event ClearinghouseSet(address clearinghouse);
    event SBillPurchased(uint256 usdcPaid, uint256 sbillIn, uint256 price);
    event InventoryRedeemed(uint256 sbillRedeemed, uint256 usdcReceived, uint256 profit);

    error OnlyClearinghouse();
    error ClearinghouseAlreadySet();
    error MarketOpen();
    error InsufficientLiquidity(uint256 available, uint256 needed);
    error NothingToRedeem();

    constructor(
        IERC20 usdc_,
        SBill sBill_,
        IMarketCalendar calendar_,
        uint256 discountBps_,
        address owner_
    ) ERC20("Weekend Vault Share", "wvUSDC") ERC4626(usdc_) Ownable(owner_) {
        sBill = sBill_;
        calendar = calendar_;
        discountBps = discountBps_;
    }

    function setClearinghouse(address clearinghouse_) external onlyOwner {
        if (clearinghouse != address(0)) revert ClearinghouseAlreadySet();
        clearinghouse = clearinghouse_;
        emit ClearinghouseSet(clearinghouse_);
    }

    function cash() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function totalAssets() public view override returns (uint256) {
        return cash() + inventoryCost;
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        return Math.min(super.maxWithdraw(owner), cash());
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        return Math.min(super.maxRedeem(owner), _convertToShares(cash(), Math.Rounding.Floor));
    }

    /// @notice tUSDC the vault pays per sBILL: NAV minus the weekend discount.
    function purchasePrice() public view returns (uint256) {
        return (sBill.nav() * (10_000 - discountBps)) / 10_000;
    }

    /// @notice sBILL the vault takes in for `usdcOut` tUSDC (rounded up, in the vault's favour).
    function quoteSBillIn(uint256 usdcOut) public view returns (uint256) {
        return Math.mulDiv(usdcOut, 1e18, purchasePrice(), Math.Rounding.Ceil);
    }

    /// @notice tUSDC the vault pays for `sbillIn` sBILL (rounded down, in the vault's favour).
    function quoteUsdcOut(uint256 sbillIn) public view returns (uint256) {
        return Math.mulDiv(sbillIn, purchasePrice(), 1e18, Math.Rounding.Floor);
    }

    /// @notice Pays `usdcOut` tUSDC to the clearinghouse and pulls the matching sBILL from it.
    function buySBill(uint256 usdcOut) external returns (uint256 sbillIn) {
        if (msg.sender != clearinghouse) revert OnlyClearinghouse();
        if (calendar.isOpen()) revert MarketOpen();
        uint256 available = cash();
        if (available < usdcOut) revert InsufficientLiquidity(available, usdcOut);

        uint256 price = purchasePrice();
        sbillIn = Math.mulDiv(usdcOut, 1e18, price, Math.Rounding.Ceil);
        inventoryCost += usdcOut;

        IERC20(address(sBill)).safeTransferFrom(msg.sender, address(this), sbillIn);
        IERC20(asset()).safeTransfer(msg.sender, usdcOut);
        emit SBillPurchased(usdcOut, sbillIn, price);
    }

    /// @notice Redeems all sBILL inventory with the fund. Anyone can call it; it only works on business days.
    function redeemInventory() external returns (uint256 usdcReceived) {
        uint256 shares = sBill.balanceOf(address(this));
        if (shares == 0) revert NothingToRedeem();
        uint256 cost = inventoryCost;
        inventoryCost = 0;
        usdcReceived = sBill.redeem(shares);
        emit InventoryRedeemed(shares, usdcReceived, usdcReceived > cost ? usdcReceived - cost : 0);
    }
}

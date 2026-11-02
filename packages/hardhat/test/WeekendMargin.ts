import { expect } from "chai";
import { network } from "hardhat";
import type { Abi_Clearinghouse } from "../generated/abis/Clearinghouse.js";
import type { Abi_MarketCalendar } from "../generated/abis/MarketCalendar.js";
import type { Abi_MockV3Aggregator } from "../generated/abis/MockV3Aggregator.js";
import type { Abi_SBill } from "../generated/abis/SBill.js";
import type { Abi_TestUSDC } from "../generated/abis/TestUSDC.js";
import type { Abi_WeekendVault } from "../generated/abis/WeekendVault.js";
import { loadAndExecuteDeploymentsFromFiles } from "../rocketh/environment.js";

const { provider, networkHelpers, ethers } = await network.create();

const DAY = 86_400;
const SUNDAY = 0;
const MONDAY = 1;
const THURSDAY = 4;
const FRIDAY = 5;
const SATURDAY = 6;
const ONE = 10n ** 18n;
const usd = (n: number | bigint) => BigInt(n) * ONE;
const feedPrice = (n: number) => BigInt(n) * 10n ** 8n; // Chainlink BTC/USD has 8 decimals

async function deployFixture() {
  const env = await loadAndExecuteDeploymentsFromFiles({ provider });
  const [deployer, fundA, traderB, investor, keeper] = await ethers.getSigners();
  return {
    usdc: await ethers.getContractAt("TestUSDC", env.get<Abi_TestUSDC>("TestUSDC").address),
    calendar: await ethers.getContractAt("MarketCalendar", env.get<Abi_MarketCalendar>("MarketCalendar").address),
    sBill: await ethers.getContractAt("SBill", env.get<Abi_SBill>("SBill").address),
    vault: await ethers.getContractAt("WeekendVault", env.get<Abi_WeekendVault>("WeekendVault").address),
    clearinghouse: await ethers.getContractAt("Clearinghouse", env.get<Abi_Clearinghouse>("Clearinghouse").address),
    feed: await ethers.getContractAt("MockV3Aggregator", env.get<Abi_MockV3Aggregator>("MockBtcUsdFeed").address),
    deployer,
    fundA,
    traderB,
    investor,
    keeper,
  };
}

/** Moves the chain clock to the next given weekday (0 = Sunday) at `hour`:00 UTC. */
async function goToNext(dayOfWeek: number, hour = 12) {
  const now = await networkHelpers.time.latest();
  const today = Math.floor(now / DAY);
  let ahead = (dayOfWeek - ((today + 4) % 7) + 7) % 7;
  if (ahead === 0) ahead = 7;
  await networkHelpers.time.increaseTo((today + ahead) * DAY + hour * 3600);
}

type System = Awaited<ReturnType<typeof deployFixture>>;
type Story = Omit<System, "calendar">;

/**
 * The demo story up to an open trade, on a Thursday:
 * the investor funds the vault, Fund A buys sBILL and posts it as margin, Trader B posts tUSDC,
 * and Fund A goes short 1 BTC at $83,000 against Trader B.
 */
async function openTradeOnThursday(s: Story, vaultDeposit = usd(50_000)) {
  await goToNext(THURSDAY);
  await s.feed.updateAnswer(feedPrice(83_000));

  if (vaultDeposit > 0n) {
    await s.usdc.connect(s.investor).faucet();
    await s.usdc.connect(s.investor).approve(await s.vault.getAddress(), vaultDeposit);
    await s.vault.connect(s.investor).deposit(vaultDeposit, s.investor.address);
  }

  await s.usdc.connect(s.fundA).faucet();
  await s.usdc.connect(s.fundA).approve(await s.sBill.getAddress(), usd(20_000));
  await s.sBill.connect(s.fundA).subscribe(usd(20_000));
  const sbillHeld = await s.sBill.balanceOf(s.fundA.address);
  await s.sBill.connect(s.fundA).approve(await s.clearinghouse.getAddress(), sbillHeld);
  await s.clearinghouse.connect(s.fundA).depositSBill(sbillHeld);

  await s.usdc.connect(s.traderB).faucet();
  await s.usdc.connect(s.traderB).approve(await s.clearinghouse.getAddress(), usd(20_000));
  await s.clearinghouse.connect(s.traderB).depositUsdc(usd(20_000));

  await s.clearinghouse.connect(s.fundA).postOffer(false, ONE);
  await s.clearinghouse.connect(s.traderB).acceptOffer(1);
  return { sbillHeld };
}

describe("MarketCalendar", function () {
  it("is closed for 65 hours, from Friday 21:00 to Monday 14:00 UTC", async function () {
    const { calendar } = await networkHelpers.loadFixture(deployFixture);
    await goToNext(FRIDAY, 20);
    expect(await calendar.isOpen()).to.equal(true);
    await goToNext(SATURDAY, 12);
    expect(await calendar.isWeekend()).to.equal(true);
    expect(await calendar.secondsUntilOpen()).to.equal(50n * 3600n);
    await goToNext(SUNDAY, 18);
    expect(await calendar.secondsUntilOpen()).to.equal(20n * 3600n);
    await goToNext(MONDAY, 13);
    expect(await calendar.isOpen()).to.equal(false);
    await goToNext(MONDAY, 14);
    expect(await calendar.isOpen()).to.equal(true);
    expect(await calendar.secondsUntilOpen()).to.equal(0n);
  });

  it("closes exactly at Friday 21:00 UTC, with 65 hours to go", async function () {
    const { calendar } = await networkHelpers.loadFixture(deployFixture);
    await goToNext(FRIDAY, 21);
    expect(await calendar.isOpen()).to.equal(false);
    expect(await calendar.secondsUntilOpen()).to.equal(65n * 3600n);
  });

  it("is the real calendar, not the demo one", async function () {
    const { calendar } = await networkHelpers.loadFixture(deployFixture);
    expect(await calendar.isDemo()).to.equal(false);
  });
});

describe("DemoCalendar", function () {
  it("lets only the operator switch the weekend on and off", async function () {
    const [operator, stranger] = await ethers.getSigners();
    const demo = await ethers.deployContract("DemoCalendar", [operator.address]);
    expect(await demo.isDemo()).to.equal(true);
    expect(await demo.isOpen()).to.equal(true);
    await expect(demo.connect(stranger).setWeekend(true)).to.be.revertedWithCustomError(
      demo,
      "OwnableUnauthorizedAccount",
    );
    await expect(demo.setWeekend(true)).to.emit(demo, "DemoWeekendSet").withArgs(true);
    expect(await demo.isWeekend()).to.equal(true);
    expect(await demo.secondsUntilOpen()).to.equal(ethers.MaxUint256);
  });
});

describe("SBill", function () {
  it("accrues 4% a year on NAV", async function () {
    const { sBill } = await networkHelpers.loadFixture(deployFixture);
    const start = await sBill.startTime();
    await networkHelpers.time.increaseTo(start + 365n * BigInt(DAY));
    expect(await sBill.nav()).to.equal((104n * ONE) / 100n);
  });

  it("only issues and redeems on business days", async function () {
    const { sBill, usdc, fundA } = await networkHelpers.loadFixture(deployFixture);
    await goToNext(THURSDAY);
    await usdc.connect(fundA).faucet();
    await usdc.connect(fundA).approve(await sBill.getAddress(), usd(2_000));
    await sBill.connect(fundA).subscribe(usd(1_000));

    await goToNext(SATURDAY);
    await expect(sBill.connect(fundA).subscribe(usd(1_000))).to.be.revertedWithCustomError(sBill, "MarketClosed");
    await expect(sBill.connect(fundA).redeem(ONE)).to.be.revertedWithCustomError(sBill, "MarketClosed");

    await goToNext(MONDAY, 15);
    const shares = await sBill.balanceOf(fundA.address);
    const before = await usdc.balanceOf(fundA.address);
    await sBill.connect(fundA).redeem(shares);
    expect((await usdc.balanceOf(fundA.address)) - before).to.be.greaterThan(usd(1_000));
  });
});

describe("WeekendVault", function () {
  it("lets only the owner change the discount, within the hard limit, while the market is open", async function () {
    const { vault, deployer, keeper } = await networkHelpers.loadFixture(deployFixture);
    await goToNext(THURSDAY);
    await expect(vault.connect(keeper).setDiscount(20n)).to.be.revertedWithCustomError(
      vault,
      "OwnableUnauthorizedAccount",
    );
    await expect(vault.connect(deployer).setDiscount(101n))
      .to.be.revertedWithCustomError(vault, "DiscountTooHigh")
      .withArgs(101n);
    await expect(vault.connect(deployer).setDiscount(30n)).to.emit(vault, "DiscountUpdated").withArgs(30n);
    expect(await vault.discountBps()).to.equal(30n);

    await goToNext(SATURDAY);
    await expect(vault.connect(deployer).setDiscount(40n)).to.be.revertedWithCustomError(vault, "MarketClosed");
  });

  it("buys at the new price after the discount changes", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    await s.vault.connect(s.deployer).setDiscount(50n);
    await goToNext(SATURDAY);
    await s.feed.updateAnswer(feedPrice(84_000));
    expect(await s.vault.purchasePrice()).to.equal(((await s.sBill.nav()) * 9_950n) / 10_000n);
    await expect(s.clearinghouse.settle(1)).to.emit(s.vault, "SBillPurchased");
  });

  it("refuses a starting discount above its hard limit", async function () {
    const [deployer] = await ethers.getSigners();
    const usdc = await ethers.deployContract("TestUSDC", [deployer.address]);
    const calendar = await ethers.deployContract("MarketCalendar");
    const sBill = await ethers.deployContract("SBill", [usdc, calendar, 400n]);
    const vaultFactory = await ethers.getContractFactory("WeekendVault");
    await expect(
      vaultFactory.deploy(usdc, sBill, calendar, 200n, 100n, deployer.address),
    ).to.be.revertedWithCustomError(vaultFactory, "DiscountTooHigh");
  });

  it("only sells cash to the clearinghouse, and the link cannot be changed", async function () {
    const { vault, deployer, keeper } = await networkHelpers.loadFixture(deployFixture);
    await expect(vault.connect(keeper).buySBill(ONE)).to.be.revertedWithCustomError(vault, "OnlyClearinghouse");
    await expect(vault.connect(deployer).setClearinghouse(keeper.address)).to.be.revertedWithCustomError(
      vault,
      "ClearinghouseAlreadySet",
    );
  });
});

describe("Clearinghouse: weekend margin call through the vault", function () {
  it("sells sBILL to the vault on Saturday to pay the winner, and the vault profits on Monday", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    const { sbillHeld } = await openTradeOnThursday(s);

    // Saturday: BTC rises 5%, so the short (Fund A) owes the long (Trader B) $4,150.
    await goToNext(SATURDAY);
    await s.feed.updateAnswer(feedPrice(87_150));
    const tx = await s.clearinghouse.connect(s.keeper).settle(1);
    await expect(tx)
      .to.emit(s.clearinghouse, "Settled")
      .withArgs(1, usd(87_150), s.fundA.address, s.traderB.address, usd(4_150), usd(4_150));

    // The vault paid $4,150 and took sBILL at NAV minus 0.10%, rounded up in its favour.
    const receipt = await tx.wait();
    const purchase = receipt!.logs
      .map(log => {
        try {
          return s.vault.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find(parsed => parsed?.name === "SBillPurchased")!;
    const [usdcPaid, sbillIn, price, discountBps] = purchase.args;
    expect(discountBps).to.equal(10n);
    expect(usdcPaid).to.equal(usd(4_150));
    expect(sbillIn).to.equal((usd(4_150) * ONE + price - 1n) / price);

    const fundAccount = await s.clearinghouse.accounts(s.fundA.address);
    const traderAccount = await s.clearinghouse.accounts(s.traderB.address);
    expect(fundAccount.sbill).to.equal(sbillHeld - sbillIn);
    expect(traderAccount.usdc).to.equal(usd(20_000 + 4_150));
    expect(await s.vault.cash()).to.equal(usd(50_000 - 4_150));
    expect(await s.sBill.balanceOf(await s.vault.getAddress())).to.equal(sbillIn);

    // While its cash is lent out, the vault caps withdrawals at the cash it holds.
    expect(await s.vault.maxWithdraw(s.investor.address)).to.equal(usd(50_000 - 4_150));

    // Monday: the vault redeems at full NAV and keeps the discount plus two days of interest.
    await goToNext(MONDAY, 15);
    await expect(s.vault.connect(s.keeper).redeemInventory()).to.emit(s.vault, "InventoryRedeemed");
    expect(await s.vault.inventoryCost()).to.equal(0n);
    expect(await s.vault.totalAssets()).to.be.greaterThan(usd(50_000));
  });

  it("caps vault withdrawals at its cash while sBILL is waiting for Monday", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    await goToNext(SATURDAY);
    await s.feed.updateAnswer(feedPrice(87_150));
    await s.clearinghouse.settle(1);
    await expect(
      s.vault.connect(s.investor).withdraw(usd(50_000), s.investor.address, s.investor.address),
    ).to.be.revertedWithCustomError(s.vault, "ERC4626ExceededMaxWithdraw");
    await s.vault.connect(s.investor).withdraw(usd(45_850), s.investor.address, s.investor.address);
    expect(await s.vault.cash()).to.equal(0n);
  });

  it("will not redeem the vault's sBILL until the market reopens", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    await goToNext(SATURDAY);
    await s.feed.updateAnswer(feedPrice(87_150));
    await s.clearinghouse.settle(1);
    await expect(s.vault.redeemInventory()).to.be.revertedWithCustomError(s.sBill, "MarketClosed");
  });

  it("reverts if the vault does not have enough cash at the weekend", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s, 0n);
    await goToNext(SATURDAY);
    await s.feed.updateAnswer(feedPrice(87_150));
    await expect(s.clearinghouse.settle(1)).to.be.revertedWithCustomError(s.vault, "InsufficientLiquidity");
  });
});

describe("Clearinghouse: weekday settlement", function () {
  it("redeems sBILL with the fund at full NAV instead of using the vault", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    await goToNext(FRIDAY);
    await s.feed.updateAnswer(feedPrice(87_150));
    await expect(s.clearinghouse.settle(1))
      .to.emit(s.clearinghouse, "CollateralConverted")
      .withArgs(s.fundA.address, (sold: bigint) => sold > 0n, usd(4_150), false);
    expect(await s.vault.cash()).to.equal(usd(50_000));
    expect((await s.clearinghouse.accounts(s.traderB.address)).usdc).to.equal(usd(24_150));
  });

  it("pays the short when the price falls, from the long's tUSDC", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    await s.feed.updateAnswer(feedPrice(80_000));
    await expect(s.clearinghouse.settle(1))
      .to.emit(s.clearinghouse, "Settled")
      .withArgs(1, usd(80_000), s.traderB.address, s.fundA.address, usd(3_000), usd(3_000));
    expect((await s.clearinghouse.accounts(s.fundA.address)).usdc).to.equal(usd(3_000));
  });
});

describe("Clearinghouse: price feed checks", function () {
  it("rejects a price more than 2 hours old", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    const now = BigInt(await networkHelpers.time.latest());
    await s.feed.setRoundData(feedPrice(84_000), now - 2n * 3600n - 1n);
    await expect(s.clearinghouse.settle(1)).to.be.revertedWithCustomError(s.clearinghouse, "StalePrice");
  });

  it("accepts a price just under 2 hours old", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    const now = BigInt(await networkHelpers.time.latest());
    await s.feed.setRoundData(feedPrice(84_000), now - 2n * 3600n + 60n);
    await expect(s.clearinghouse.settle(1)).to.emit(s.clearinghouse, "Settled");
  });

  it("rejects a zero or negative price", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    await s.feed.updateAnswer(0);
    await expect(s.clearinghouse.settle(1)).to.be.revertedWithCustomError(s.clearinghouse, "InvalidPrice");
    await s.feed.updateAnswer(-1);
    await expect(s.clearinghouse.settle(1)).to.be.revertedWithCustomError(s.clearinghouse, "InvalidPrice");
  });
});

describe("Clearinghouse: margin rules", function () {
  it("refuses an offer larger than the margin supports", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await goToNext(THURSDAY);
    await s.feed.updateAnswer(feedPrice(83_000));
    await s.usdc.connect(s.traderB).faucet();
    await s.usdc.connect(s.traderB).approve(await s.clearinghouse.getAddress(), usd(10_000));
    await s.clearinghouse.connect(s.traderB).depositUsdc(usd(10_000));
    // 1 BTC at $83,000 needs $16,600 of initial margin (20%).
    await expect(s.clearinghouse.connect(s.traderB).postOffer(true, ONE))
      .to.be.revertedWithCustomError(s.clearinghouse, "InsufficientMargin")
      .withArgs(usd(10_000), usd(16_600));
  });

  it("refuses a withdrawal that would leave too little margin", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    await expect(s.clearinghouse.connect(s.traderB).withdrawUsdc(usd(5_000))).to.be.revertedWithCustomError(
      s.clearinghouse,
      "InsufficientMargin",
    );
  });

  it("does not let an account take its own offer", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await goToNext(THURSDAY);
    await s.feed.updateAnswer(feedPrice(83_000));
    await s.usdc.connect(s.traderB).faucet();
    await s.usdc.connect(s.traderB).approve(await s.clearinghouse.getAddress(), usd(20_000));
    await s.clearinghouse.connect(s.traderB).depositUsdc(usd(20_000));
    await s.clearinghouse.connect(s.traderB).postOffer(true, ONE);
    await expect(s.clearinghouse.connect(s.traderB).acceptOffer(1)).to.be.revertedWithCustomError(
      s.clearinghouse,
      "CannotTakeOwnOffer",
    );
  });

  it("closes a trade and frees both accounts", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    await s.feed.updateAnswer(feedPrice(83_500));
    await expect(s.clearinghouse.connect(s.traderB).closeTrade(1)).to.emit(s.clearinghouse, "TradeClosed");
    expect((await s.clearinghouse.accounts(s.fundA.address)).tradeId).to.equal(0n);
    expect((await s.clearinghouse.accounts(s.traderB.address)).tradeId).to.equal(0n);
    await expect(s.clearinghouse.settle(1)).to.be.revertedWithCustomError(s.clearinghouse, "TradeNotOpen");
  });
});

describe("Clearinghouse: funding", function () {
  it("charges the long hourly funding at the posted rate when the price is unchanged", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    const rate = 10n ** 14n; // 0.01% of notional per hour
    await s.clearinghouse.connect(s.deployer).setFundingRate(rate);

    await networkHelpers.time.increase(3600);
    await s.feed.updateAnswer(feedPrice(83_000));
    const tx = await s.clearinghouse.settle(1);
    const receipt = await tx.wait();
    const funding = receipt!.logs
      .map(log => {
        try {
          return s.clearinghouse.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find(parsed => parsed?.name === "FundingApplied")!;
    const [, accrued, , longPays] = funding.args;
    const postedAt = await s.clearinghouse.fundingUpdatedAt();
    const settledAt = (await s.clearinghouse.trades(1)).lastSettledAt;
    expect(accrued).to.equal((rate * (settledAt - postedAt)) / 3600n);
    expect(longPays).to.equal((usd(83_000) * accrued) / ONE);
    await expect(tx)
      .to.emit(s.clearinghouse, "Settled")
      .withArgs(1, usd(83_000), s.traderB.address, s.fundA.address, longPays, longPays);
  });

  it("applies a new rate only from the moment it is posted", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    // Nothing is settled for 10 hours at a rate of zero, then the owner posts the highest rate allowed.
    await networkHelpers.time.increase(10 * 3600);
    await s.clearinghouse.connect(s.deployer).setFundingRate(10n ** 15n);
    await s.feed.updateAnswer(feedPrice(83_000));
    await s.clearinghouse.settle(1);
    const elapsedSincePost =
      (await s.clearinghouse.trades(1)).lastSettledAt - (await s.clearinghouse.fundingUpdatedAt());
    // The long pays for the seconds since the post, not for the 10 hours before it.
    expect((await s.clearinghouse.accounts(s.fundA.address)).usdc).to.equal(
      (usd(83_000) * ((10n ** 15n * elapsedSincePost) / 3600n)) / ONE,
    );
  });

  it("adds up funding across a rate change", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    const start = await s.clearinghouse.cumulativeFunding();
    await s.clearinghouse.connect(s.deployer).setFundingRate(10n ** 14n);
    const firstPost = await s.clearinghouse.fundingUpdatedAt();
    await networkHelpers.time.increase(3600);
    await s.clearinghouse.connect(s.deployer).setFundingRate(-(10n ** 14n));
    const secondPost = await s.clearinghouse.fundingUpdatedAt();
    expect(await s.clearinghouse.cumulativeFunding()).to.equal(start + (10n ** 14n * (secondPost - firstPost)) / 3600n);
  });

  it("caps the funding rate and only lets the owner post it", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await expect(s.clearinghouse.connect(s.deployer).setFundingRate(10n ** 15n + 1n))
      .to.be.revertedWithCustomError(s.clearinghouse, "FundingRateTooHigh")
      .withArgs(10n ** 15n + 1n);
    await expect(s.clearinghouse.connect(s.keeper).setFundingRate(1n)).to.be.revertedWithCustomError(
      s.clearinghouse,
      "OwnableUnauthorizedAccount",
    );
  });
});

describe("Clearinghouse: liquidation", function () {
  it("closes an account below maintenance margin and pays the liquidator 0.5% of notional", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    // BTC to $95,000: Fund A (short) loses $12,000 and is left well under 10% of $95,000.
    await s.feed.updateAnswer(feedPrice(95_000));
    const before = await s.usdc.balanceOf(s.keeper.address);
    await expect(s.clearinghouse.connect(s.keeper).liquidate(1))
      .to.emit(s.clearinghouse, "Liquidated")
      .withArgs(1, s.fundA.address, s.keeper.address, usd(475));
    expect((await s.usdc.balanceOf(s.keeper.address)) - before).to.equal(usd(475));
    expect((await s.clearinghouse.trades(1)).open).to.equal(false);
    expect((await s.clearinghouse.accounts(s.traderB.address)).usdc).to.equal(usd(20_000 + 12_000));
  });

  it("pays the winner and the liquidator through the vault when the market is closed", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    await goToNext(SATURDAY);
    await s.feed.updateAnswer(feedPrice(95_000));
    const tx = await s.clearinghouse.connect(s.keeper).liquidate(1);
    await expect(tx).to.emit(s.vault, "SBillPurchased");
    await expect(tx).to.emit(s.clearinghouse, "Liquidated").withArgs(1, s.fundA.address, s.keeper.address, usd(475));
    expect((await s.clearinghouse.accounts(s.traderB.address)).usdc).to.equal(usd(32_000));
    expect(await s.vault.cash()).to.equal(usd(50_000 - 12_000 - 475));
  });

  it("underpays the winner, instead of reverting, when the loser's deposit runs out", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    // BTC doubles: Fund A owes $83,000 and has about $20,000 in sBILL.
    await s.feed.updateAnswer(feedPrice(166_000));
    await expect(s.clearinghouse.connect(s.keeper).liquidate(1))
      .to.emit(s.clearinghouse, "Settled")
      .withArgs(1, usd(166_000), s.fundA.address, s.traderB.address, usd(83_000), (paid: bigint) => paid < usd(21_000));
    const fund = await s.clearinghouse.accounts(s.fundA.address);
    expect(fund.usdc + fund.sbill).to.be.lessThan(ONE);
  });

  it("matches the formula for the liquidation price", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    // Short, weekday sBILL: P = h(D + P0) / (m + h), with D = $20,000, P0 = $83,000, h = 0.99, m = 0.10.
    const liquidationPrice = Math.ceil((0.99 * (20_000 + 83_000)) / (0.1 + 0.99));
    await s.feed.updateAnswer(feedPrice(liquidationPrice - 3));
    await expect(s.clearinghouse.liquidate(1)).to.be.revertedWithCustomError(s.clearinghouse, "NotLiquidatable");
    await s.feed.updateAnswer(feedPrice(liquidationPrice + 3));
    await expect(s.clearinghouse.liquidate(1)).to.emit(s.clearinghouse, "Liquidated");
  });

  it("refuses to liquidate a healthy trade", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    await s.feed.updateAnswer(feedPrice(84_000));
    await expect(s.clearinghouse.liquidate(1)).to.be.revertedWithCustomError(s.clearinghouse, "NotLiquidatable");
  });
});

describe("Clearinghouse: pause", function () {
  it("stops new deposits and offers, but never settlement, withdrawals or closing", async function () {
    const s = await networkHelpers.loadFixture(deployFixture);
    await openTradeOnThursday(s);
    await expect(s.clearinghouse.connect(s.keeper).pause()).to.be.revertedWithCustomError(
      s.clearinghouse,
      "OwnableUnauthorizedAccount",
    );
    await s.clearinghouse.connect(s.deployer).pause();
    await expect(s.clearinghouse.connect(s.traderB).depositUsdc(ONE)).to.be.revertedWithCustomError(
      s.clearinghouse,
      "EnforcedPause",
    );
    await s.feed.updateAnswer(feedPrice(83_500));
    await expect(s.clearinghouse.settle(1)).to.emit(s.clearinghouse, "Settled");
    await s.clearinghouse.connect(s.traderB).withdrawUsdc(ONE);
    await expect(s.clearinghouse.connect(s.fundA).closeTrade(1)).to.emit(s.clearinghouse, "TradeClosed");
  });
});

describe("Clearinghouse: randomized settlement keeps the books balanced", function () {
  /** Small deterministic PRNG so failures can be reproduced from the seed. */
  function prng(seed: number) {
    let x = seed >>> 0;
    return () => {
      x = (x * 1664525 + 1013904223) >>> 0;
      return x / 2 ** 32;
    };
  }

  for (const seed of [7, 42, 2026]) {
    it(`never creates or loses tUSDC or sBILL (seed ${seed})`, async function () {
      const s = await networkHelpers.loadFixture(deployFixture);
      await openTradeOnThursday(s);
      await s.clearinghouse.connect(s.deployer).setFundingRate(5n * 10n ** 13n);
      const rand = prng(seed);
      const ch = await s.clearinghouse.getAddress();
      let price = 83_000;

      for (let step = 0; step < 40; step++) {
        price = Math.round(price * (1 + (rand() - 0.5) * 0.02)); // up to ±1% per step
        await networkHelpers.time.increase(Math.floor(1 + rand() * 8) * 3600); // 1-8 hours, crosses weekends
        await s.feed.updateAnswer(feedPrice(price));
        if (!(await s.clearinghouse.trades(1)).open) break;
        await s.clearinghouse.connect(s.keeper).settle(1);

        const a = await s.clearinghouse.accounts(s.fundA.address);
        const b = await s.clearinghouse.accounts(s.traderB.address);
        expect(await s.usdc.balanceOf(ch)).to.equal(a.usdc + b.usdc);
        expect(await s.sBill.balanceOf(ch)).to.equal(a.sbill + b.sbill);
      }
    });
  }
});

describe("Demo deployment: the weekend path on any day", function () {
  /** The same system as the main deployment, but wired to DemoCalendar, as `DEMO=true yarn deploy` does. */
  async function demoFixture() {
    const [deployer, fundA, traderB, investor, keeper] = await ethers.getSigners();
    const feed = await ethers.deployContract("MockV3Aggregator", [8, feedPrice(83_000)]);
    const usdc = await ethers.deployContract("TestUSDC", [deployer.address]);
    const calendar = await ethers.deployContract("DemoCalendar", [deployer.address]);
    const sBill = await ethers.deployContract("SBill", [usdc, calendar, 400n]);
    const vault = await ethers.deployContract("WeekendVault", [usdc, sBill, calendar, 10n, 100n, deployer.address]);
    const clearinghouse = await ethers.deployContract("Clearinghouse", [
      usdc,
      sBill,
      vault,
      calendar,
      feed,
      {
        maxPriceAge: 7200n,
        initialMarginBps: 2000n,
        maintenanceMarginBps: 1000n,
        weekdayHaircutBps: 100n,
        weekendHaircutBps: 300n,
        liquidationRewardBps: 50n,
        maxFundingRatePerHour: 10n ** 15n,
      },
      deployer.address,
    ]);
    await vault.setClearinghouse(clearinghouse);
    await usdc.mint(sBill, usd(1_000_000));
    return { usdc, calendar, sBill, vault, clearinghouse, feed, deployer, fundA, traderB, investor, keeper };
  }

  it("sends a Thursday settlement through the vault once the operator switches the weekend on", async function () {
    const s = await networkHelpers.loadFixture(demoFixture);
    await openTradeOnThursday(s);
    await s.feed.updateAnswer(feedPrice(87_150));

    await s.calendar.connect(s.deployer).setWeekend(true);
    await expect(s.clearinghouse.connect(s.keeper).settle(1))
      .to.emit(s.vault, "SBillPurchased")
      .and.to.emit(s.clearinghouse, "CollateralConverted")
      .withArgs(s.fundA.address, (sold: bigint) => sold > 0n, usd(4_150), true);

    await s.calendar.connect(s.deployer).setWeekend(false);
    await expect(s.vault.connect(s.keeper).redeemInventory()).to.emit(s.vault, "InventoryRedeemed");
    expect(await s.vault.totalAssets()).to.be.greaterThan(usd(50_000));
  });
});

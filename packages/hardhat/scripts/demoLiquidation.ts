import { network } from "hardhat";
import { type ContractTransactionResponse } from "ethers";
import { demoWallets, deploymentAddress, logFile, logTx, topUpGas } from "./lib/demo.js";

/**
 * Shows a liquidation on the labelled stress set (DEPLOY_PREFIX=Stress), whose BTC price is a mock.
 * At the demo's size a real liquidation needs BTC to move about 25%, so this set exists to show it.
 *   1. the vault is funded; Fund A posts sBILL and Trader B posts tUSDC, 20,000 each,
 *   2. Fund A goes short 1 BTC at a mock $83,000 against Trader B,
 *   3. the weekend starts, and the script works out the liquidation price from the formula,
 *   4. just below that price the contract refuses to liquidate,
 *   5. just above it, Trader D liquidates and earns the reward, paid through the vault,
 *   6. the market reopens and the vault redeems its sBILL.
 */
const ONE = 10n ** 18n;
const MARGIN = 20_000n * ONE;
const VAULT_DEPOSIT = 50_000n * ONE;
const START_PRICE = 83_000;
const feedUnits = (price: number) => BigInt(Math.round(price * 1e8));
// The mock stores block.timestamp, so a gas estimate made right after the last update assumes that write costs
// almost nothing and comes out about 10,000 gas short. A fixed limit avoids running out of gas on a live network.
const MOCK_UPDATE_GAS = { gasLimit: 100_000 };

const { ethers, networkName } = await network.create();
const [operator] = await ethers.getSigners();
const address = (name: string) => deploymentAddress(networkName, name);
const usdc = await ethers.getContractAt("TestUSDC", address("TestUSDC"));
const sBill = await ethers.getContractAt("SBill", address("SBill"));
const vault = await ethers.getContractAt("WeekendVault", address("WeekendVault"));
const clearinghouse = await ethers.getContractAt("Clearinghouse", address("Clearinghouse"));
const calendar = await ethers.getContractAt("DemoCalendar", address("MarketCalendar"));
const feed = await ethers.getContractAt("MockV3Aggregator", await clearinghouse.priceFeed());

if (!(await calendar.isDemo())) throw new Error("Run this on the stress set: DEMO=true DEPLOY_PREFIX=Stress.");

const wallets = demoWallets(ethers.provider);
const [fundA, traderB, , traderD] = wallets;
const usd = (amount: bigint) => `$${(Number(amount / 10n ** 14n) / 1e4).toLocaleString("en-US")}`;

async function send(step: string, tx: Promise<ContractTransactionResponse>) {
  const response = await tx;
  const receipt = (await response.wait())!;
  logTx(networkName, step, response.hash);
  return receipt;
}

/** What Fund A's posted sBILL is worth at NAV. (A contract's `valueOf` clashes with JavaScript's own.) */
async function fundSBillValue() {
  return ((await clearinghouse.accounts(fundA.address)).sbill * (await sBill.nav())) / ONE;
}

// A run that stopped part-way leaves its trade open, so a re-run carries on with that trade.
let tradeId = (await clearinghouse.accounts(fundA.address)).tradeId;
if (tradeId === 0n) {
  console.log("Step 1: funding the vault and posting margin");
  await topUpGas(networkName, operator, wallets);
  if (await calendar.isWeekend()) await send("market reopened", calendar.connect(operator).setWeekend(false));
  if ((await vault.cash()) < VAULT_DEPOSIT) {
    await send("investor draws tUSDC", usdc.connect(operator).faucet());
    await send("investor approves vault", usdc.connect(operator).approve(await vault.getAddress(), VAULT_DEPOSIT));
    await send("investor deposits 50,000 tUSDC", vault.connect(operator).deposit(VAULT_DEPOSIT, operator.address));
  }

  // A re-run starts from whatever the last run left behind, topping each account up to 20,000.
  const fundCash = (await clearinghouse.accounts(fundA.address)).usdc;
  if (fundCash > 0n) await send("Fund A takes out spare tUSDC", clearinghouse.connect(fundA).withdrawUsdc(fundCash));
  const fundHeld = await fundSBillValue();
  if (fundHeld < MARGIN) {
    const buy = MARGIN - fundHeld;
    if ((await usdc.balanceOf(fundA.address)) < buy) await send("Fund A draws tUSDC", usdc.connect(fundA).faucet());
    await send("Fund A approves the fund", usdc.connect(fundA).approve(await sBill.getAddress(), buy));
    await send("Fund A buys sBILL", sBill.connect(fundA).subscribe(buy));
    const shares = await sBill.balanceOf(fundA.address);
    await send(
      "Fund A approves the clearinghouse",
      sBill.connect(fundA).approve(await clearinghouse.getAddress(), shares),
    );
    await send("Fund A posts sBILL as margin", clearinghouse.connect(fundA).depositSBill(shares));
  }
  const traderHeld = (await clearinghouse.accounts(traderB.address)).usdc;
  if (traderHeld < MARGIN) {
    const add = MARGIN - traderHeld;
    if ((await usdc.balanceOf(traderB.address)) < add)
      await send("Trader B draws tUSDC", usdc.connect(traderB).faucet());
    await send(
      "Trader B approves the clearinghouse",
      usdc.connect(traderB).approve(await clearinghouse.getAddress(), add),
    );
    await send("Trader B posts tUSDC as margin", clearinghouse.connect(traderB).depositUsdc(add));
  }

  console.log("Step 2: opening the trade");
  await send(
    `mock BTC price set to $${START_PRICE}`,
    feed.connect(operator).updateAnswer(feedUnits(START_PRICE), MOCK_UPDATE_GAS),
  );
  const offerId = await clearinghouse.nextOfferId();
  tradeId = await clearinghouse.nextTradeId();
  await send("Fund A offers to short 1 BTC", clearinghouse.connect(fundA).postOffer(false, ONE));
  await send("Trader B accepts", clearinghouse.connect(traderB).acceptOffer(offerId));
} else {
  console.log(`Carrying on with trade ${tradeId}, left open by an earlier run`);
}

console.log("Step 3: the weekend starts, and the model gives the liquidation price");
if (!(await calendar.isWeekend())) {
  await send("demo calendar switched to the weekend", calendar.connect(operator).setWeekend(true));
}
const held = Number((await fundSBillValue()) / 10n ** 14n) / 1e4;
const openedAt = Number((await clearinghouse.trades(tradeId)).lastPrice / 10n ** 14n) / 1e4;
const h = 1 - Number(await clearinghouse.weekendHaircutBps()) / 1e4;
const m = Number(await clearinghouse.maintenanceMarginBps()) / 1e4;
const d = Number(await vault.discountBps()) / 1e4;
// Short: each dollar lost sells 1/(1-d) dollars of sBILL, and the rest counts at h. Liquidated when that falls below m x P.
const modelPrice = (h * held + (h * openedAt) / (1 - d)) / (m + h / (1 - d));
console.log(`  model: Fund A is liquidated above $${modelPrice.toFixed(2)}`);

console.log("Step 4: just below the model price, the contract refuses");
await send(
  "mock BTC price just below the model price",
  feed.connect(operator).updateAnswer(feedUnits(modelPrice * 0.999), MOCK_UPDATE_GAS),
);
try {
  await clearinghouse.connect(traderD).liquidate.staticCall(tradeId);
  throw new Error("Expected the contract to refuse, but it would liquidate. The model and the contract disagree.");
} catch (e) {
  // A local chain names the error; a live RPC returns only its 4-byte code.
  const refused = clearinghouse.interface.getError("NotLiquidatable")!.selector;
  if (!String(e).includes("NotLiquidatable") && (e as { data?: string }).data !== refused) throw e;
  console.log("  liquidate() refused: NotLiquidatable");
}

console.log("Step 5: just above the model price, Trader D liquidates");
await send(
  "mock BTC price just above the model price",
  feed.connect(operator).updateAnswer(feedUnits(modelPrice * 1.001), MOCK_UPDATE_GAS),
);
const before = await usdc.balanceOf(traderD.address);
await send("Fund A liquidated by Trader D", clearinghouse.connect(traderD).liquidate(tradeId));
console.log(`  Trader D earned ${usd((await usdc.balanceOf(traderD.address)) - before)}`);
console.log(`  Trader B holds ${usd((await clearinghouse.accounts(traderB.address)).usdc)} of margin`);
console.log(`  vault holds ${usd(await vault.cash())} cash and ${usd(await vault.inventoryCost())} of sBILL at cost`);

console.log("Step 6: the market reopens, and the vault redeems");
await send("demo calendar switched back to a business day", calendar.connect(operator).setWeekend(false));
await send("vault redeems its sBILL inventory", vault.redeemInventory());
console.log(`  vault total assets ${usd(await vault.totalAssets())}`);
console.log(`\nDone. Evidence saved to ${logFile(networkName)}`);
process.exit(0);

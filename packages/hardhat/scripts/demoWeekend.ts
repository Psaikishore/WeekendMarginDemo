import { network } from "hardhat";
import { createInterface } from "readline/promises";
import { type ContractTransactionReceipt, type ContractTransactionResponse, type Log } from "ethers";
import { DEMO_ROLES, demoWallets, deploymentAddress, logFile, logTx } from "./lib/demo.js";

/**
 * The weekend story on the demo deployment, on any day. Run demo:setup first (with DEMO=true).
 *   1. waits for a fresh Chainlink BTC/USD price, so settlement has a real move to pay,
 *   2. switches the demo calendar to the weekend,
 *   3. settles every open trade: the sBILL-backed fund that lost pays through the weekend vault,
 *   4. switches the calendar back to a business day ("Monday"),
 *   5. the vault redeems its sBILL with the fund and keeps the discount.
 * DEMO_PAUSE=1 waits for Enter between steps, for narrating a recording.
 */
const POLL_MS = 30_000;

const { ethers, networkName } = await network.create();
const [operator] = await ethers.getSigners();
const at = <T extends "SBill" | "WeekendVault" | "Clearinghouse" | "DemoCalendar">(name: T, deployment = name) =>
  ethers.getContractAt(name, deploymentAddress(networkName, deployment));
const sBill = await at("SBill");
const vault = await at("WeekendVault");
const clearinghouse = await at("Clearinghouse");
const calendar = await at("DemoCalendar", "MarketCalendar");

if (!(await calendar.isDemo())) throw new Error("This is the real calendar. Run with DEMO=true.");

const readline = createInterface({ input: process.stdin, output: process.stdout });
const roles = new Map(demoWallets(ethers.provider).map((wallet, i) => [wallet.address, DEMO_ROLES[i] as string]));
const who = (address: string) => roles.get(address) ?? address;
const usd = (amount: bigint) => `$${(Number(amount / 10n ** 14n) / 1e4).toLocaleString("en-US")}`;

async function step(title: string) {
  if (process.env.DEMO_PAUSE === "1") await readline.question(`\n${title} (press Enter)`);
  else console.log(`\n${title}`);
}

/** Decodes a clearinghouse or vault event; other logs (token transfers) return null. */
function parse(log: Log) {
  for (const contract of [clearinghouse, vault]) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed) return parsed;
    } catch {
      // not this contract's event
    }
  }
  return null;
}

async function send(label: string, tx: Promise<ContractTransactionResponse>): Promise<ContractTransactionReceipt> {
  const response = await tx;
  const receipt = (await response.wait())!;
  logTx(networkName, label, response.hash);
  return receipt;
}

const lastId = (await clearinghouse.nextTradeId()) - 1n;
const openTrades: bigint[] = [];
for (let id = 1n; id <= lastId; id++) if ((await clearinghouse.trades(id)).open) openTrades.push(id);
if (openTrades.length === 0) throw new Error("No open trades. Run DEMO=true yarn demo:setup first.");

// 1. A fresh price, so there is a move to settle.
await step("Step 1: waiting for a new Chainlink BTC/USD price");
let lastSettled = 0n;
for (const id of openTrades) {
  const t = await clearinghouse.trades(id);
  if (t.lastSettledAt > lastSettled) lastSettled = t.lastSettledAt;
}
const feed = await ethers.getContractAt("AggregatorV3Interface", await clearinghouse.priceFeed());
if ((await ethers.provider.getNetwork()).chainId === 31337n) {
  // Local rehearsal: move the mock feed by +1.5% instead of waiting for Chainlink.
  const mock = await ethers.getContractAt("MockV3Aggregator", await feed.getAddress());
  const [, answer] = await mock.latestRoundData();
  await (await mock.updateAnswer((answer * 10150n) / 10000n)).wait();
} else {
  while ((await feed.latestRoundData())[3] <= lastSettled) {
    console.log(`  no new round yet (Chainlink updates about hourly), checking again in ${POLL_MS / 1000}s`);
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}
const price = await clearinghouse.latestPrice();
for (const id of openTrades) {
  const t = await clearinghouse.trades(id);
  console.log(`  trade ${id}: opened/last settled at ${usd(t.lastPrice)}, BTC now ${usd(price)}`);
}

// 2. The weekend begins.
await step("Step 2: the T-bill market closes for the weekend");
await send("demo calendar switched to the weekend", calendar.connect(operator).setWeekend(true));
console.log(`  market open: ${await calendar.isOpen()}; vault cash ${usd(await vault.cash())}`);

// 3. Margin calls are paid through the vault.
await step("Step 3: settling the trades while the market is closed");
for (const id of openTrades) {
  const receipt = await send(`trade ${id} settled on the demo weekend`, clearinghouse.settle(id));
  for (const parsed of receipt.logs.map(parse)) {
    if (parsed?.name === "Settled") {
      console.log(
        `  trade ${id}: ${who(parsed.args.payer)} pays ${usd(parsed.args.amountPaid)} to ${who(parsed.args.receiver)}`,
      );
    } else if (parsed?.name === "SBillPurchased") {
      console.log(
        `  the vault paid ${usd(parsed.args.usdcPaid)} for ${Number(parsed.args.sbillIn / 10n ** 14n) / 1e4} sBILL ` +
          `at ${usd(parsed.args.price)} each (NAV minus the weekend discount)`,
      );
    }
  }
}
console.log(
  `  vault now holds ${usd(await vault.cash())} cash and ${Number((await sBill.balanceOf(await vault.getAddress())) / 10n ** 14n) / 1e4} sBILL`,
);

// 4. Monday.
await step("Step 4: Monday, the T-bill market reopens");
await send("demo calendar switched back to a business day", calendar.connect(operator).setWeekend(false));

// 5. The vault redeems and keeps the discount.
await step("Step 5: the vault redeems its sBILL with the fund");
if ((await sBill.balanceOf(await vault.getAddress())) > 0n) {
  const receipt = await send("vault redeems its sBILL inventory", vault.redeemInventory());
  for (const parsed of receipt.logs.map(parse)) {
    if (parsed?.name === "InventoryRedeemed") {
      console.log(`  received ${usd(parsed.args.usdcReceived)}, profit ${usd(parsed.args.profit)}`);
    }
  }
} else {
  console.log("  the vault bought no sBILL (both losers paid in tUSDC)");
}
console.log(`  vault total assets ${usd(await vault.totalAssets())}`);
console.log(`\nDone. Evidence saved to ${logFile(networkName)}`);
readline.close();
process.exit(0);

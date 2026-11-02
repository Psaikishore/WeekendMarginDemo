import { network } from "hardhat";
import { createInterface } from "readline/promises";
import { type ContractTransactionReceipt, type ContractTransactionResponse, type Log } from "ethers";
import { DEMO_ROLES, deribitFundingPerHour, demoWallets, deploymentAddress, logFile, logTx } from "./lib/demo.js";

/**
 * The weekend story on the demo deployment, on any day. Run demo:setup first (with DEMO=true).
 *   0. the funds take out any spare tUSDC, and the operator posts the funding rate,
 *   1. waits for a fresh Chainlink BTC/USD price, so settlement has a real move to pay,
 *   2. switches the demo calendar to the weekend,
 *   3. settles every open trade: the sBILL-backed fund that lost pays through the weekend vault,
 *   4. switches the calendar back to a business day ("Monday"),
 *   5. the vault redeems its sBILL with the fund and keeps the discount.
 * Step 0 makes the story repeatable: a fund that won last time holds tUSDC, and would pay its next
 * loss from that instead of selling sBILL to the vault. DEMO_PAUSE=1 waits for Enter between steps,
 * for narrating a recording.
 */
const POLL_MS = 30_000;

const { ethers, networkName } = await network.create();
const [operator] = await ethers.getSigners();
const address = (name: string) => deploymentAddress(networkName, name);
const sBill = await ethers.getContractAt("SBill", address("SBill"));
const vault = await ethers.getContractAt("WeekendVault", address("WeekendVault"));
const clearinghouse = await ethers.getContractAt("Clearinghouse", address("Clearinghouse"));
const calendar = await ethers.getContractAt("DemoCalendar", address("MarketCalendar"));

if (!(await calendar.isDemo())) throw new Error("This is the real calendar. Run with DEMO=true.");

const readline = createInterface({ input: process.stdin, output: process.stdout });
const wallets = demoWallets(ethers.provider);
const roles = new Map(wallets.map((wallet, i) => [wallet.address, DEMO_ROLES[i] as string]));
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

// 0. The funds should hold only sBILL, and funding should be running.
await step("Step 0: the funds hold only sBILL, and the funding rate is posted");
for (const fund of [wallets[0], wallets[2]]) {
  const { tradeId, usdc: before } = await clearinghouse.accounts(fund.address);
  if (before === 0n) continue;
  // Withdrawing settles first, so settle now to see the real balance, and leave 1% for the funding that
  // keeps accruing until the withdrawal lands. A few dollars left over still sends the next loss to the vault.
  await send(`trade ${tradeId} settled before the weekend`, clearinghouse.settle(tradeId));
  const { usdc } = await clearinghouse.accounts(fund.address);
  if (usdc > 10n * 10n ** 18n) {
    await send(
      `${who(fund.address)} takes out spare tUSDC`,
      // Withdrawing settles again, right after the settle above, which makes a gas estimate come out short.
      clearinghouse.connect(fund).withdrawUsdc((usdc * 99n) / 100n, { gasLimit: 500_000 }),
    );
  }
}
const cap = await clearinghouse.maxFundingRatePerHour();
const posted = await deribitFundingPerHour();
const rate = posted > cap ? cap : posted < -cap ? -cap : posted;
await send(
  `funding rate set to ${(Number(rate) / 1e16).toFixed(6)}% per hour`,
  clearinghouse.connect(operator).setFundingRate(rate),
);

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
  // A network error during this long wait counts as "no new round yet", so it can't end an unattended run.
  const roundTime = () =>
    feed.latestRoundData().then(
      round => round[3],
      () => 0n,
    );
  while ((await roundTime()) <= lastSettled) {
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
  const response = await clearinghouse.settle(id);
  const receipt = (await response.wait())!;
  const events = receipt.logs.map(parse);
  const throughVault = events.some(parsed => parsed?.name === "SBillPurchased");
  logTx(
    networkName,
    `trade ${id} settled ${throughVault ? "through the vault" : "in tUSDC"} on the demo weekend`,
    response.hash,
  );
  for (const parsed of events) {
    if (parsed?.name === "Settled") {
      console.log(
        `  trade ${id}: ${who(parsed.args.payer)} pays ${usd(parsed.args.amountPaid)} to ${who(parsed.args.receiver)}`,
      );
    } else if (parsed?.name === "FundingApplied") {
      const longPays = parsed.args.longPays as bigint;
      console.log(
        `  of which funding: the ${longPays > 0n ? "long pays the short" : "short pays the long"} ` +
          `${usd(longPays > 0n ? longPays : -longPays)}`,
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

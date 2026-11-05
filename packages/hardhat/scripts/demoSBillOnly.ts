import { network } from "hardhat";
import { type ContractTransactionResponse } from "ethers";
import { DEMO_ROLES, demoWallets, deploymentAddress, logTx } from "./lib/demo.js";

/**
 * Makes sure the next weekend settlement on the demo set goes through the vault, whichever way Bitcoin
 * moves. Fund A (short, trade 1) and Fund C (long, trade 2) were set up holding sBILL only, but a fund
 * that wins a settlement is paid in tUSDC, and it would pay its next loss from that cash instead of
 * selling sBILL to the vault. Each practice run of the weekend story hands one of the funds some cash.
 *
 * For each fund this settles its trade at the current price, then withdraws the tUSDC it holds down
 * to $1 (the funding that accrues until the withdrawal lands). After that a rise sends trade 1 through
 * the vault and a fall sends trade 2 through it. The demo wallets sign; no deployer password is needed.
 * Run it with the demo weekend off, and don't settle on the demo set again until the recording, since
 * every settlement resets the move the vault purchase will be paid from:
 *
 *   DEMO=true yarn demo:sbill-only --network sepolia
 *
 * DRY_RUN=1 only reads and prints what it would do.
 */
const ONE = 10n ** 18n;
const KEEP = ONE; // $1 stays behind so a funding payment that lands first cannot make the withdrawal revert
const dryRun = process.env.DRY_RUN === "1";

const { ethers, networkName } = await network.create();
const address = (name: string) => deploymentAddress(networkName, name);
const clearinghouse = await ethers.getContractAt("Clearinghouse", address("Clearinghouse"));
const calendar = await ethers.getContractAt("DemoCalendar", address("MarketCalendar"));
const sBill = await ethers.getContractAt("SBill", address("SBill"));
const feed = await ethers.getContractAt("AggregatorV3Interface", await clearinghouse.priceFeed());

if (!(await calendar.isDemo())) throw new Error("This is the real calendar. Run with DEMO=true.");
if (!(await calendar.isOpen())) {
  const why =
    "The demo weekend is on. Switch it off on the Controls page first, so the settlement inside each " +
    "withdrawal redeems with the fund and leaves the vault empty.";
  if (!dryRun) throw new Error(why);
  console.log(`NOTE: ${why}`);
}
if (!process.env.DEMO_MNEMONIC) {
  throw new Error("DEMO_MNEMONIC is not set in packages/hardhat/.env; demoWallets() would create new, empty wallets.");
}

const usd = (amount: bigint) =>
  `$${(Number(amount / 10n ** 14n) / 1e4).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const units = (amount: bigint) =>
  (Number(amount / 10n ** 14n) / 1e4).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wallets = demoWallets(ethers.provider);
const funds = [0, 2] as const;

async function send(label: string, tx: () => Promise<ContractTransactionResponse>) {
  if (dryRun) {
    console.log(`  would send: ${label}`);
    return;
  }
  const response = await tx();
  await response.wait();
  logTx(networkName, label, response.hash);
}

const price = await clearinghouse.latestPrice();
const [, , , updatedAt] = await feed.latestRoundData();
const ageMin = Math.round((Date.now() / 1000 - Number(updatedAt)) / 60);
console.log(
  `${networkName}, demo set. Chainlink BTC/USD ${usd(price)}, ${ageMin} min old.${dryRun ? " DRY RUN: nothing is sent." : ""}`,
);

for (const i of funds) {
  const fund = wallets[i];
  const role = DEMO_ROLES[i];
  const { tradeId, usdc: before, sbill } = await clearinghouse.accounts(fund.address);
  if (tradeId === 0n) {
    throw new Error(`${role} (${fund.address}) has no open trade. Is DEMO_MNEMONIC the demo wallets' mnemonic?`);
  }
  console.log(`\n${role} ${fund.address}: trade ${tradeId}, ${usd(before)} tUSDC and ${units(sbill)} sBILL posted`);
  // Withdrawing settles first, so settle now to see the real cash balance. (The label avoids "settled at",
  // which evidence.ts uses to find the keeper's settlement.)
  await send(`trade ${tradeId} settled so ${role} can take out its cash`, () =>
    clearinghouse.connect(fund).settle(tradeId),
  );
  const { usdc } = dryRun ? { usdc: before } : await clearinghouse.accounts(fund.address);
  if (usdc <= KEEP) {
    console.log(`  ${role} holds ${usd(usdc)} tUSDC after settling; nothing to take out`);
    continue;
  }
  try {
    // The gas estimate comes out short right after a settle (demoWeekend.ts saw the same), so set it.
    await send(`${role} takes out spare tUSDC (${usd(usdc - KEEP)})`, () =>
      clearinghouse.connect(fund).withdrawUsdc(usdc - KEEP, { gasLimit: 500_000 }),
    );
  } catch (e) {
    console.log(`  withdrawal failed: ${(e as Error).message.split("\n")[0]}`);
    console.log("  A new Chainlink price probably landed in between. Run the script again; it is safe to repeat.");
  }
}

console.log("\nWhere the trades stand" + (dryRun ? " now (before any change)" : "") + ":");
for (const i of funds) {
  const fund = wallets[i];
  const a = await clearinghouse.accounts(fund.address);
  const t = await clearinghouse.trades(a.tradeId);
  const isLong = t.long.toLowerCase() === fund.address.toLowerCase();
  // The cash cushion covers this much of a price move (per BTC) before the fund has to sell sBILL.
  const move = (a.usdc * ONE) / t.size;
  const threshold = isLong ? t.lastPrice - move : t.lastPrice + move;
  console.log(
    `  trade ${a.tradeId}: ${DEMO_ROLES[i]} is ${isLong ? "long" : "short"} with ${usd(a.usdc)} tUSDC and ` +
      `${units(a.sbill)} sBILL, last settled at ${usd(t.lastPrice)}. ` +
      `It pays through the vault once BTC is ${isLong ? "below" : "above"} ${usd(threshold)}.`,
  );
}
console.log(`  vault sBILL inventory: ${units(await sBill.balanceOf(address("WeekendVault")))}`);
if (!dryRun) console.log("\nDone. Don't settle on the demo set again until the recording.");
process.exit(0);

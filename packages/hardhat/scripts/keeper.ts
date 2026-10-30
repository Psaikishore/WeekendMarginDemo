import { network } from "hardhat";
import { type ContractTransactionResponse } from "ethers";
import { deploymentAddress, logTx } from "./lib/demo.js";

/**
 * Off-chain keeper. Every KEEPER_INTERVAL_MIN minutes (default 10) it:
 *   - liquidates any trade where one side is below maintenance margin,
 *   - settles each open trade not settled for SETTLE_EVERY_MIN minutes (default 55),
 *   - redeems the vault's sBILL inventory once the T-bill market is open again,
 *   - every 8 hours posts the funding rate: Deribit BTC-PERPETUAL 8-hour funding divided by 8,
 *     or 0.00125% per hour if Deribit cannot be reached. (BitMEX's API blocks US connections.)
 * KEEPER_ONCE=1 runs a single pass. Every transaction is logged to demo-log.<network>.json.
 */
const ONE = 10n ** 18n;
const INTERVAL_MS = Number(process.env.KEEPER_INTERVAL_MIN ?? "10") * 60_000;
const SETTLE_EVERY_S = BigInt(Number(process.env.SETTLE_EVERY_MIN ?? "55") * 60);
const FUNDING_EVERY_MS = 8 * 3600_000;
const FALLBACK_FUNDING_PER_HOUR = 125n * 10n ** 11n; // 0.01% per 8 hours

const { ethers, networkName } = await network.create();
const [keeper] = await ethers.getSigners();
const at = <T extends "SBill" | "WeekendVault" | "Clearinghouse" | "MarketCalendar">(name: T) =>
  ethers.getContractAt(name, deploymentAddress(networkName, name));
const sBill = await at("SBill");
const vault = await at("WeekendVault");
const clearinghouse = await at("Clearinghouse");
const calendar = await at("MarketCalendar");

let lastFundingPost = 0;

async function send(step: string, tx: Promise<ContractTransactionResponse>) {
  try {
    const response = await tx;
    await response.wait();
    logTx(networkName, step, response.hash);
  } catch (e) {
    console.log(`  ${step} failed: ${(e as Error).message.split("\n")[0]}`);
  }
}

async function deribitFundingPerHour(): Promise<bigint> {
  try {
    const res = await fetch("https://www.deribit.com/api/v2/public/ticker?instrument_name=BTC-PERPETUAL");
    const { result } = (await res.json()) as { result: { funding_8h: number } };
    return BigInt(Math.round((result.funding_8h / 8) * 1e18));
  } catch {
    console.log("  Deribit unreachable, using the fallback funding rate");
    return FALLBACK_FUNDING_PER_HOUR;
  }
}

async function postFunding() {
  if (Date.now() - lastFundingPost < FUNDING_EVERY_MS) return;
  const owner = await clearinghouse.owner();
  if (owner.toLowerCase() !== keeper.address.toLowerCase()) return;
  const cap = await clearinghouse.maxFundingRatePerHour();
  let rate = await deribitFundingPerHour();
  if (rate > cap) rate = cap;
  if (rate < -cap) rate = -cap;
  await send(
    `funding rate set to ${(Number(rate) / 1e16).toFixed(6)}% per hour (Deribit)`,
    clearinghouse.setFundingRate(rate),
  );
  lastFundingPost = Date.now();
}

async function pass() {
  const block = await ethers.provider.getBlock("latest");
  const now = BigInt(block!.timestamp);
  const open = await calendar.isOpen();
  let price: bigint;
  try {
    price = await clearinghouse.latestPrice();
  } catch {
    console.log(`${new Date().toISOString()} price feed stale or invalid, skipping this pass`);
    return;
  }
  console.log(
    `${new Date().toISOString()} BTC $${Number(price / 10n ** 16n) / 100}, market ${open ? "open" : "closed"}`,
  );

  await postFunding();

  const lastId = (await clearinghouse.nextTradeId()) - 1n;
  for (let id = 1n; id <= lastId; id++) {
    const t = await clearinghouse.trades(id);
    if (!t.open) continue;
    const longHealth = await clearinghouse.accountHealth(t.long);
    const shortHealth = await clearinghouse.accountHealth(t.short);
    if (longHealth.equity < BigInt(longHealth.maintenance) || shortHealth.equity < BigInt(shortHealth.maintenance)) {
      await send(`trade ${id} liquidated`, clearinghouse.liquidate(id));
    } else if (now - t.lastSettledAt >= SETTLE_EVERY_S) {
      await send(`trade ${id} settled at $${Number(price / ONE)}`, clearinghouse.settle(id));
    }
  }

  if (open && (await sBill.balanceOf(await vault.getAddress())) > 0n) {
    await send("vault redeems its sBILL inventory", vault.redeemInventory());
  }
}

console.log(`Keeper ${keeper.address} on ${networkName}`);
await pass();
if (process.env.KEEPER_ONCE !== "1") {
  setInterval(() => pass().catch(e => console.log(`pass failed: ${(e as Error).message}`)), INTERVAL_MS);
}

import { network } from "hardhat";
import { type ContractTransactionResponse, type Signer } from "ethers";
import { demoWallets, deploymentAddress, logTx, topUpGas } from "./lib/demo.js";

/**
 * Prepares the live demo on a deployed system. Run it on a business day, before the weekend:
 *   1. funds four demo wallets with a little ETH for gas,
 *   2. the deployer puts tUSDC into the weekend vault,
 *   3. Fund A and Fund C buy sBILL and post it as margin; Trader B and Trader D post tUSDC,
 *   4. opens two mirrored trades: Fund A short vs Trader B long, Fund C long vs Trader D short.
 * Whichever way Bitcoin moves at the weekend, one sBILL-backed fund owes money, so settlement has
 * to go through the vault. Every step is skipped if it was already done, so it is safe to re-run.
 */
const ONE = 10n ** 18n;
const VAULT_DEPOSIT = 50_000n * ONE;
const MARGIN = 30_000n * ONE;
const SIZE = BigInt(Math.round(Number(process.env.DEMO_SIZE_BTC ?? "1") * 1e6)) * 10n ** 12n;

const { ethers, networkName } = await network.create();
const [deployer] = await ethers.getSigners();
const address = (name: string) => deploymentAddress(networkName, name);
const usdc = await ethers.getContractAt("TestUSDC", address("TestUSDC"));
const sBill = await ethers.getContractAt("SBill", address("SBill"));
const vault = await ethers.getContractAt("WeekendVault", address("WeekendVault"));
const clearinghouse = await ethers.getContractAt("Clearinghouse", address("Clearinghouse"));
const calendar = await ethers.getContractAt("MarketCalendar", address("MarketCalendar"));

if (!(await calendar.isOpen())) {
  throw new Error(
    "The T-bill market is closed, so the funds cannot buy sBILL. On the main deployment run this on a business " +
      "day; on the demo deployment switch the demo weekend off first.",
  );
}

async function send(step: string, tx: Promise<ContractTransactionResponse>) {
  const response = await tx;
  await response.wait();
  logTx(networkName, step, response.hash);
}

async function faucetIfNeeded(who: Signer, amount: bigint, step: string) {
  const address = await who.getAddress();
  if ((await usdc.balanceOf(address)) < amount) await send(step, usdc.connect(who).faucet());
}

const wallets = demoWallets(ethers.provider);
const [fundA, traderB, fundC, traderD] = wallets;
console.log(`Network ${networkName}, deployer ${deployer.address}`);
console.log(
  `Fund A ${fundA.address}\nTrader B ${traderB.address}\nFund C ${fundC.address}\nTrader D ${traderD.address}`,
);

// 1. Gas for the demo wallets.
await topUpGas(networkName, deployer, wallets);

// 2. The deployer acts as the vault investor.
if ((await vault.totalAssets()) < VAULT_DEPOSIT) {
  await faucetIfNeeded(deployer, VAULT_DEPOSIT, "investor draws tUSDC from faucet");
  await send("investor approves vault", usdc.connect(deployer).approve(await vault.getAddress(), VAULT_DEPOSIT));
  await send(
    "investor deposits 50,000 tUSDC into the weekend vault",
    vault.connect(deployer).deposit(VAULT_DEPOSIT, deployer.address),
  );
}

// 3. Margin: the funds post sBILL, the traders post tUSDC.
for (const [role, fund] of [
  ["Fund A", fundA],
  ["Fund C", fundC],
] as const) {
  if ((await clearinghouse.accounts(fund.address)).sbill > 0n) continue;
  await faucetIfNeeded(fund, MARGIN, `${role} draws tUSDC from faucet`);
  await send(`${role} approves the T-bill fund`, usdc.connect(fund).approve(await sBill.getAddress(), MARGIN));
  await send(`${role} buys sBILL with 30,000 tUSDC`, sBill.connect(fund).subscribe(MARGIN));
  const shares = await sBill.balanceOf(fund.address);
  await send(
    `${role} approves the clearinghouse`,
    sBill.connect(fund).approve(await clearinghouse.getAddress(), shares),
  );
  await send(`${role} posts sBILL as margin`, clearinghouse.connect(fund).depositSBill(shares));
}
for (const [role, trader] of [
  ["Trader B", traderB],
  ["Trader D", traderD],
] as const) {
  if ((await clearinghouse.accounts(trader.address)).usdc > 0n) continue;
  await faucetIfNeeded(trader, MARGIN, `${role} draws tUSDC from faucet`);
  await send(
    `${role} approves the clearinghouse`,
    usdc.connect(trader).approve(await clearinghouse.getAddress(), MARGIN),
  );
  await send(`${role} posts 30,000 tUSDC as margin`, clearinghouse.connect(trader).depositUsdc(MARGIN));
}

// 4. Two mirrored trades.
for (const [label, maker, taker, makerIsLong] of [
  ["Fund A short vs Trader B long", fundA, traderB, false],
  ["Fund C long vs Trader D short", fundC, traderD, true],
] as const) {
  if ((await clearinghouse.accounts(maker.address)).tradeId !== 0n) continue;
  const offerId = await clearinghouse.nextOfferId();
  await send(`${label}: offer posted`, clearinghouse.connect(maker).postOffer(makerIsLong, SIZE));
  await send(`${label}: offer accepted`, clearinghouse.connect(taker).acceptOffer(offerId));
}

for (const [role, wallet] of [
  ["Fund A", fundA],
  ["Trader B", traderB],
  ["Fund C", fundC],
  ["Trader D", traderD],
] as const) {
  const account = await clearinghouse.accounts(wallet.address);
  console.log(`${role}: trade ${account.tradeId}, tUSDC ${account.usdc / ONE}, sBILL ${account.sbill / ONE}`);
}
console.log(`Vault cash ${(await vault.cash()) / ONE} tUSDC. Setup complete.`);

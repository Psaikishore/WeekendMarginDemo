import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";

/**
 * Writes the evidence files from what is on disk, so no address or hash is typed by hand:
 *   - submission.json in the repository root (the brief's template; VIDEO_URL fills in the video),
 *   - docs/deployments.md, with Etherscan links.
 * Usage: yarn evidence [network]   (default sepolia)
 */
const networkName = process.argv[2] ?? "sepolia";
const ROOT = "../..";
const EXPLORER = "https://sepolia.etherscan.io";

type LogEntry = { time: string; step: string; hash: string };

const ROLES: Record<string, string> = {
  TestUSDC: "test stablecoin for margin and payments, with a faucet",
  SBill: "our token: a mock tokenized T-bill share (ERC-20) whose NAV grows at a fixed rate",
  MarketCalendar: "says whether the T-bill market is open; nobody can change it",
  WeekendVault: "ERC-4626 pool of tUSDC that buys sBILL at a discount while the market is closed",
  Clearinghouse: "holds margin, opens trades, settles price moves and funding, and liquidates",
  MockBtcUsdFeed: "mock BTC/USD price anyone can move, used only by the labelled stress set",
};
const DEMO_CALENDAR_ROLE = "says whether the T-bill market is open; the owner can switch the weekend on and off";
const SETS = [
  { prefix: "", title: "Main set", note: "The production design: real calendar and the Chainlink price. No trades." },
  { prefix: "Demo", title: "Demo set", note: "The owner can switch the weekend on and off. Chainlink price." },
  { prefix: "Stress", title: "Stress set", note: "As the demo set, but the BTC price is a mock anyone can move." },
];

const dir = `deployments/${networkName}`;
const deployed = new Set(
  readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace(".json", "")),
);
const addressOf = (name: string) => JSON.parse(readFileSync(`${dir}/${name}.json`, "utf8")).address as string;
const readLog = (suffix: string): LogEntry[] => {
  const file = `demo-log.${networkName}${suffix}.json`;
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
};
const demoLog = readLog("-demo");
const stressLog = readLog("-stress");
const last = (log: LogEntry[], match: string) => [...log].reverse().find(e => e.step.includes(match))?.hash;

const contracts = SETS.flatMap(set =>
  Object.keys(ROLES)
    .filter(name => deployed.has(set.prefix + name))
    .map(name => ({
      name: set.prefix + name,
      address: addressOf(set.prefix + name),
      role: `${set.title}: ${name === "MarketCalendar" && set.prefix ? DEMO_CALENDAR_ROLE : ROLES[name]}`,
    })),
);

const KEY_TRANSACTIONS: [LogEntry[], string, string][] = [
  [demoLog, "posts sBILL as margin", "a fund posts sBILL as margin"],
  [demoLog, "offer accepted", "a trade opens at the Chainlink price"],
  [demoLog, "funding rate set", "the funding rate is posted"],
  [demoLog, "switched to the weekend", "the T-bill market closes (demo switch)"],
  [demoLog, "settled through the vault", "settlement pays the winner through the vault, with funding"],
  [demoLog, "vault redeems", "the vault redeems its sBILL and keeps the discount"],
  [demoLog, "settled at", "the keeper settles a trade"],
  [stressLog, "liquidated by", "a liquidation pays the winner and the liquidator through the vault"],
];
const transactions = KEY_TRANSACTIONS.flatMap(([log, match, shows]) => {
  const hash = last(log, match);
  return hash ? [{ hash, shows }] : [];
});
const tx = (log: LogEntry[], match: string) => last(log, match) ?? "pending";

const features = [
  { feature: "Test suite with revert tests", evidence: "packages/hardhat/test/WeekendMargin.ts; run with yarn test" },
  { feature: "Slither security scan", evidence: "docs/slither.md" },
  { feature: "Gas measured, with a change made because of it", evidence: "docs/gas.md" },
  { feature: "Front end", evidence: "packages/nextjs/app; video" },
  { feature: "Keeper script", evidence: `packages/hardhat/scripts/keeper.ts; tx ${tx(demoLog, "settled at")}` },
  {
    feature: "Chainlink feed with staleness and sign checks",
    evidence: "packages/hardhat/contracts/Clearinghouse.sol _price(); tests",
  },
  {
    feature: "On-chain funding settlement",
    evidence: `tx ${tx(demoLog, "settled through the vault")} (FundingApplied event)`,
  },
  {
    feature: "Liquidation with a reward for the liquidator, plus a keeper",
    evidence: `tx ${tx(stressLog, "liquidated by")}; packages/hardhat/scripts/keeper.ts`,
  },
  {
    feature: "Weekend vault and calendar-aware margin (our own addition)",
    evidence: `tx ${tx(demoLog, "settled through the vault")} (SBillPurchased event)`,
  },
];

const sBillAddress = deployed.has("DemoSBill") ? addressOf("DemoSBill") : "";
const previous = existsSync(`${ROOT}/submission.json`)
  ? JSON.parse(readFileSync(`${ROOT}/submission.json`, "utf8"))
  : {};
const submission = {
  team: "Team 9",
  members: [
    { name: "Sai Kishore", netid: "sp8744" },
    { name: "Swastik Mishra", netid: "sgm9198" },
  ],
  topic: "Hedging with perpetual swaps",
  repository: "https://github.com/Psaikishore/WeekendMarginDemo",
  tag: "final",
  network: networkName,
  token: { standard: "ERC-20", name: "Tokenized T-Bill Share (sBILL)", address: sBillAddress },
  contracts,
  transactions,
  features,
  video: process.env.VIDEO_URL ?? previous.video ?? "",
};
writeFileSync(`${ROOT}/submission.json`, JSON.stringify(submission, null, 2) + "\n");

const link = (kind: "address" | "tx", value: string) => `[\`${value}\`](${EXPLORER}/${kind}/${value})`;
const lines = [
  "# Deployments",
  "",
  `Written by \`yarn evidence\` from the files in \`packages/hardhat/deployments/${networkName}\`. Do not edit by hand.`,
  "",
  "The Chainlink BTC/USD feed is `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43`.",
  "",
];
for (const set of SETS) {
  lines.push(`## ${set.title}`, "", set.note, "", "| Contract | Address |", "|---|---|");
  for (const name of Object.keys(ROLES)) {
    if (deployed.has(set.prefix + name)) {
      lines.push(`| ${set.prefix + name} | ${link("address", addressOf(set.prefix + name))} |`);
    }
  }
  lines.push("");
}
lines.push("## Key transactions", "", "| What it shows | Transaction |", "|---|---|");
for (const { hash, shows } of transactions) lines.push(`| ${shows} | ${link("tx", hash)} |`);
lines.push(
  "",
  `Every step of the demo runs is in \`packages/hardhat/demo-log.${networkName}-*.json\`. Those logs leave out the deployments, the setup calls after them and one mock price update that ran out of gas, which [gas.md](gas.md) explains.`,
  "",
);
writeFileSync(`${ROOT}/docs/deployments.md`, lines.join("\n"));

console.log(`Wrote submission.json and docs/deployments.md for ${networkName}.`);
console.log(`Contracts: ${contracts.length}. Key transactions: ${transactions.length} of ${KEY_TRANSACTIONS.length}.`);
if (!submission.video) console.log("The video link is still empty. Add it with: VIDEO_URL=https://... yarn evidence");

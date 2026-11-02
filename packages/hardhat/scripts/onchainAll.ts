import "dotenv/config";
import { Wallet } from "ethers";
import password from "@inquirer/password";
import { spawnSync } from "child_process";

/**
 * Runs everything that happens on-chain, in order, after asking for the deployer password once:
 * deploys the main, demo and stress sets, verifies them, sets up the demo, runs the weekend story,
 * a keeper pass and the liquidation, then writes submission.json and docs/deployments.md.
 *
 * Usage: yarn onchain:all                    (Sepolia)
 *        yarn onchain:all --network default  (rehearsal on `yarn chain`, no password)
 * START_AT=6 yarn onchain:all                resumes from step 6 if something stopped.
 */
const networkIndex = process.argv.indexOf("--network");
const networkName = networkIndex !== -1 ? process.argv[networkIndex + 1] : "sepolia";
const isLocal = networkName === "default" || networkName === "hardhat";
const startAt = Number(process.env.START_AT ?? "1");

const DEMO = { DEMO: "true" };
const STRESS = { DEMO: "true", DEPLOY_PREFIX: "Stress" };
const deploy = ["hardhat", "deploy", "--no-compile", "--skip-prompts", "--network", networkName];
const run = (script: string) => ["hardhat", "run", "--network", networkName, script];

type Step = { title: string; command: string[]; env?: Record<string, string>; liveOnly?: boolean; canFail?: boolean };
const STEPS: Step[] = [
  { title: "Compile", command: ["hardhat", "compile"] },
  { title: "Deploy the main set (real calendar)", command: deploy },
  { title: "Deploy the demo set (weekend switch)", command: deploy, env: DEMO },
  { title: "Deploy the stress set (mock price)", command: deploy, env: { ...STRESS, MOCK_FEED: "true" } },
  {
    title: "Verify on Etherscan",
    command: ["tsx", "scripts/runVerify.ts", "--network", networkName],
    liveOnly: true,
    canFail: true, // Etherscan's API can be flaky, and verifying again later is harmless
  },
  { title: "Set up the demo accounts and trades", command: run("scripts/demoSetup.ts"), env: DEMO },
  {
    title: "Run the weekend story (waits for a new Chainlink price)",
    command: run("scripts/demoWeekend.ts"),
    env: DEMO,
  },
  {
    title: "Run one keeper pass",
    command: run("scripts/keeper.ts"),
    env: { ...DEMO, KEEPER_ONCE: "1", SETTLE_EVERY_MIN: "0" },
  },
  { title: "Run the liquidation on the stress set", command: run("scripts/demoLiquidation.ts"), env: STRESS },
  {
    title: "Write submission.json and docs/deployments.md",
    command: ["tsx", "scripts/evidence.ts", networkName],
    liveOnly: true,
  },
];

if (!isLocal) {
  const encryptedKey = process.env.DEPLOYER_PRIVATE_KEY_ENCRYPTED;
  if (!encryptedKey) throw new Error("No deployer account. Run yarn generate or yarn account:import first.");
  const pass = await password({ message: "Enter password to decrypt private key:" });
  process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY = (await Wallet.fromEncryptedJson(encryptedKey, pass)).privateKey;
}

for (const [i, step] of STEPS.entries()) {
  const number = i + 1;
  if (number < startAt || (step.liveOnly && isLocal)) continue;
  console.log(`\n=== Step ${number} of ${STEPS.length}: ${step.title}`);
  const [command, ...args] = step.command;
  const { status } = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...step.env },
    shell: process.platform === "win32",
  });
  if (status !== 0 && step.canFail) {
    console.error(`\nStep ${number} had a problem. Carrying on. Afterwards, run: yarn verify --network ${networkName}`);
  } else if (status !== 0) {
    console.error(`\nStep ${number} failed. Fix the cause, then resume with: START_AT=${number} yarn onchain:all`);
    process.exit(status ?? 1);
  }
}
console.log(
  isLocal
    ? "\nRehearsal finished."
    : "\nAll done. Addresses and transactions are in docs/deployments.md and submission.json.",
);

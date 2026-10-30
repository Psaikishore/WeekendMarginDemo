import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import { HDNodeWallet, Wallet, type Provider } from "ethers";

export const DEMO_ROLES = ["Fund A", "Trader B", "Fund C", "Trader D"] as const;

/** Same rule as the deploy script: DEMO=true means the "Demo" set unless DEPLOY_PREFIX says otherwise. */
export function deploymentPrefix(): string {
  return process.env.DEPLOY_PREFIX ?? (process.env.DEMO === "true" ? "Demo" : "");
}

/** Address of a contract deployed by deploy/00_deploy_weekend_margin.ts on `networkName`. */
export function deploymentAddress(networkName: string, name: string): string {
  const prefix = deploymentPrefix();
  const file = `deployments/${networkName}/${prefix}${name}.json`;
  if (!existsSync(file)) throw new Error(`No deployment found at ${file}. Run yarn deploy first.`);
  return JSON.parse(readFileSync(file, "utf8")).address;
}

/**
 * The four demo wallets (Fund A, Trader B, Fund C, Trader D), derived from a mnemonic kept in
 * packages/hardhat/.env as DEMO_MNEMONIC. It is created on first use and never printed.
 */
export function demoWallets(provider: Provider): HDNodeWallet[] {
  let mnemonic = process.env.DEMO_MNEMONIC;
  if (!mnemonic) {
    mnemonic = Wallet.createRandom().mnemonic!.phrase;
    appendFileSync(".env", `\n# Test wallets for the Sepolia demo (testnet only)\nDEMO_MNEMONIC="${mnemonic}"\n`);
    process.env.DEMO_MNEMONIC = mnemonic;
  }
  const base = HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0");
  return DEMO_ROLES.map((_, i) => base.deriveChild(i).connect(provider));
}

/** Evidence file for submission.json: demo-log.sepolia.json, or demo-log.sepolia-demo.json for the demo set. */
export function logFile(networkName: string): string {
  const prefix = deploymentPrefix();
  return `demo-log.${networkName}${prefix ? `-${prefix.toLowerCase()}` : ""}.json`;
}

/** Appends a transaction to the evidence file. */
export function logTx(networkName: string, step: string, hash: string) {
  const file = logFile(networkName);
  const entries = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  entries.push({ time: new Date().toISOString(), step, hash });
  writeFileSync(file, JSON.stringify(entries, null, 2) + "\n");
  console.log(`  ${step}: ${hash}`);
}

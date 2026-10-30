import "dotenv/config";
import { Wallet } from "ethers";
import password from "@inquirer/password";
import { spawn } from "child_process";

/**
 * Decrypts the deployer key (like runHardhatDeployWithPK.ts) and runs a Hardhat script with it.
 * Usage: tsx scripts/runWithDeployerPK.ts scripts/keeper.ts --network sepolia
 */
async function main() {
  const [script, ...rest] = process.argv.slice(2);
  const networkIndex = rest.indexOf("--network");
  const networkName = networkIndex !== -1 ? rest[networkIndex + 1] : "default";

  if (networkName !== "default" && networkName !== "hardhat") {
    const encryptedKey = process.env.DEPLOYER_PRIVATE_KEY_ENCRYPTED;
    if (!encryptedKey) {
      console.log("🚫️ You don't have a deployer account. Run `yarn generate` or `yarn account:import` first");
      return;
    }
    const pass = await password({ message: "Enter password to decrypt private key:" });
    try {
      const wallet = await Wallet.fromEncryptedJson(encryptedKey, pass);
      process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY = wallet.privateKey;
    } catch {
      console.error("Failed to decrypt private key. Wrong password?");
      process.exit(1);
    }
  }

  const child = spawn("hardhat", ["run", "--network", networkName, script], {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  child.on("exit", code => process.exit(code || 0));
}

main().catch(console.error);

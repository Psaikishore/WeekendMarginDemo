import { readFileSync } from "fs";
import { deployScript, artifacts } from "../rocketh/deploy.js";

// Chainlink BTC/USD on Sepolia (8 decimals, updates hourly or on a price move).
const SEPOLIA_BTC_USD_FEED = "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43";
const HARDHAT_CHAIN_ID = 31337;
const SEPOLIA_CHAIN_ID = 11155111;

// Sepolia's going rate is near zero, but the default tip is 1 gwei, which drains a small test wallet.
const SEPOLIA_FEES = { maxFeePerGas: 50_000_000n, maxPriorityFeePerGas: 50_000_000n }; // 0.05 gwei

const ONE = 10n ** 18n;

// Every setting lives in config/protocol.json, so a new deployment needs no code change.
const config = JSON.parse(readFileSync(new URL("../../../config/protocol.json", import.meta.url), "utf8"));
const FUND_INTEREST_RESERVE = BigInt(config.fundInterestReserve) * ONE; // tUSDC the T-bill fund holds to pay interest
const CLEARING_PARAMS = {
  maxPriceAge: BigInt(config.maxPriceAgeSeconds),
  initialMarginBps: BigInt(config.initialMarginBps),
  maintenanceMarginBps: BigInt(config.maintenanceMarginBps),
  weekdayHaircutBps: BigInt(config.weekdayHaircutBps),
  weekendHaircutBps: BigInt(config.weekendHaircutBps),
  liquidationRewardBps: BigInt(config.liquidationRewardBps),
  // Config in basis points per hour; the contract wants 18 decimals (1e18 = 100%).
  maxFundingRatePerHour: (BigInt(config.maxFundingBpsPerHour) * ONE) / 10_000n,
};

/**
 * Deploys the full system: TestUSDC, a calendar, SBill, WeekendVault and Clearinghouse.
 *
 * The main deployment uses MarketCalendar, the real calendar that nobody can change.
 * DEMO=true deploys the labelled demo copy instead: every name gets the "Demo" prefix and the
 * calendar is DemoCalendar, whose weekend the deployer switches on and off to show the weekend
 * path on any day. DEPLOY_PREFIX overrides the prefix.
 * MOCK_FEED=true uses a mock price anyone can move, for the labelled stress set that shows a
 * liquidation on Sepolia. The local chain always uses the mock.
 */
export default deployScript(
  async env => {
    const { deployer } = env.namedAccounts;
    const demo = process.env.DEMO === "true";
    const prefix = process.env.DEPLOY_PREFIX ?? (demo ? "Demo" : "");
    const chainId = env.network.chain.id;

    const fees = chainId === SEPOLIA_CHAIN_ID ? SEPOLIA_FEES : {};

    let feedAddress: `0x${string}`;
    if (chainId === HARDHAT_CHAIN_ID || process.env.MOCK_FEED === "true") {
      const mockFeed = await env.deploy(`${prefix}MockBtcUsdFeed`, {
        account: deployer,
        ...fees,
        artifact: artifacts.MockV3Aggregator,
        args: [8, 83_000n * 10n ** 8n],
      });
      feedAddress = mockFeed.address;
    } else if (chainId === SEPOLIA_CHAIN_ID) {
      feedAddress = SEPOLIA_BTC_USD_FEED;
    } else {
      throw new Error(`No BTC/USD feed configured for chain ${chainId}`);
    }

    const usdc = await env.deploy(`${prefix}TestUSDC`, {
      account: deployer,
      ...fees,
      artifact: artifacts.TestUSDC,
      args: [deployer],
    });

    const calendar = demo
      ? await env.deploy(`${prefix}MarketCalendar`, {
          account: deployer,
          ...fees,
          artifact: artifacts.DemoCalendar,
          args: [deployer],
        })
      : await env.deploy(`${prefix}MarketCalendar`, {
          account: deployer,
          ...fees,
          artifact: artifacts.MarketCalendar,
          args: [],
        });

    const sBill = await env.deploy(`${prefix}SBill`, {
      account: deployer,
      ...fees,
      artifact: artifacts.SBill,
      args: [usdc.address, calendar.address, BigInt(config.sBillApyBps)],
    });

    const vault = await env.deploy(`${prefix}WeekendVault`, {
      account: deployer,
      ...fees,
      artifact: artifacts.WeekendVault,
      args: [
        usdc.address,
        sBill.address,
        calendar.address,
        BigInt(config.vaultDiscountBps),
        BigInt(config.vaultMaxDiscountBps),
        deployer,
      ],
    });

    const clearinghouse = await env.deploy(`${prefix}Clearinghouse`, {
      account: deployer,
      ...fees,
      artifact: artifacts.Clearinghouse,
      args: [usdc.address, sBill.address, vault.address, calendar.address, feedAddress, CLEARING_PARAMS, deployer],
    });

    // One-time wiring. Both calls are skipped when the script is re-run.
    const linked = await env.read(vault, { functionName: "clearinghouse" });
    if (linked === "0x0000000000000000000000000000000000000000") {
      await env.execute(vault, {
        functionName: "setClearinghouse",
        args: [clearinghouse.address],
        account: deployer,
        ...fees,
      });
    } else if (linked.toLowerCase() !== clearinghouse.address.toLowerCase()) {
      throw new Error(
        `${prefix}WeekendVault is linked to another clearinghouse for good. After changing code or settings, ` +
          `deploy under a new DEPLOY_PREFIX, or delete deployments/${env.name}/${prefix}*.json first.`,
      );
    }
    const reserve = await env.read(usdc, { functionName: "balanceOf", args: [sBill.address] });
    if (reserve === 0n) {
      await env.execute(usdc, {
        functionName: "mint",
        args: [sBill.address, FUND_INTEREST_RESERVE],
        account: deployer,
        ...fees,
      });
    }

    console.log(
      `${prefix || "Main"} deployment, ${demo ? "demo calendar (operator switch)" : "real calendar"}, feed ${feedAddress}`,
    );
  },
  {
    tags: ["WeekendMargin"],
  },
);

import { deployScript, artifacts } from "../rocketh/deploy.js";

// Chainlink BTC/USD on Sepolia (8 decimals, updates hourly or on a price move).
const SEPOLIA_BTC_USD_FEED = "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43";
const HARDHAT_CHAIN_ID = 31337;
const SEPOLIA_CHAIN_ID = 11155111;

// Sepolia's going rate is near zero, but the default tip is 1 gwei, which drains a small test wallet.
const SEPOLIA_FEES = { maxFeePerGas: 50_000_000n, maxPriorityFeePerGas: 50_000_000n }; // 0.05 gwei

const ONE = 10n ** 18n;
const SBILL_APY_BPS = 400n; // 4.00% simple annual interest on sBILL
const VAULT_DISCOUNT_BPS = 10n; // the vault buys sBILL at NAV minus 0.10% at the weekend
const FUND_INTEREST_RESERVE = 1_000_000n * ONE; // tUSDC the T-bill fund holds to pay interest

const CLEARING_PARAMS = {
  maxPriceAge: 2n * 3600n, // above the feed's 1-hour heartbeat
  initialMarginBps: 2000n,
  maintenanceMarginBps: 1000n,
  weekdayHaircutBps: 100n,
  weekendHaircutBps: 300n,
  liquidationRewardBps: 50n, // 0.5% of notional to whoever liquidates
  maxFundingRatePerHour: 10n ** 15n, // 0.1% per hour cap on the posted funding rate
};

/**
 * Deploys the full system: TestUSDC, a calendar, SBill, WeekendVault and Clearinghouse.
 *
 * The main deployment uses MarketCalendar, the real calendar that nobody can change.
 * DEMO=true deploys the labelled demo copy instead: every name gets the "Demo" prefix and the
 * calendar is DemoCalendar, whose weekend the deployer switches on and off to show the weekend
 * path on any day. DEPLOY_PREFIX overrides the prefix.
 */
export default deployScript(
  async env => {
    const { deployer } = env.namedAccounts;
    const demo = process.env.DEMO === "true";
    const prefix = process.env.DEPLOY_PREFIX ?? (demo ? "Demo" : "");
    const chainId = env.network.chain.id;

    const fees = chainId === SEPOLIA_CHAIN_ID ? SEPOLIA_FEES : {};

    let feedAddress: `0x${string}`;
    if (chainId === HARDHAT_CHAIN_ID) {
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
      args: [usdc.address, calendar.address, SBILL_APY_BPS],
    });

    const vault = await env.deploy(`${prefix}WeekendVault`, {
      account: deployer,
      ...fees,
      artifact: artifacts.WeekendVault,
      args: [usdc.address, sBill.address, calendar.address, VAULT_DISCOUNT_BPS, deployer],
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

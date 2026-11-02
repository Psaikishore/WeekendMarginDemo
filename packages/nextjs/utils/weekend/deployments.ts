import type { Abi, Address } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";

export type ContractInfo = { address: Address; abi: Abi; deployedOnBlock?: number };

const contractsByChain = deployedContracts as unknown as Record<number, Record<string, ContractInfo>>;

export const contractsOn = (chainId: number) => contractsByChain[chainId] ?? {};

/** Each set of contracts is told apart by the prefix on its names. See deploy/00_deploy_weekend_margin.ts. */
export const prefixesOn = (chainId: number) =>
  Object.keys(contractsOn(chainId))
    .filter(name => name.endsWith("Clearinghouse"))
    .map(name => name.replace(/Clearinghouse$/, ""));

// Every set has the same ABI, so the types of one name describe all of them.
export const contractNames = (prefix: string) => ({
  Clearinghouse: `${prefix}Clearinghouse` as "Clearinghouse",
  WeekendVault: `${prefix}WeekendVault` as "WeekendVault",
  SBill: `${prefix}SBill` as "SBill",
  TestUSDC: `${prefix}TestUSDC` as "TestUSDC",
  Calendar: `${prefix}MarketCalendar` as "DemoMarketCalendar",
  MockFeed: `${prefix}MockBtcUsdFeed` as "StressMockBtcUsdFeed",
});

export type SetInfo = { label: string; short: string; tone: string; explanation: string };

export const describeSet = (prefix: string): SetInfo => {
  if (prefix === "Demo") {
    return {
      label: "Demo set",
      short: "Weekend switch",
      tone: "badge-warning",
      explanation:
        "Real Chainlink price. The deployer holds a switch that says “it is the weekend now”, so the weekend path can be shown on any day. Test tokens only.",
    };
  }
  if (prefix === "Stress") {
    return {
      label: "Stress set",
      short: "Mock price",
      tone: "badge-error",
      explanation:
        "The BTC price here is a mock that anyone can move. This set exists only to show a liquidation, which would need a 25% move at the demo's size. Test tokens only.",
    };
  }
  return {
    label: prefix ? `${prefix} set` : "Main set",
    short: "Real calendar",
    tone: "badge-success",
    explanation:
      "Real Chainlink price and the real calendar: the market is closed from Friday 21:00 to Monday 14:00 UTC, and nobody can change that. Test tokens only.",
  };
};

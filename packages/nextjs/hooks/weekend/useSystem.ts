import { useMemo } from "react";
import type { Abi, Address } from "viem";
import { useReadContract } from "wagmi";
import { useDeployment } from "~~/components/weekend/DeploymentProvider";
import { type Call, useBatchRead } from "~~/hooks/weekend/useBatchRead";

const FEED_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const satisfies Abi;

export type System = {
  btcPrice?: bigint;
  priceProblem?: string;
  priceUpdatedAt?: number;
  fundingRate?: bigint;
  maxFundingRate?: bigint;
  initialMarginBps?: bigint;
  maintenanceMarginBps?: bigint;
  weekdayHaircutBps?: bigint;
  weekendHaircutBps?: bigint;
  haircutBps?: bigint;
  liquidationRewardBps?: bigint;
  maxPriceAge?: bigint;
  paused?: boolean;
  owner?: Address;
  nextOfferId?: bigint;
  nextTradeId?: bigint;
  vaultCash?: bigint;
  inventoryCost?: bigint;
  vaultAssets?: bigint;
  vaultShares?: bigint;
  discountBps?: bigint;
  maxDiscountBps?: bigint;
  purchasePrice?: bigint;
  vaultOwner?: Address;
  vaultSBill?: bigint;
  nav?: bigint;
  apyBps?: bigint;
  isOpen?: boolean;
  isDemoCalendar?: boolean;
  secondsUntilOpen?: bigint;
  calendarOwner?: Address;
  isLoading: boolean;
};

/** Everything about the selected set of contracts that isn't specific to one account. */
export const useSystem = (): System => {
  const { clearinghouse, vault, sBill, calendar, chainId } = useDeployment();

  const calls: Call[] = [
    { key: "btcPrice", contract: clearinghouse, functionName: "latestPrice" },
    { key: "priceFeed", contract: clearinghouse, functionName: "priceFeed" },
    { key: "fundingRate", contract: clearinghouse, functionName: "fundingRatePerHour" },
    { key: "maxFundingRate", contract: clearinghouse, functionName: "maxFundingRatePerHour" },
    { key: "initialMarginBps", contract: clearinghouse, functionName: "initialMarginBps" },
    { key: "maintenanceMarginBps", contract: clearinghouse, functionName: "maintenanceMarginBps" },
    { key: "weekdayHaircutBps", contract: clearinghouse, functionName: "weekdayHaircutBps" },
    { key: "weekendHaircutBps", contract: clearinghouse, functionName: "weekendHaircutBps" },
    { key: "haircutBps", contract: clearinghouse, functionName: "haircutBps" },
    { key: "liquidationRewardBps", contract: clearinghouse, functionName: "liquidationRewardBps" },
    { key: "maxPriceAge", contract: clearinghouse, functionName: "maxPriceAge" },
    { key: "paused", contract: clearinghouse, functionName: "paused" },
    { key: "owner", contract: clearinghouse, functionName: "owner" },
    { key: "nextOfferId", contract: clearinghouse, functionName: "nextOfferId" },
    { key: "nextTradeId", contract: clearinghouse, functionName: "nextTradeId" },
    { key: "vaultCash", contract: vault, functionName: "cash" },
    { key: "inventoryCost", contract: vault, functionName: "inventoryCost" },
    { key: "vaultAssets", contract: vault, functionName: "totalAssets" },
    { key: "vaultShares", contract: vault, functionName: "totalSupply" },
    { key: "discountBps", contract: vault, functionName: "discountBps" },
    { key: "maxDiscountBps", contract: vault, functionName: "maxDiscountBps" },
    { key: "purchasePrice", contract: vault, functionName: "purchasePrice" },
    { key: "vaultOwner", contract: vault, functionName: "owner" },
    { key: "nav", contract: sBill, functionName: "nav" },
    { key: "apyBps", contract: sBill, functionName: "apyBps" },
    { key: "vaultSBill", contract: sBill, functionName: "balanceOf", args: [vault?.address] },
    { key: "isOpen", contract: calendar, functionName: "isOpen" },
    { key: "isDemoCalendar", contract: calendar, functionName: "isDemo" },
    { key: "secondsUntilOpen", contract: calendar, functionName: "secondsUntilOpen" },
    { key: "calendarOwner", contract: calendar, functionName: "owner" },
  ];

  const { values, errors, isLoading } = useBatchRead(calls);

  const { data: round } = useReadContract({
    address: values.priceFeed as Address | undefined,
    abi: FEED_ABI,
    functionName: "latestRoundData",
    chainId,
    query: { enabled: Boolean(values.priceFeed), refetchInterval: 30_000 },
  });

  return useMemo(() => {
    let priceProblem: string | undefined;
    if (errors.btcPrice) {
      priceProblem = errors.btcPrice.includes("StalePrice") ? "stale" : "unavailable";
    }
    return {
      ...(values as Omit<System, "priceProblem" | "priceUpdatedAt" | "isLoading">),
      priceProblem,
      priceUpdatedAt: round ? Number(round[3]) : undefined,
      isLoading,
    };
  }, [values, errors, round, isLoading]);
};

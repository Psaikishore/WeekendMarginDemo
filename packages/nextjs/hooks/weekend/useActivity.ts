import { useQuery } from "@tanstack/react-query";
import { type Abi, type Hash, parseEventLogs } from "viem";
import { hardhat } from "viem/chains";
import { usePublicClient } from "wagmi";
import { useDeployment } from "~~/components/weekend/DeploymentProvider";
import { fmtToken, fmtUsd } from "~~/utils/weekend/format";

export type ActivityItem = { key: string; block: bigint; index: number; hash: Hash; title: string; detail: string };

type Args = Record<string, any>;

// Public RPCs refuse log queries over too many blocks, so read in chunks.
const CHUNK_BLOCKS = 20_000n;

/** Turns a contract event into a sentence. Events that add nothing for a reader return null. */
const describe = (name: string, a: Args): { title: string; detail: string } | null => {
  switch (name) {
    case "TradeOpened":
      return { title: `Trade ${a.tradeId} opened`, detail: `${fmtToken(a.size, 4)} BTC at ${fmtUsd(a.price)}` };
    case "Settled":
      return {
        title: `Trade ${a.tradeId} settled`,
        detail: `BTC at ${fmtUsd(a.price)}. ${fmtUsd(a.amountPaid)} paid to the winner${a.amountPaid < a.amountDue ? `, ${fmtUsd((a.amountDue as bigint) - (a.amountPaid as bigint))} short of what was due` : ""}`,
      };
    case "FundingApplied":
      return {
        title: `Funding on trade ${a.tradeId}`,
        detail: `The ${a.longPays > 0n ? "long paid the short" : "short paid the long"} ${fmtUsd((a.longPays as bigint) > 0n ? a.longPays : -(a.longPays as bigint), 4)}`,
      };
    case "CollateralConverted":
      return {
        title: a.viaVault ? "sBILL sold to the vault" : "sBILL redeemed with the fund",
        detail: `${fmtToken(a.sbillSold)} sBILL raised ${fmtUsd(a.usdcRaised)}`,
      };
    case "SBillPurchased":
      return {
        title: "Vault bought sBILL",
        detail: `${fmtToken(a.sbillIn)} sBILL at ${fmtUsd(a.price, 6)} each, ${a.discountBps} basis points below NAV`,
      };
    case "InventoryRedeemed":
      return {
        title: "Vault redeemed its sBILL",
        detail: `Received ${fmtUsd(a.usdcReceived)}, a profit of ${fmtUsd(a.profit)}`,
      };
    case "Liquidated":
      return { title: `Trade ${a.tradeId} liquidated`, detail: `The liquidator earned ${fmtUsd(a.reward)}` };
    case "TradeClosed":
      return { title: `Trade ${a.tradeId} closed`, detail: `At ${fmtUsd(a.price)}` };
    case "FundingRateUpdated":
      return { title: "Funding rate posted", detail: `${((Number(a.ratePerHour) / 1e18) * 100).toFixed(5)}% per hour` };
    case "DiscountUpdated":
      return { title: "Vault discount changed", detail: `Now ${a.discountBps} basis points` };
    case "DemoWeekendSet":
      return {
        title: a.weekend ? "Demo weekend switched on" : "Demo weekend switched off",
        detail: a.weekend ? "The T-bill market is now closed" : "The T-bill market is now open",
      };
    default:
      return null;
  }
};

/** Recent events from the clearinghouse, the vault and the calendar, newest first. */
export const useActivity = (limit = 12) => {
  const { prefix, chainId, clearinghouse, vault, calendar } = useDeployment();
  const client = usePublicClient({ chainId });

  return useQuery({
    queryKey: ["weekend-activity", chainId, prefix],
    enabled: Boolean(client && clearinghouse && vault),
    refetchInterval: chainId === hardhat.id ? 3_000 : 30_000,
    queryFn: async (): Promise<ActivityItem[]> => {
      const contracts = [clearinghouse, vault, calendar].filter(Boolean);
      const latest = await client!.getBlockNumber();
      const first = BigInt(clearinghouse.deployedOnBlock ?? 0);
      const logs = [];
      for (let from = first; from <= latest; from += CHUNK_BLOCKS) {
        const to = from + CHUNK_BLOCKS - 1n < latest ? from + CHUNK_BLOCKS - 1n : latest;
        logs.push(...(await client!.getLogs({ address: contracts.map(c => c.address), fromBlock: from, toBlock: to })));
      }
      const abi = contracts.flatMap(c => c.abi as Abi as unknown[]) as Abi;
      const parsed = parseEventLogs({ abi, logs, strict: false }) as unknown as {
        eventName: string;
        args: Args;
        blockNumber: bigint;
        logIndex: number;
        transactionHash: Hash;
      }[];
      return parsed
        .flatMap(log => {
          const text = describe(log.eventName, log.args);
          return text
            ? [
                {
                  key: `${log.transactionHash}-${log.logIndex}`,
                  block: log.blockNumber,
                  index: log.logIndex,
                  hash: log.transactionHash,
                  ...text,
                },
              ]
            : [];
        })
        .sort((a, b) => (a.block === b.block ? b.index - a.index : a.block > b.block ? -1 : 1))
        .slice(0, limit);
    },
  });
};

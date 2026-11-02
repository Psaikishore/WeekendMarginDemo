import { useMemo } from "react";
import type { Address } from "viem";
import { useDeployment } from "~~/components/weekend/DeploymentProvider";
import { type Call, useBatchRead } from "~~/hooks/weekend/useBatchRead";
import type { System } from "~~/hooks/weekend/useSystem";

export type Trade = {
  id: bigint;
  long: Address;
  short: Address;
  size: bigint;
  lastPrice: bigint;
  lastSettledAt: number;
  unsettledToLong?: bigint;
  longEquity?: bigint;
  shortEquity?: bigint;
  maintenance?: bigint;
  canLiquidate: boolean;
};

export type Offer = { id: bigint; maker: Address; makerIsLong: boolean; size: bigint };

const ids = (next: bigint | undefined) =>
  next === undefined ? [] : Array.from({ length: Number(next) - 1 }, (_, i) => BigInt(i + 1));

/** Every open trade, with its unsettled P&L and how much margin each side has. */
export const useOpenTrades = (system: System) => {
  const { clearinghouse } = useDeployment();

  const { values: raw, isLoading } = useBatchRead(
    ids(system.nextTradeId).map(id => ({
      key: id.toString(),
      contract: clearinghouse,
      functionName: "trades",
      args: [id],
    })),
  );

  const open = useMemo(
    () =>
      Object.entries(raw)
        .map(([id, value]) => {
          const [long, lastSettledAt, isOpen, short, size, lastPrice] = value as readonly [
            Address,
            number,
            boolean,
            Address,
            bigint,
            bigint,
            bigint,
          ];
          return { id: BigInt(id), long, short, size, lastPrice, lastSettledAt: Number(lastSettledAt), isOpen };
        })
        .filter(trade => trade.isOpen),
    [raw],
  );

  const details: Call[] = open.flatMap(trade => [
    { key: `${trade.id}:long`, contract: clearinghouse, functionName: "accountHealth", args: [trade.long] },
    { key: `${trade.id}:short`, contract: clearinghouse, functionName: "accountHealth", args: [trade.short] },
    {
      key: `${trade.id}:pnl`,
      contract: clearinghouse,
      functionName: "unsettledPnl",
      args: [trade.long, system.btcPrice],
    },
  ]);
  const { values: detail } = useBatchRead(system.btcPrice === undefined ? [] : details);

  const trades: Trade[] = useMemo(
    () =>
      open.map(({ id, long, short, size, lastPrice, lastSettledAt }) => {
        const longHealth = detail[`${id}:long`] as readonly [bigint, bigint, bigint] | undefined;
        const shortHealth = detail[`${id}:short`] as readonly [bigint, bigint, bigint] | undefined;
        const maintenance = longHealth?.[1];
        const below = (equity?: bigint) => equity !== undefined && maintenance !== undefined && equity < maintenance;
        return {
          id,
          long,
          short,
          size,
          lastPrice,
          lastSettledAt,
          unsettledToLong: detail[`${id}:pnl`] as bigint | undefined,
          longEquity: longHealth?.[0],
          shortEquity: shortHealth?.[0],
          maintenance,
          canLiquidate: below(longHealth?.[0]) || below(shortHealth?.[0]),
        };
      }),
    [open, detail],
  );

  return { trades, isLoading };
};

/** Every offer that hasn't been taken or cancelled. */
export const useOpenOffers = (system: System) => {
  const { clearinghouse } = useDeployment();
  const { values, isLoading } = useBatchRead(
    ids(system.nextOfferId).map(id => ({
      key: id.toString(),
      contract: clearinghouse,
      functionName: "offers",
      args: [id],
    })),
  );

  const offers: Offer[] = useMemo(
    () =>
      Object.entries(values)
        .map(([id, value]) => {
          const [maker, makerIsLong, size] = value as readonly [Address, boolean, bigint];
          return { id: BigInt(id), maker, makerIsLong, size };
        })
        .filter(offer => offer.size > 0n),
    [values],
  );

  return { offers, isLoading };
};

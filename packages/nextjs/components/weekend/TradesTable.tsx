"use client";

import { Address } from "@scaffold-ui/components";
import { useDeployment } from "~~/components/weekend/DeploymentProvider";
import { Empty, TxButton } from "~~/components/weekend/ui";
import { useScaffoldWriteContract, useTargetNetwork } from "~~/hooks/scaffold-eth";
import type { Trade } from "~~/hooks/weekend/useMarket";
import { fmtToken, fmtUsd } from "~~/utils/weekend/format";

const Margin = ({ equity, maintenance }: { equity?: bigint; maintenance?: bigint }) => {
  const below = equity !== undefined && maintenance !== undefined && equity < maintenance;
  return <span className={below ? "font-semibold text-error" : ""}>{fmtUsd(equity, 0)}</span>;
};

/** All open trades, with the two actions anyone can take: settle and liquidate. */
export const TradesTable = ({ trades, priceIsBad }: { trades: Trade[]; priceIsBad: boolean }) => {
  const { names } = useDeployment();
  const { targetNetwork } = useTargetNetwork();
  const { writeContractAsync } = useScaffoldWriteContract({ contractName: names.Clearinghouse });
  const noPrice = priceIsBad ? "The price feed is stale, so nothing can settle until it updates." : undefined;

  if (trades.length === 0) return <Empty>No open trades on this set of contracts.</Empty>;

  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Trade</th>
            <th>Long</th>
            <th>Short</th>
            <th className="text-right">Size</th>
            <th className="text-right">Last settled at</th>
            <th className="text-right">Long&apos;s unsettled P&amp;L</th>
            <th className="text-right">Long&apos;s margin</th>
            <th className="text-right">Short&apos;s margin</th>
            <th className="text-right">Minimum</th>
            <th>Anyone can</th>
          </tr>
        </thead>
        <tbody>
          {trades.map(trade => (
            <tr key={trade.id.toString()}>
              <td>{trade.id.toString()}</td>
              <td>
                <Address address={trade.long} chain={targetNetwork} size="xs" />
              </td>
              <td>
                <Address address={trade.short} chain={targetNetwork} size="xs" />
              </td>
              <td className="text-right tabular-nums">{fmtToken(trade.size, 4)} BTC</td>
              <td className="text-right tabular-nums">{fmtUsd(trade.lastPrice)}</td>
              <td className="text-right tabular-nums">{fmtUsd(trade.unsettledToLong)}</td>
              <td className="text-right tabular-nums">
                <Margin equity={trade.longEquity} maintenance={trade.maintenance} />
              </td>
              <td className="text-right tabular-nums">
                <Margin equity={trade.shortEquity} maintenance={trade.maintenance} />
              </td>
              <td className="text-right tabular-nums">{fmtUsd(trade.maintenance, 0)}</td>
              <td>
                <div className="flex gap-2">
                  <TxButton
                    label="Settle"
                    size="btn-xs"
                    tone="btn-secondary"
                    blockedBecause={noPrice}
                    action={() => writeContractAsync({ functionName: "settle", args: [trade.id] })}
                  />
                  {trade.canLiquidate && (
                    <TxButton
                      label="Liquidate"
                      size="btn-xs"
                      tone="btn-error"
                      blockedBecause={noPrice}
                      confirmText="This closes the whole trade. You earn the reward."
                      action={() => writeContractAsync({ functionName: "liquidate", args: [trade.id] })}
                    />
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

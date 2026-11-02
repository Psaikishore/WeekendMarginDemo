"use client";

import { useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { useDeployment } from "~~/components/weekend/DeploymentProvider";
import { TradesTable } from "~~/components/weekend/TradesTable";
import { AmountField, ConnectPrompt, Empty, Notice, Page, Panel, Row, TxButton } from "~~/components/weekend/ui";
import { useScaffoldWriteContract, useTargetNetwork } from "~~/hooks/scaffold-eth";
import { useAccountState } from "~~/hooks/weekend/useAccountState";
import { useOpenOffers, useOpenTrades } from "~~/hooks/weekend/useMarket";
import { useSystem } from "~~/hooks/weekend/useSystem";
import { liquidationPrice } from "~~/utils/weekend/economics";
import { fmtBps, fmtToken, fmtUsd, parseAmount, toNumber } from "~~/utils/weekend/format";

const ONE = 10n ** 18n;

const TradePage: NextPage = () => {
  const { address } = useAccount();
  const { names } = useDeployment();
  const { targetNetwork } = useTargetNetwork();
  const system = useSystem();
  const account = useAccountState(address);
  const { trades } = useOpenTrades(system);
  const { offers } = useOpenOffers(system);
  const { writeContractAsync } = useScaffoldWriteContract({ contractName: names.Clearinghouse });

  const [isLong, setIsLong] = useState(false);
  const [sizeText, setSizeText] = useState("1");
  const size = parseAmount(sizeText);

  const { btcPrice, initialMarginBps, maintenanceMarginBps, haircutBps, discountBps, nav } = system;
  const required = (amount?: bigint) =>
    amount !== undefined && btcPrice !== undefined && initialMarginBps !== undefined
      ? (((amount * btcPrice) / ONE) * initialMarginBps) / 10_000n
      : undefined;
  const value = account.collateralValue;

  const estimateLiquidation = (side: boolean, btc: bigint, price: bigint) => {
    if (haircutBps === undefined || maintenanceMarginBps === undefined || nav === undefined) return undefined;
    return liquidationPrice({
      isLong: side,
      size: toNumber(btc),
      usdc: toNumber(account.marginUsdc ?? 0n),
      sbillValue: toNumber(((account.marginSBill ?? 0n) * nav) / ONE),
      price: toNumber(price),
      haircut: Number(haircutBps) / 1e4,
      discount: system.isOpen ? 0 : Number(discountBps ?? 0n) / 1e4,
      maintenance: Number(maintenanceMarginBps) / 1e4,
    });
  };

  const notional = size !== undefined && btcPrice !== undefined ? (size * btcPrice) / ONE : undefined;
  const needed = required(size);
  const previewLiquidation =
    size !== undefined && btcPrice !== undefined && value ? estimateLiquidation(isLong, size, btcPrice) : undefined;
  const myTrade = trades.find(trade => trade.id === account.tradeId);
  const iAmLong = myTrade?.long === address;
  const myGain =
    myTrade?.unsettledToLong === undefined ? undefined : iAmLong ? myTrade.unsettledToLong : -myTrade.unsettledToLong;
  const myLiquidation = myTrade ? estimateLiquidation(iAmLong, myTrade.size, myTrade.lastPrice) : undefined;

  const priceBlock = system.priceProblem ? "The price feed is stale. Try again after the next update." : undefined;
  const offerBlock =
    priceBlock ??
    (system.paused ? "New trades are paused." : undefined) ??
    (account.tradeId ? "You already have an open trade." : undefined) ??
    (account.offerId ? "You already have an open offer." : undefined) ??
    (!size ? "Enter a size." : undefined) ??
    (needed !== undefined && (value ?? 0n) < needed
      ? `You need ${fmtUsd(needed)} of margin and have ${fmtUsd(value ?? 0n)}.`
      : undefined);

  return (
    <Page
      title="Trade"
      intro="Trades here are between two accounts. One posts an offer, another accepts it, and the trade opens at the current Chainlink price. A fund that owns Bitcoin hedges by going short."
    >
      {!address && <ConnectPrompt what="post or accept offers" />}
      {system.priceProblem && (
        <Notice tone="warning">
          The Chainlink price is {system.priceProblem}, so new trades and settlement are waiting.
        </Notice>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Panel
          title="Post an offer"
          subtitle="Your offer waits until another account accepts it. You can cancel it until then."
        >
          <div role="tablist" className="tabs tabs-box mb-4 w-fit">
            {[
              { label: "Go short (hedge)", value: false },
              { label: "Go long", value: true },
            ].map(option => (
              <button
                key={option.label}
                type="button"
                role="tab"
                aria-selected={isLong === option.value}
                className={`tab ${isLong === option.value ? "tab-active" : ""}`}
                onClick={() => setIsLong(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <AmountField label="Size" value={sizeText} onChange={setSizeText} unit="BTC" />
          <div className="my-3">
            <Row label="Value of the position" value={fmtUsd(notional)} />
            <Row label={`Margin needed to open (${fmtBps(initialMarginBps)})`} value={fmtUsd(needed)} />
            <Row label="Your margin value" value={fmtUsd(value)} />
            <Row
              label="Leverage"
              value={notional !== undefined && value ? `${(toNumber(notional) / toNumber(value)).toFixed(2)}x` : "–"}
            />
            <Row
              label="You'd be liquidated around"
              value={
                previewLiquidation
                  ? `$${previewLiquidation.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                  : "–"
              }
            />
          </div>
          <TxButton
            label={`Offer to go ${isLong ? "long" : "short"} ${sizeText || 0} BTC`}
            blockedBecause={offerBlock}
            action={() => writeContractAsync({ functionName: "postOffer", args: [isLong, size] })}
          />
        </Panel>

        <Panel title="Your position">
          {myTrade ? (
            <>
              <Row label="Trade" value={myTrade.id.toString()} />
              <Row label="You are" value={`${iAmLong ? "long" : "short"} ${fmtToken(myTrade.size, 4)} BTC`} />
              <Row label="Last settled at" value={fmtUsd(myTrade.lastPrice)} />
              <Row label="BTC now" value={fmtUsd(btcPrice)} />
              <Row label="Your unsettled P&L" value={fmtUsd(myGain)} />
              <Row label="Your margin, including that" value={fmtUsd(account.equity)} />
              <Row label="Minimum to keep" value={fmtUsd(account.maintenance)} />
              <Row
                label="You'd be liquidated around"
                value={myLiquidation ? `$${myLiquidation.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "–"}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <TxButton
                  label="Settle now"
                  tone="btn-secondary"
                  blockedBecause={priceBlock}
                  action={() => writeContractAsync({ functionName: "settle", args: [myTrade.id] })}
                />
                <TxButton
                  label="Close the trade"
                  tone="btn-secondary"
                  blockedBecause={priceBlock}
                  confirmText="This settles at the current price and ends the trade for both sides."
                  action={() => writeContractAsync({ functionName: "closeTrade", args: [myTrade.id] })}
                />
              </div>
            </>
          ) : (
            <Empty>You don&apos;t have an open trade.</Empty>
          )}
        </Panel>
      </div>

      <Panel
        title="Open offers"
        subtitle="Accepting makes you the other side, at the Chainlink price when your transaction lands."
      >
        {offers.length === 0 ? (
          <Empty>No open offers.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Offer</th>
                  <th>From</th>
                  <th>They want to</th>
                  <th>You would be</th>
                  <th className="text-right">Size</th>
                  <th className="text-right">Margin each side needs</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {offers.map(offer => {
                  const need = required(offer.size);
                  const mine = offer.maker === address;
                  const block =
                    priceBlock ??
                    (system.paused ? "New trades are paused." : undefined) ??
                    (account.tradeId ? "You already have an open trade." : undefined) ??
                    (account.offerId ? "Cancel your own offer first." : undefined) ??
                    (need !== undefined && (value ?? 0n) < need ? `You need ${fmtUsd(need)} of margin.` : undefined);
                  return (
                    <tr key={offer.id.toString()}>
                      <td>{offer.id.toString()}</td>
                      <td>
                        <Address address={offer.maker} chain={targetNetwork} size="xs" />
                      </td>
                      <td>Go {offer.makerIsLong ? "long" : "short"}</td>
                      <td>{offer.makerIsLong ? "Short" : "Long"}</td>
                      <td className="text-right tabular-nums">{fmtToken(offer.size, 4)} BTC</td>
                      <td className="text-right tabular-nums">{fmtUsd(need)}</td>
                      <td>
                        {mine ? (
                          <TxButton
                            label="Cancel"
                            size="btn-xs"
                            tone="btn-secondary"
                            action={() => writeContractAsync({ functionName: "cancelOffer" })}
                          />
                        ) : (
                          <TxButton
                            label="Accept"
                            size="btn-xs"
                            blockedBecause={block}
                            confirmText="This opens the trade at the current price."
                            action={() => writeContractAsync({ functionName: "acceptOffer", args: [offer.id] })}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="All open trades">
        <TradesTable trades={trades} priceIsBad={Boolean(system.priceProblem)} />
      </Panel>
    </Page>
  );
};

export default TradePage;

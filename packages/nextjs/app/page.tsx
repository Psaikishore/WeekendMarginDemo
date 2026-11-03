"use client";

import Link from "next/link";
import type { NextPage } from "next";
import { ActivityFeed } from "~~/components/weekend/ActivityFeed";
import { useDeployment } from "~~/components/weekend/DeploymentProvider";
import { TradesTable } from "~~/components/weekend/TradesTable";
import { Notice, Panel, Stat } from "~~/components/weekend/ui";
import { useOpenTrades } from "~~/hooks/weekend/useMarket";
import { useNow } from "~~/hooks/weekend/useNow";
import { useSystem } from "~~/hooks/weekend/useSystem";
import { fmtBps, fmtDuration, fmtFundingRate, fmtToken, fmtUsd } from "~~/utils/weekend/format";

const Home: NextPage = () => {
  const system = useSystem();
  const now = useNow();
  const { mockFeed } = useDeployment();
  const { trades } = useOpenTrades(system);
  const { isOpen, inventoryCost, btcPrice, priceProblem, priceUpdatedAt, nav, purchasePrice, discountBps } = system;
  const feedName = mockFeed ? "mock BTC price" : "Chainlink price";
  const holdsSBill = (inventoryCost ?? 0n) > 0n;
  const age = priceUpdatedAt ? Math.max(0, now - priceUpdatedAt) : undefined;

  const steps = [
    {
      title: "Market open",
      text: `Funds keep sBILL as margin and earn T-bill interest. It counts at ${fmtBps(10_000n - (system.weekdayHaircutBps ?? 0n))} of its value.`,
    },
    {
      title: "Market closes",
      text: `sBILL can't be redeemed until it reopens, so it counts at ${fmtBps(10_000n - (system.weekendHaircutBps ?? 0n))}. Bitcoin keeps trading.`,
    },
    {
      title: "Bitcoin moves",
      text: `A fund owes money and only holds sBILL. The vault buys it ${fmtBps(discountBps)} below NAV, and the winner is paid at once.`,
    },
    { title: "Market reopens", text: "The vault redeems its sBILL at full NAV and keeps the difference." },
  ];
  const current = isOpen === undefined ? -1 : isOpen ? (holdsSBill ? 3 : 0) : holdsSBill ? 2 : 1;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="text-4xl font-bold tracking-tight">
        Keep your margin in T-bills. Pay what you owe on a Saturday.
      </h1>
      <p className="mt-3 max-w-3xl text-base-content/70">
        Bitcoin trades all weekend, but banks and T-bill markets don&apos;t. So funds that hedge Bitcoin keep piles of
        idle cash, just in case. Here, a fund posts a tokenized T-bill as margin. If it owes money while the market is
        closed, a vault of investors&apos; cash buys its T-bills at a small discount and the winner is paid straight
        away, with no bank and nobody approving anything.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/margin" className="btn btn-primary">
          Post margin
        </Link>
        <Link href="/trade" className="btn btn-secondary">
          Open a hedge
        </Link>
        <Link href="/vault" className="btn btn-secondary">
          Fund the vault
        </Link>
      </div>

      {priceProblem && (
        <div className="mt-6">
          <Notice tone="warning">
            The {feedName} is {priceProblem}. As a safety rule, settlement, liquidation and new trades wait until a
            fresh price arrives. No money can move at a bad price.
            {mockFeed && " On this set, anyone can post a new price from the Controls page."}
          </Notice>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="BTC price"
          value={fmtUsd(btcPrice)}
          hint={`${mockFeed ? "Mock feed" : "Chainlink"}${age === undefined ? "" : `, ${fmtDuration(age)} ago`}`}
        />
        <Stat label="sBILL value (NAV)" value={fmtUsd(nav, 4)} hint={`Grows ${fmtBps(system.apyBps)} a year`} />
        <Stat label="Vault buys at" value={fmtUsd(purchasePrice, 4)} hint={`NAV minus ${fmtBps(discountBps)}`} />
        <Stat
          label="Vault cash"
          value={fmtUsd(system.vaultCash, 0)}
          hint={`${fmtToken(system.vaultSBill)} sBILL held`}
        />
        <Stat label="Funding" value={fmtFundingRate(system.fundingRate)} hint="Positive: longs pay shorts" />
        <Stat
          label="Open trades"
          value={trades.length}
          hint={`Margin needed: ${fmtBps(system.initialMarginBps)} to open`}
        />
      </div>

      <div className="mt-6 flex flex-col gap-6">
        <Panel title="Where this set of contracts is right now">
          <ol className="m-0 grid list-none gap-3 p-0 md:grid-cols-4">
            {steps.map((step, i) => (
              <li
                key={step.title}
                aria-current={i === current ? "step" : undefined}
                className={`rounded-box border p-3 ${i === current ? "border-primary bg-primary/5" : "border-base-300"}`}
              >
                <div className="text-sm font-semibold">
                  {i + 1}. {step.title}
                  {i === current && <span className="badge badge-primary badge-xs ml-2">now</span>}
                </div>
                <p className="m-0 mt-1 text-xs text-base-content/70">{step.text}</p>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel
          title="Open trades"
          subtitle="Anyone can settle a trade, and anyone can liquidate one that's below its minimum."
        >
          <TradesTable trades={trades} priceIsBad={Boolean(priceProblem)} />
        </Panel>
        <Panel title="Recent activity">
          <ActivityFeed />
        </Panel>
      </div>
    </div>
  );
};

export default Home;

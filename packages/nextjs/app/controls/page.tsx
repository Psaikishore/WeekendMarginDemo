"use client";

import { useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { parseUnits } from "viem";
import { useAccount } from "wagmi";
import { useDeployment } from "~~/components/weekend/DeploymentProvider";
import { AmountField, Page, Panel, Row, TxButton } from "~~/components/weekend/ui";
import { useScaffoldWriteContract, useTargetNetwork } from "~~/hooks/scaffold-eth";
import { useNow } from "~~/hooks/weekend/useNow";
import { useSystem } from "~~/hooks/weekend/useSystem";
import { fmtBps, fmtDuration, fmtFundingRate, parseAmount, toNumber } from "~~/utils/weekend/format";
import { MOCK_UPDATE_GAS } from "~~/utils/weekend/gas";

const parseSigned = (text: string, decimals: number) => {
  const trimmed = text.trim();
  // parseUnits reads an empty field as zero, which would post a 0% rate by accident.
  if (trimmed === "" || trimmed === "-") return undefined;
  try {
    return parseUnits(trimmed, decimals);
  } catch {
    return undefined;
  }
};

const ControlsPage: NextPage = () => {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const { names, set, prefix, clearinghouse, vault, sBill, usdc, calendar, mockFeed } = useDeployment();
  const system = useSystem();
  const now = useNow();

  const house = useScaffoldWriteContract({ contractName: names.Clearinghouse });
  const shop = useScaffoldWriteContract({ contractName: names.WeekendVault });
  const clock = useScaffoldWriteContract({ contractName: names.Calendar });
  const feed = useScaffoldWriteContract({ contractName: names.MockFeed });

  const [fundingText, setFundingText] = useState("");
  const [discountText, setDiscountText] = useState("");
  const [priceText, setPriceText] = useState("");

  const isOwner = Boolean(address && system.owner && address.toLowerCase() === system.owner.toLowerCase());
  const ownerOnly = isOwner ? undefined : "Only the owner's wallet can do this.";
  const funding = parseSigned(fundingText, 16); // 1e18 = 100%, so 1e16 = 1%
  const discount = Number(discountText);
  const price = parseAmount(priceText);
  const age = system.priceUpdatedAt ? now - system.priceUpdatedAt : undefined;

  const contracts = [
    { label: "Clearinghouse", info: clearinghouse },
    { label: "Weekend vault", info: vault },
    { label: "sBILL, our token", info: sBill },
    { label: "tUSDC", info: usdc },
    { label: system.isDemoCalendar ? "Calendar (demo switch)" : "Calendar", info: calendar },
    ...(mockFeed ? [{ label: "Mock BTC price", info: mockFeed }] : []),
  ];

  return (
    <Page
      title="Controls"
      intro="Who can change what. A stranger shouldn't have to trust us, so the limits are set in the contracts and shown here."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="What the owner can and can't do">
          <Row
            label="Owner of this set"
            value={system.owner ? <Address address={system.owner} chain={targetNetwork} size="xs" /> : "–"}
          />
          <Row
            label="Post the funding rate"
            value={`Yes, up to ${fmtFundingRate(system.maxFundingRate)}, from now on only`}
          />
          <Row
            label="Change the vault discount"
            value={`Yes, up to ${fmtBps(system.maxDiscountBps)}, only while open`}
          />
          <Row label="Pause new deposits and trades" value="Yes" />
          <Row label="Stop settlement, closing or withdrawals" value="No" />
          <Row label="Move anyone's money" value="No" />
          <Row label="Change margins, haircuts or the price feed" value="No, fixed at deployment" />
          <Row
            label="Decide when it's the weekend"
            value={system.isDemoCalendar ? "Yes, on this labelled set only" : "No, nobody can"}
          />
        </Panel>

        <Panel title="Safety rules, read live">
          <Row label="Margin to open a trade" value={fmtBps(system.initialMarginBps)} />
          <Row label="Liquidated below" value={fmtBps(system.maintenanceMarginBps)} />
          <Row
            label="sBILL haircut, open / closed"
            value={`${fmtBps(system.weekdayHaircutBps)} / ${fmtBps(system.weekendHaircutBps)}`}
          />
          <Row label="Liquidator's reward" value={fmtBps(system.liquidationRewardBps)} />
          <Row
            label="Oldest price accepted"
            value={system.maxPriceAge !== undefined ? fmtDuration(Number(system.maxPriceAge)) : "–"}
          />
          <Row
            label="Latest price"
            value={
              age === undefined ? "–" : `${fmtDuration(Math.max(age, 0))} ago${system.priceProblem ? ", refused" : ""}`
            }
          />
          <Row label="New deposits and trades" value={system.paused ? "Paused" : "Running"} />
        </Panel>

        {system.isDemoCalendar && (
          <Panel
            title="Demo weekend switch"
            subtitle={`This exists only on the ${set.label.toLowerCase()}, so the weekend path can be shown on any day. The main set uses a calendar nobody can change.`}
          >
            <Row label="T-bill market" value={system.isOpen ? "Open" : "Closed"} />
            <div className="mt-3">
              <TxButton
                label={system.isOpen ? "Start the weekend" : "End the weekend"}
                blockedBecause={ownerOnly}
                action={() => clock.writeContractAsync({ functionName: "setWeekend", args: [Boolean(system.isOpen)] })}
              />
            </div>
          </Panel>
        )}

        <Panel
          title="Funding rate"
          subtitle="Positive means longs pay shorts. The keeper posts this from Deribit's rate every 8 hours."
        >
          <Row label="Now" value={fmtFundingRate(system.fundingRate)} />
          <label className="mt-3 flex flex-col gap-1">
            <span className="text-sm font-medium">New rate, % per hour</span>
            <input
              className="input w-full tabular-nums"
              inputMode="decimal"
              placeholder="0.00125"
              value={fundingText}
              onChange={e => setFundingText(e.target.value)}
            />
          </label>
          <div className="mt-2">
            <TxButton
              label="Post the rate"
              blockedBecause={ownerOnly ?? (funding === undefined ? "Enter a rate." : undefined)}
              action={() => house.writeContractAsync({ functionName: "setFundingRate", args: [funding] })}
            />
          </div>
        </Panel>

        <Panel
          title="Vault discount"
          subtitle="The price at which the vault buys sBILL. It can't change during a weekend, so nobody is surprised."
        >
          <Row label="Now" value={`${system.discountBps ?? "–"} basis points`} />
          <label className="mt-3 flex flex-col gap-1">
            <span className="text-sm font-medium">New discount, basis points</span>
            <input
              className="input w-full tabular-nums"
              inputMode="numeric"
              placeholder="30"
              value={discountText}
              onChange={e => setDiscountText(e.target.value)}
            />
          </label>
          <div className="mt-2">
            <TxButton
              label="Set the discount"
              blockedBecause={
                ownerOnly ??
                (system.isOpen === false ? "The market must be open." : undefined) ??
                (!Number.isInteger(discount) || discountText === "" ? "Enter a whole number." : undefined)
              }
              action={() => shop.writeContractAsync({ functionName: "setDiscount", args: [BigInt(discount)] })}
            />
          </div>
        </Panel>

        <Panel
          title="Pause"
          subtitle="Stops new deposits, offers and trades. Everything that gets people their money back keeps working."
        >
          <TxButton
            label={system.paused ? "Resume" : "Pause"}
            tone="btn-secondary"
            blockedBecause={ownerOnly}
            confirmText={system.paused ? undefined : "Nobody will be able to deposit or open trades until you resume."}
            action={() => house.writeContractAsync({ functionName: system.paused ? "unpause" : "pause" })}
          />
        </Panel>

        {mockFeed && (
          <Panel
            title="Mock BTC price"
            subtitle={`The price on this set isn't real, and anyone can move it. ${prefix === "Stress" ? "That's how this set shows a liquidation." : "This is only here because it's a local chain."}`}
          >
            <Row
              label="Now"
              value={system.btcPrice !== undefined ? `$${toNumber(system.btcPrice).toLocaleString("en-US")}` : "–"}
            />
            <div className="mt-3 flex flex-col gap-2">
              <AmountField label="New price" value={priceText} onChange={setPriceText} unit="USD" />
              <TxButton
                label="Move the price"
                blockedBecause={price ? undefined : "Enter a price."}
                action={() =>
                  feed.writeContractAsync({
                    functionName: "updateAnswer",
                    args: [parseUnits(priceText.trim().replace(/,/g, ""), 8)],
                    ...MOCK_UPDATE_GAS,
                  })
                }
              />
            </div>
          </Panel>
        )}

        <Panel
          title="The contracts"
          subtitle="Check the source code of each one on the block explorer before you trust it."
        >
          {contracts.map(({ label, info }) =>
            info ? (
              <Row
                key={label}
                label={label}
                value={
                  <a
                    className="link font-mono text-xs"
                    href={
                      targetNetwork.blockExplorers
                        ? `${targetNetwork.blockExplorers.default.url}/address/${info.address}#code`
                        : `/blockexplorer/address/${info.address}`
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {info.address.slice(0, 8)}…{info.address.slice(-6)}
                  </a>
                }
              />
            ) : null,
          )}
        </Panel>
      </div>
    </Page>
  );
};

export default ControlsPage;

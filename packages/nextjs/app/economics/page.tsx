"use client";

import { useMemo, useState } from "react";
import results from "../../../../config/analysis_results.json";
import assumptions from "../../../../config/assumptions.json";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { useDeployment } from "~~/components/weekend/DeploymentProvider";
import { Notice, Page, Panel, Row, Stat, TxButton } from "~~/components/weekend/ui";
import { useCopyToClipboard, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useSystem } from "~~/hooks/weekend/useSystem";
import {
  discountNeeded,
  fundIncome,
  fundLimits,
  goToMarket,
  requiredDiscount,
  vaultReturn,
} from "~~/utils/weekend/economics";

const { market, vaultInvestor, fund, demoPosition, goToMarket: gtm } = assumptions;
type CaseName = keyof typeof vaultInvestor.cases;

const START = {
  tBillYieldPct: results.tBillYield * 100,
  closureHours: market.closureHours,
  weekendsPerYear: market.weekendsPerYear,
  hurdlePremiumPct: vaultInvestor.hurdlePremium * 100,
  durationYears: vaultInvestor.cases.base.tBillDurationYears,
  yieldShockBp: results.yieldShock.base * 1e4,
  longWeekendsPerYear: vaultInvestor.longWeekendsPerYear,
  longWeekendExtraHours: vaultInvestor.longWeekendExtraHours,
  fundGatesOncePerYears: vaultInvestor.fundGatesOncePerYears,
  gateLossPct: vaultInvestor.gateLoss * 100,
  discountBp: gtm.productDiscountBps,
  usagePct: results.vaultUsage.bothDirections * 100,
  sweep: false,
  hedgeNotional: fund.hedgeNotionalUsd,
  leverage: demoPosition.entryPrice / demoPosition.marginUsd,
  bufferPct: results.closureMove99Up * 100,
  soldPerNotional: results.soldPerNotionalPerYear,
  gtmNotional: gtm.hedgeNotionalUsd,
  protocolSharePct: gtm.protocolShareOfDiscount * 100,
  clearingFeeBp: gtm.clearingFeeBpsPerSide,
  turnsPerYear: gtm.turnsPerYear,
  infrastructure: gtm.runningCostsUsd.infrastructureAndKeepers,
  audits: gtm.runningCostsUsd.securityAudits,
  legal: gtm.runningCostsUsd.legalAndCompliance,
  team: gtm.runningCostsUsd.team,
};
type Inputs = typeof START;
type NumberKey = { [K in keyof Inputs]: Inputs[K] extends number ? K : never }[keyof Inputs];

const pct = (value: number, digits = 2) => `${(value * 100).toFixed(digits)}%`;
const bp = (value: number, digits = 1) => `${(value * 1e4).toFixed(digits)}bp`;
const usd = (value: number) => (Number.isFinite(value) ? `$${Math.round(value).toLocaleString("en-US")}` : "never");
const millions = (value: number) => (Number.isFinite(value) ? `$${(value / 1e6).toFixed(1)}m` : "never");

const NumberInput = ({
  label,
  field,
  inputs,
  set,
  unit,
  step = 1,
}: {
  label: string;
  field: NumberKey;
  inputs: Inputs;
  set: (field: NumberKey, value: number) => void;
  unit: string;
  step?: number;
}) => (
  <label className="flex items-center justify-between gap-3 text-sm">
    <span className="text-base-content/80">{label}</span>
    <span className="flex items-center gap-1">
      <input
        type="number"
        step={step}
        className="input input-sm w-28 text-right tabular-nums"
        value={Number.isInteger(inputs[field]) ? inputs[field] : Number(inputs[field].toFixed(4))}
        onChange={e => set(field, Number(e.target.value))}
      />
      <span className="w-12 text-xs text-base-content/60">{unit}</span>
    </span>
  </label>
);

/** One bar per price, on one scale, so the gap between what each side needs is the thing you see. */
const PriceLine = ({ rows }: { rows: { label: string; value: number; note: string }[] }) => {
  const top = Math.max(...rows.map(row => row.value), 1e-9) * 1.1;
  return (
    <div className="flex flex-col gap-3">
      {rows.map(row => (
        <div key={row.label} className="grid grid-cols-[minmax(7rem,12rem)_1fr_4rem] items-center gap-3 text-sm">
          <span>{row.label}</span>
          <span className="h-3 rounded-sm bg-base-200" title={row.note}>
            <span
              className="block h-3 rounded-sm bg-primary"
              style={{ width: `${Math.max((row.value / top) * 100, 0.5)}%` }}
            />
          </span>
          <span className="text-right font-medium tabular-nums">{bp(row.value, 0)}</span>
        </div>
      ))}
    </div>
  );
};

const EconomicsPage: NextPage = () => {
  const { address } = useAccount();
  const { names } = useDeployment();
  const system = useSystem();
  const shop = useScaffoldWriteContract({ contractName: names.WeekendVault });
  const { copyToClipboard, isCopiedToClipboard } = useCopyToClipboard();

  const [inputs, setInputs] = useState(START);
  const set = (field: NumberKey, value: number) => setInputs(prev => ({ ...prev, [field]: value }));
  const loadCase = (name: CaseName) => {
    const chosen = vaultInvestor.cases[name];
    setInputs(prev => ({
      ...prev,
      hurdlePremiumPct: chosen.hurdlePremium * 100,
      durationYears: chosen.tBillDurationYears,
      yieldShockBp: results.yieldShock[name] * 1e4,
    }));
  };

  const y = inputs.tBillYieldPct / 100;
  const hurdle = y + inputs.hurdlePremiumPct / 100;
  const usage = inputs.usagePct / 100;
  const discount = inputs.discountBp / 1e4;
  const chainDiscount = system.discountBps !== undefined ? Number(system.discountBps) / 1e4 : undefined;

  const model = useMemo(() => {
    const perUse = requiredDiscount({
      tBillYield: y,
      hurdlePremium: inputs.hurdlePremiumPct / 100,
      closureHours: inputs.closureHours,
      tBillDurationYears: inputs.durationYears,
      yieldShock: inputs.yieldShockBp / 1e4,
      longWeekendsPerYear: inputs.longWeekendsPerYear,
      weekendsPerYear: inputs.weekendsPerYear,
      longWeekendExtraHours: inputs.longWeekendExtraHours,
      fundGatesOncePerYears: inputs.fundGatesOncePerYears,
      gateLoss: inputs.gateLossPct / 100,
    });
    const need = (target: number) =>
      discountNeeded(usage, y, target, inputs.closureHours, inputs.weekendsPerYear, inputs.sweep);
    const margin = inputs.hedgeNotional / inputs.leverage;
    const buffer = (inputs.bufferPct / 100) * inputs.hedgeNotional;
    const sold = inputs.soldPerNotional * inputs.hedgeNotional;
    const running = inputs.infrastructure + inputs.audits + inputs.legal + inputs.team;
    const revenue = goToMarket({
      discount,
      protocolShare: inputs.protocolSharePct / 100,
      clearingFeeBpsPerSide: inputs.clearingFeeBp,
      turnsPerYear: inputs.turnsPerYear,
      soldPerNotionalPerYear: inputs.soldPerNotional,
      runningCosts: running,
    });
    return {
      perUse,
      needForTBills: need(y),
      needForHurdle: need(hurdle),
      earns: vaultReturn(discount, usage, y, inputs.closureHours, inputs.weekendsPerYear, inputs.sweep),
      investorEarns: vaultReturn(
        discount * (1 - inputs.protocolSharePct / 100),
        usage,
        y,
        inputs.closureHours,
        inputs.weekendsPerYear,
        inputs.sweep,
      ),
      limits: fundLimits(y, margin, buffer, sold, inputs.closureHours),
      income: fundIncome(y, margin, buffer, sold, discount),
      running,
      revenue,
    };
  }, [inputs, y, hurdle, usage, discount]);

  const fits = model.needForHurdle <= model.limits.againstCashBuffer;

  const exported = useMemo(
    () =>
      JSON.stringify(
        {
          ...assumptions,
          market: { ...market, closureHours: inputs.closureHours, weekendsPerYear: inputs.weekendsPerYear },
          vaultInvestor: {
            ...vaultInvestor,
            hurdlePremium: inputs.hurdlePremiumPct / 100,
            longWeekendsPerYear: inputs.longWeekendsPerYear,
            longWeekendExtraHours: inputs.longWeekendExtraHours,
            fundGatesOncePerYears: inputs.fundGatesOncePerYears,
            gateLoss: inputs.gateLossPct / 100,
          },
          fund: { hedgeNotionalUsd: inputs.hedgeNotional },
          goToMarket: {
            hedgeNotionalUsd: inputs.gtmNotional,
            productDiscountBps: inputs.discountBp,
            protocolShareOfDiscount: inputs.protocolSharePct / 100,
            clearingFeeBpsPerSide: inputs.clearingFeeBp,
            turnsPerYear: inputs.turnsPerYear,
            runningCostsUsd: {
              infrastructureAndKeepers: inputs.infrastructure,
              securityAudits: inputs.audits,
              legalAndCompliance: inputs.legal,
              team: inputs.team,
            },
          },
        },
        null,
        2,
      ),
    [inputs],
  );

  const isOwner = Boolean(address && system.owner && address.toLowerCase() === system.owner.toLowerCase());
  const field = { inputs, set };

  return (
    <Page
      title="Economics"
      intro={
        <>
          What should the vault charge, and could this be a business? Change any number and everything below updates.
          The starting values come from <code>config/assumptions.json</code> and the notebook&apos;s results, using data
          through {results.dataThrough}. Nothing you type here is saved or sent anywhere.
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Discount on-chain"
          value={chainDiscount !== undefined ? bp(chainDiscount, 0) : "–"}
          hint="This set of contracts"
        />
        <Stat label="Risk per use" value={bp(model.perUse.total)} hint="What each purchase must cover" />
        <Stat label="Vault needs" value={bp(model.needForHurdle, 0)} hint={`To earn ${pct(hurdle)} on all its cash`} />
        <Stat
          label="Fund's limit"
          value={bp(model.limits.againstCashBuffer, 0)}
          hint="Above this, holding a cash buffer is cheaper"
        />
      </div>

      <Panel title="Is there a price that works for both sides?">
        <PriceLine
          rows={[
            { label: "Discount on-chain", value: chainDiscount ?? 0, note: "What the contract charges today" },
            { label: "Risk per use", value: model.perUse.total, note: "Carry, T-bill price risk and redemption risk" },
            { label: "Vault needs", value: model.needForHurdle, note: "Including the cash that sits idle" },
            {
              label: "Fund's limit",
              value: model.limits.againstCashBuffer,
              note: "Against holding a cash buffer all year",
            },
          ]}
        />
        <div className="mt-4">
          <Notice tone={fits ? "info" : "warning"}>
            {fits
              ? `Yes. Any discount from ${bp(model.needForHurdle, 0)} to ${bp(model.limits.againstCashBuffer, 0)} pays the vault's investors and still saves the fund money.`
              : `No. The vault needs ${bp(model.needForHurdle, 0)} to earn its target, but the fund stops preferring it at ${bp(model.limits.againstCashBuffer, 0)}. Try a lower target, or let idle cash earn interest during the week.`}
          </Notice>
        </div>
      </Panel>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel
          title="What each purchase must cover"
          subtitle="The vault ties up cash over the closure, and takes on some risk."
        >
          <div className="mb-3 flex flex-wrap gap-2">
            {(Object.keys(vaultInvestor.cases) as CaseName[]).map(name => (
              <button key={name} type="button" className="btn btn-secondary btn-xs" onClick={() => loadCase(name)}>
                Load {name} case
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <NumberInput label="T-bill yield" field="tBillYieldPct" unit="%" step={0.1} {...field} />
            <NumberInput label="Investors want above T-bills" field="hurdlePremiumPct" unit="%" step={0.5} {...field} />
            <NumberInput label="Market closure" field="closureHours" unit="hours" {...field} />
            <NumberInput label="T-bill duration" field="durationYears" unit="years" step={0.05} {...field} />
            <NumberInput label="Weekend yield shock" field="yieldShockBp" unit="bp" {...field} />
            <NumberInput label="Long weekends a year" field="longWeekendsPerYear" unit="" {...field} />
            <NumberInput label="Extra hours on a long weekend" field="longWeekendExtraHours" unit="hours" {...field} />
            <NumberInput
              label="Fund delays redemption once every"
              field="fundGatesOncePerYears"
              unit="years"
              {...field}
            />
            <NumberInput label="Loss if it does" field="gateLossPct" unit="%" step={0.5} {...field} />
          </div>
          <div className="mt-3">
            <Row label="Cost of tying up the cash" value={bp(model.perUse.netCarry)} />
            <Row label="T-bill price risk" value={bp(model.perUse.priceRisk)} />
            <Row label="Redemption risk" value={bp(model.perUse.redemptionRisk)} />
            <Row label="Discount needed per use" value={bp(model.perUse.total)} />
          </div>
        </Panel>

        <Panel
          title="What the vault earns in a year"
          subtitle="The discount is only earned on cash that gets used. The rest waits."
        >
          <div className="flex flex-col gap-2">
            <NumberInput label="Discount" field="discountBp" unit="bp" {...field} />
            <NumberInput label="Share of cash used, on average" field="usagePct" unit="%" {...field} />
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="text-base-content/80">Idle cash earns T-bills during the week</span>
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={inputs.sweep}
                onChange={e => setInputs(prev => ({ ...prev, sweep: e.target.checked }))}
              />
            </label>
          </div>
          <div className="mt-3">
            <Row label="Vault earns" value={pct(model.earns)} />
            <Row label="T-bills pay" value={pct(y)} />
            <Row label="Discount needed to match T-bills" value={bp(model.needForTBills, 0)} />
            <Row label={`Discount needed to earn ${pct(hurdle)}`} value={bp(model.needForHurdle, 0)} />
          </div>
          <div className="mt-4">
            <TxButton
              label={`Post ${inputs.discountBp}bp to this set of contracts`}
              tone="btn-secondary"
              blockedBecause={
                !isOwner
                  ? "Only the owner's wallet can do this."
                  : system.isOpen === false
                    ? "The market must be open."
                    : !Number.isInteger(inputs.discountBp)
                      ? "Use a whole number of basis points."
                      : undefined
              }
              action={() => shop.writeContractAsync({ functionName: "setDiscount", args: [BigInt(inputs.discountBp)] })}
            />
          </div>
        </Panel>

        <Panel
          title="What the fund saves"
          subtitle="A fund hedging Bitcoin, compared with its other ways to stay ready for a weekend margin call."
        >
          <div className="flex flex-col gap-2">
            <NumberInput label="Size of the hedge" field="hedgeNotional" unit="USD" step={100000} {...field} />
            <NumberInput label="Leverage" field="leverage" unit="x" step={0.1} {...field} />
            <NumberInput
              label="Cash buffer it would otherwise hold"
              field="bufferPct"
              unit="% hedge"
              step={0.5}
              {...field}
            />
            <NumberInput
              label="sBILL sold a year, per $1 of hedge"
              field="soldPerNotional"
              unit="USD"
              step={0.1}
              {...field}
            />
          </div>
          <div className="mt-3">
            <Row label="Using the vault" value={`${usd(model.income.withVault)} a year`} />
            <Row label="T-bills, plus a cash buffer" value={`${usd(model.income.withCashBuffer)} a year`} />
            <Row label="All cash" value={`${usd(model.income.allCash)} a year`} />
            <Row label="Fund's limit, against a cash buffer" value={bp(model.limits.againstCashBuffer, 0)} />
            <Row label="Fund's limit, against swapping every Friday" value={bp(model.limits.againstFridaySwap, 0)} />
            <Row label="Fund's limit, against all cash" value={bp(model.limits.againstAllCash, 0)} />
          </div>
        </Panel>

        <Panel
          title="Could it pay for itself?"
          subtitle="The costs and fees here are placeholders for Swastik to replace. They're round numbers that show how the model works, not estimates."
        >
          <div className="flex flex-col gap-2">
            <NumberInput label="Hedges using the product" field="gtmNotional" unit="USD" step={10000000} {...field} />
            <NumberInput label="Protocol's share of the discount" field="protocolSharePct" unit="%" {...field} />
            <NumberInput label="Clearing fee, per side" field="clearingFeeBp" unit="bp" step={0.5} {...field} />
            <NumberInput label="Times a position turns over a year" field="turnsPerYear" unit="" {...field} />
            <NumberInput
              label="Infrastructure and keepers"
              field="infrastructure"
              unit="USD/yr"
              step={1000}
              {...field}
            />
            <NumberInput label="Security audits" field="audits" unit="USD/yr" step={5000} {...field} />
            <NumberInput label="Legal and compliance" field="legal" unit="USD/yr" step={10000} {...field} />
            <NumberInput label="Team" field="team" unit="USD/yr" step={10000} {...field} />
          </div>
          <div className="mt-3">
            <Row label="Running costs" value={`${usd(model.running)} a year`} />
            <Row label="Vault fees per $1m of hedges" value={usd(model.revenue.vaultFees * 1e6)} />
            <Row label="Clearing fees per $1m of hedges" value={usd(model.revenue.clearingFees * 1e6)} />
            <Row label="Hedges needed to break even" value={millions(model.revenue.breakEvenNotional)} />
            <Row
              label={`Revenue at ${millions(inputs.gtmNotional)}`}
              value={usd(model.revenue.perDollar * inputs.gtmNotional)}
            />
            <Row
              label={`Vault cash needed at ${millions(inputs.gtmNotional)}`}
              value={usd(results.vaultCashPerNotional.bothDirections * inputs.gtmNotional)}
            />
            <Row label="Vault investors earn, after the protocol's share" value={pct(model.investorEarns)} />
          </div>
        </Panel>
      </div>

      <Panel
        title="Keep these numbers"
        subtitle="To make them the team's numbers, paste this into config/assumptions.json and run the notebook again. The report's charts and tables all update from there."
      >
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-secondary" onClick={() => copyToClipboard(exported)}>
            {isCopiedToClipboard ? "Copied" : "Copy as JSON"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setInputs(START)}>
            Reset to the saved numbers
          </button>
        </div>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-base-content/70">See the JSON</summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded-box bg-base-200 p-3 text-xs">{exported}</pre>
        </details>
      </Panel>
    </Page>
  );
};

export default EconomicsPage;

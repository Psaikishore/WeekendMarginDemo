"use client";

import { type ReactNode, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { fmtInput } from "~~/utils/weekend/format";

export const Page = ({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) => (
  <div className="mx-auto w-full max-w-6xl px-4 py-8">
    <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
    {intro && <div className="mt-2 max-w-3xl text-base-content/70">{intro}</div>}
    <div className="mt-6 flex flex-col gap-6">{children}</div>
  </div>
);

export const Panel = ({
  title,
  subtitle,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <section className={`rounded-box border border-base-300 bg-base-100 p-5 ${className}`}>
    {title && <h2 className="text-lg font-semibold">{title}</h2>}
    {subtitle && <div className="mb-3 mt-1 text-sm text-base-content/70">{subtitle}</div>}
    {title && !subtitle && <div className="mb-3" />}
    {children}
  </section>
);

export const Stat = ({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) => (
  <div className="rounded-box border border-base-300 bg-base-100 p-4">
    <div className="text-xs font-medium uppercase tracking-wide text-base-content/60">{label}</div>
    <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    {hint && <div className="mt-1 text-xs text-base-content/60">{hint}</div>}
  </div>
);

export const Row = ({ label, value }: { label: ReactNode; value: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 border-b border-base-200 py-1.5 text-sm last:border-0">
    <span className="text-base-content/70">{label}</span>
    <span className="text-right font-medium tabular-nums">{value}</span>
  </div>
);

export const Notice = ({ tone = "info", children }: { tone?: "info" | "warning" | "error"; children: ReactNode }) => {
  const classes = { info: "alert-info", warning: "alert-warning", error: "alert-error" };
  return (
    <div role="status" className={`alert alert-soft ${classes[tone]} text-sm`}>
      <div>{children}</div>
    </div>
  );
};

/**
 * A button that sends a transaction. It says why it can't be used, shows when it is working, and
 * refreshes every number on the page afterwards. Errors are shown by the scaffold's transactor.
 * With `confirmText`, the first click only asks, so an irreversible action takes two clicks.
 */
export const TxButton = ({
  label,
  action,
  onDone,
  blockedBecause,
  confirmText,
  tone = "btn-primary",
  size = "",
}: {
  label: string;
  action: () => Promise<unknown>;
  onDone?: () => void;
  blockedBecause?: string;
  confirmText?: string;
  tone?: string;
  size?: string;
}) => {
  const { isConnected } = useAccount();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const reason = !isConnected ? "Connect a wallet first." : blockedBecause;

  const run = async () => {
    if (confirmText && !asking) {
      setAsking(true);
      return;
    }
    setAsking(false);
    setBusy(true);
    try {
      // The transactor returns nothing, without throwing, when the wallet is on the wrong network.
      const hash = await action();
      if (hash === undefined) return;
      onDone?.();
      await queryClient.invalidateQueries();
    } catch {
      // The transactor has already shown the reason.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        className={`btn ${asking ? "btn-warning" : tone} ${size}`}
        disabled={busy || Boolean(reason)}
        onClick={run}
      >
        {busy && <span className="loading loading-spinner loading-xs" />}
        {busy ? "Working…" : asking ? `Yes, ${label.toLowerCase()}` : label}
      </button>
      {asking && <span className="text-xs text-base-content/70">{confirmText}</span>}
      {reason && !busy && <span className="text-xs text-base-content/60">{reason}</span>}
    </div>
  );
};

export const AmountField = ({
  label,
  value,
  onChange,
  max,
  unit,
  hint,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  max?: bigint;
  unit: string;
  hint?: ReactNode;
}) => (
  <label className="flex flex-col gap-1">
    <span className="text-sm font-medium">{label}</span>
    <div className="join w-full">
      <input
        className="input join-item w-full tabular-nums"
        inputMode="decimal"
        placeholder="0.00"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      {max !== undefined && (
        <button type="button" className="btn join-item" onClick={() => onChange(fmtInput(max))}>
          Max
        </button>
      )}
      <span className="btn btn-disabled join-item no-animation">{unit}</span>
    </div>
    {hint && <span className="text-xs text-base-content/60">{hint}</span>}
  </label>
);

export const ConnectPrompt = ({ what }: { what: string }) => (
  <Panel>
    <div className="flex flex-col items-start gap-3">
      <p className="m-0 text-sm text-base-content/70">Connect a wallet to {what}.</p>
      <RainbowKitCustomConnectButton />
    </div>
  </Panel>
);

export const Empty = ({ children }: { children: ReactNode }) => (
  <p className="m-0 py-4 text-sm text-base-content/60">{children}</p>
);

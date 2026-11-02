"use client";

import { useDeployment } from "~~/components/weekend/DeploymentProvider";
import { useSystem } from "~~/hooks/weekend/useSystem";
import { describeSet } from "~~/utils/weekend/deployments";
import { fmtDuration } from "~~/utils/weekend/format";

/** Says which set of contracts the app is using and whether the market is open, on every page. */
export const DeploymentBar = () => {
  const { prefix, prefixes, choose, set, deployed } = useDeployment();
  const { isOpen, isDemoCalendar, secondsUntilOpen } = useSystem();

  if (!deployed) {
    return (
      <div className="border-b border-base-300 bg-warning/20 px-4 py-2 text-center text-sm">
        The contracts aren&apos;t deployed on this network yet. Run <code>yarn onchain:all</code>, then reload.
      </div>
    );
  }

  return (
    <div className="border-b border-base-300 bg-base-100">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-base-content/70">Contracts</span>
          <select
            className="select select-sm w-40"
            value={prefix}
            onChange={e => choose(e.target.value)}
            aria-label="Choose a set of contracts"
          >
            {prefixes.map(option => (
              <option key={option} value={option}>
                {describeSet(option).label}
              </option>
            ))}
          </select>
        </label>
        <span className={`badge badge-sm ${set.tone}`}>{set.short}</span>
        {isOpen !== undefined && (
          <span className={`badge badge-sm ${isOpen ? "badge-success" : "badge-neutral"}`}>
            {isOpen ? "T-bill market open" : "T-bill market closed"}
            {!isOpen && !isDemoCalendar && secondsUntilOpen !== undefined
              ? `, opens in ${fmtDuration(Number(secondsUntilOpen))}`
              : ""}
          </span>
        )}
        <span className="min-w-60 flex-1 text-xs text-base-content/60">{set.explanation}</span>
      </div>
    </div>
  );
};

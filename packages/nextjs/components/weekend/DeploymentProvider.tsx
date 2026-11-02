"use client";

import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import { contractNames, contractsOn, describeSet, prefixesOn } from "~~/utils/weekend/deployments";

const STORAGE_KEY = "weekend-margin.deployment";

const useDeploymentState = () => {
  const { targetNetwork } = useTargetNetwork();
  const chainId = targetNetwork.id;
  const prefixes = useMemo(() => prefixesOn(chainId), [chainId]);
  const [chosen, setChosen] = useState("Demo");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved !== null) setChosen(saved);
    } catch {
      // Private windows can block storage. The app just starts on the demo set.
    }
  }, []);

  const choose = useCallback((prefix: string) => {
    setChosen(prefix);
    try {
      window.localStorage.setItem(STORAGE_KEY, prefix);
    } catch {
      // As above.
    }
  }, []);

  const prefix = prefixes.includes(chosen) ? chosen : prefixes.includes("Demo") ? "Demo" : (prefixes[0] ?? "");

  return useMemo(() => {
    const contracts = contractsOn(chainId);
    const names = contractNames(prefix);
    return {
      chainId,
      prefix,
      prefixes,
      choose,
      names,
      set: describeSet(prefix),
      deployed: prefixes.length > 0,
      clearinghouse: contracts[names.Clearinghouse],
      vault: contracts[names.WeekendVault],
      sBill: contracts[names.SBill],
      usdc: contracts[names.TestUSDC],
      calendar: contracts[names.Calendar],
      mockFeed: contracts[names.MockFeed],
    };
  }, [chainId, prefix, prefixes, choose]);
};

const DeploymentContext = createContext<ReturnType<typeof useDeploymentState> | null>(null);

export const DeploymentProvider = ({ children }: { children: ReactNode }) => (
  <DeploymentContext.Provider value={useDeploymentState()}>{children}</DeploymentContext.Provider>
);

export const useDeployment = () => {
  const value = useContext(DeploymentContext);
  if (!value) throw new Error("useDeployment must be used inside DeploymentProvider");
  return value;
};

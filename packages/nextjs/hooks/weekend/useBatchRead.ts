import { useMemo } from "react";
import type { Abi, Address } from "viem";
import { hardhat } from "viem/chains";
import { useReadContracts } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";

export type Call = {
  key: string;
  contract?: { address: Address; abi: Abi };
  functionName: string;
  args?: readonly unknown[];
};

/**
 * Reads many values in one request. The scaffold's read hook sends one request per value, which a
 * public RPC rate-limits once a page shows twenty numbers that refresh on every block.
 * A value that reverts (for example a stale price) comes back undefined, with its reason in `errors`.
 */
export const useBatchRead = (calls: Call[]) => {
  const { targetNetwork } = useTargetNetwork();
  const ready = calls.filter(call => call.contract);
  const { data, isLoading } = useReadContracts({
    contracts: ready.map(({ contract, functionName, args }) => ({
      address: contract!.address,
      abi: contract!.abi,
      functionName,
      args,
      chainId: targetNetwork.id,
    })) as never[],
    allowFailure: true,
    query: {
      enabled: ready.length > 0,
      refetchInterval: targetNetwork.id === hardhat.id ? 3_000 : 12_000,
    },
  });

  return useMemo(() => {
    const values: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    (data as { status: string; result?: unknown; error?: Error }[] | undefined)?.forEach((item, i) => {
      if (item.status === "success") values[ready[i].key] = item.result;
      else errors[ready[i].key] = item.error?.message ?? "failed";
    });
    return { values, errors, isLoading };
    // `ready` is rebuilt on each render, but `data` only changes when a new result arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isLoading]);
};

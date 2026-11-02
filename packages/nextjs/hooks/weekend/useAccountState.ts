import { useMemo } from "react";
import { useDeployment } from "~~/components/weekend/DeploymentProvider";
import { useBatchRead } from "~~/hooks/weekend/useBatchRead";

export type AccountState = {
  walletUsdc?: bigint;
  walletSBill?: bigint;
  marginUsdc?: bigint;
  marginSBill?: bigint;
  tradeId?: bigint;
  offerId?: bigint;
  collateralValue?: bigint;
  equity?: bigint;
  maintenance?: bigint;
  initial?: bigint;
  usdcAllowanceClearinghouse?: bigint;
  usdcAllowanceSBill?: bigint;
  usdcAllowanceVault?: bigint;
  sBillAllowanceClearinghouse?: bigint;
  vaultShares?: bigint;
  vaultValue?: bigint;
  vaultMaxWithdraw?: bigint;
  lastFaucetAt?: bigint;
  isLoading: boolean;
};

/** One account's wallet balances, margin, allowances and vault shares. */
export const useAccountState = (address?: string): AccountState => {
  const { clearinghouse, vault, sBill, usdc } = useDeployment();
  const withAddress = <T>(call: T) => (address ? [call] : []);

  const { values, isLoading } = useBatchRead([
    ...withAddress({ key: "walletUsdc", contract: usdc, functionName: "balanceOf", args: [address] }),
    ...withAddress({ key: "walletSBill", contract: sBill, functionName: "balanceOf", args: [address] }),
    ...withAddress({ key: "account", contract: clearinghouse, functionName: "accounts", args: [address] }),
    ...withAddress({
      key: "collateralValue",
      contract: clearinghouse,
      functionName: "collateralValue",
      args: [address],
    }),
    ...withAddress({ key: "health", contract: clearinghouse, functionName: "accountHealth", args: [address] }),
    ...withAddress({
      key: "usdcAllowanceClearinghouse",
      contract: usdc,
      functionName: "allowance",
      args: [address, clearinghouse?.address],
    }),
    ...withAddress({
      key: "usdcAllowanceSBill",
      contract: usdc,
      functionName: "allowance",
      args: [address, sBill?.address],
    }),
    ...withAddress({
      key: "usdcAllowanceVault",
      contract: usdc,
      functionName: "allowance",
      args: [address, vault?.address],
    }),
    ...withAddress({
      key: "sBillAllowanceClearinghouse",
      contract: sBill,
      functionName: "allowance",
      args: [address, clearinghouse?.address],
    }),
    ...withAddress({ key: "vaultShares", contract: vault, functionName: "balanceOf", args: [address] }),
    ...withAddress({ key: "vaultMaxWithdraw", contract: vault, functionName: "maxWithdraw", args: [address] }),
    ...withAddress({ key: "lastFaucetAt", contract: usdc, functionName: "lastFaucetAt", args: [address] }),
  ]);

  const shares = values.vaultShares as bigint | undefined;
  const { values: valueOfShares } = useBatchRead(
    shares !== undefined ? [{ key: "vaultValue", contract: vault, functionName: "previewRedeem", args: [shares] }] : [],
  );

  return useMemo(() => {
    const account = values.account as readonly [bigint, bigint, bigint, bigint] | undefined;
    const health = values.health as readonly [bigint, bigint, bigint] | undefined;
    return {
      ...(values as Pick<
        AccountState,
        | "walletUsdc"
        | "walletSBill"
        | "collateralValue"
        | "usdcAllowanceClearinghouse"
        | "usdcAllowanceSBill"
        | "usdcAllowanceVault"
        | "sBillAllowanceClearinghouse"
        | "vaultShares"
        | "vaultMaxWithdraw"
        | "lastFaucetAt"
      >),
      vaultValue: valueOfShares.vaultValue as bigint | undefined,
      marginUsdc: account?.[0],
      marginSBill: account?.[1],
      tradeId: account?.[2],
      offerId: account?.[3],
      equity: health?.[0],
      maintenance: health?.[1],
      initial: health?.[2],
      isLoading,
    };
  }, [values, valueOfShares, isLoading]);
};

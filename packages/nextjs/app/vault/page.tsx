"use client";

import { useState } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { useDeployment } from "~~/components/weekend/DeploymentProvider";
import { AmountField, ConnectPrompt, Page, Panel, Row, Stat, TxButton } from "~~/components/weekend/ui";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useAccountState } from "~~/hooks/weekend/useAccountState";
import { useSystem } from "~~/hooks/weekend/useSystem";
import { fmtBps, fmtToken, fmtUsd, parseAmount, toNumber } from "~~/utils/weekend/format";

const VaultPage: NextPage = () => {
  const { address } = useAccount();
  const { names, vault } = useDeployment();
  const system = useSystem();
  const account = useAccountState(address);
  const usdc = useScaffoldWriteContract({ contractName: names.TestUSDC });
  const shop = useScaffoldWriteContract({ contractName: names.WeekendVault });

  const [depositText, setDepositText] = useState("");
  const [withdrawText, setWithdrawText] = useState("");
  const deposit = parseAmount(depositText);
  const withdraw = parseAmount(withdrawText);

  const { vaultAssets, vaultShares, vaultCash, inventoryCost, vaultSBill, nav } = system;
  const sharePrice = vaultAssets && vaultShares ? toNumber(vaultAssets) / toNumber(vaultShares) : undefined;
  const inUse =
    vaultAssets && inventoryCost !== undefined ? toNumber(inventoryCost) / toNumber(vaultAssets) : undefined;
  const pending =
    vaultSBill !== undefined && nav !== undefined && inventoryCost !== undefined
      ? (vaultSBill * nav) / 10n ** 18n - inventoryCost
      : undefined;

  return (
    <Page
      title="Weekend vault"
      intro="A pool of investors' cash. While the T-bill market is closed it buys sBILL from anyone who has to pay, at a small discount. When the market reopens it redeems the sBILL at full value and keeps the difference."
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Cash ready" value={fmtUsd(vaultCash, 0)} hint="What it can pay out or spend now" />
        <Stat
          label="sBILL waiting"
          value={fmtToken(vaultSBill)}
          hint={`Paid ${fmtUsd(inventoryCost, 0)}${inUse !== undefined ? `, ${(inUse * 100).toFixed(1)}% of the vault` : ""}`}
        />
        <Stat
          label="Value of one vault share"
          value={sharePrice ? `$${sharePrice.toFixed(6)}` : "–"}
          hint="Only rises when a profit is actually realised"
        />
        <Stat
          label="Discount"
          value={fmtBps(system.discountBps)}
          hint={`Buys at ${fmtUsd(system.purchasePrice, 4)}. Limit ${fmtBps(system.maxDiscountBps)}`}
        />
      </div>

      {!address && <ConnectPrompt what="deposit into the vault" />}

      <div className="grid gap-6 md:grid-cols-2">
        <Panel
          title="Deposit"
          subtitle="You get vault shares (wvUSDC). Your return depends on how much sBILL the vault gets to buy."
        >
          <div className="flex flex-col gap-2">
            <AmountField
              label="Amount"
              value={depositText}
              onChange={setDepositText}
              max={account.walletUsdc}
              unit="tUSDC"
            />
            {deposit && (account.usdcAllowanceVault ?? 0n) < deposit ? (
              <TxButton
                label="Step 1: let the vault take your tUSDC"
                action={() => usdc.writeContractAsync({ functionName: "approve", args: [vault?.address, deposit] })}
              />
            ) : (
              <TxButton
                label="Deposit"
                blockedBecause={deposit ? undefined : "Enter an amount."}
                action={() => shop.writeContractAsync({ functionName: "deposit", args: [deposit, address] })}
                onDone={() => setDepositText("")}
              />
            )}
          </div>
        </Panel>

        <Panel
          title="Withdraw"
          subtitle="You can only take out cash the vault holds. Money tied up in sBILL comes back when the vault redeems it."
        >
          <div className="flex flex-col gap-2">
            <AmountField
              label="Amount"
              value={withdrawText}
              onChange={setWithdrawText}
              max={account.vaultMaxWithdraw}
              unit="tUSDC"
              hint={`Your share is worth ${fmtUsd(account.vaultValue)}. You can take out ${fmtUsd(account.vaultMaxWithdraw)} now.`}
            />
            <TxButton
              label="Withdraw"
              tone="btn-secondary"
              blockedBecause={
                !withdraw
                  ? "Enter an amount."
                  : withdraw > (account.vaultMaxWithdraw ?? 0n)
                    ? "That's more than you can take out right now."
                    : undefined
              }
              action={() => shop.writeContractAsync({ functionName: "withdraw", args: [withdraw, address, address] })}
              onDone={() => setWithdrawText("")}
            />
          </div>
        </Panel>

        <Panel
          title="Redeem the vault's sBILL"
          subtitle="Anyone can press this once the market is open, and it pays everything back into the vault. The keeper script also does it."
        >
          <Row label="sBILL to redeem" value={fmtToken(vaultSBill)} />
          <Row label="Profit waiting to be realised" value={fmtUsd(pending)} />
          <div className="mt-3">
            <TxButton
              label="Redeem now"
              blockedBecause={
                (vaultSBill ?? 0n) === 0n
                  ? "The vault holds no sBILL."
                  : system.isOpen === false
                    ? "The fund is closed until the market reopens."
                    : undefined
              }
              action={() => shop.writeContractAsync({ functionName: "redeemInventory" })}
            />
          </div>
        </Panel>

        <Panel title="The risks of being a vault investor">
          <ul className="m-0 list-disc space-y-1 pl-5 text-sm text-base-content/80">
            <li>Your cash can be tied up in sBILL until the market reopens.</li>
            <li>
              Most of the time the cash sits idle. Our analysis finds a vault at a 0.1% discount earns less than
              T-bills, which the Economics page explains.
            </li>
            <li>A real T-bill fund could delay redemption or fall in price. sBILL here is a mock and can&apos;t.</li>
          </ul>
        </Panel>
      </div>
    </Page>
  );
};

export default VaultPage;

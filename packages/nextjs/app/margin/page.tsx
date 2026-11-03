"use client";

import { useState } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { useDeployment } from "~~/components/weekend/DeploymentProvider";
import { AmountField, ConnectPrompt, Page, Panel, Row, Stat, TxButton } from "~~/components/weekend/ui";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useAccountState } from "~~/hooks/weekend/useAccountState";
import { useNow } from "~~/hooks/weekend/useNow";
import { useSystem } from "~~/hooks/weekend/useSystem";
import { fmtBps, fmtDuration, fmtToken, fmtUsd, parseAmount } from "~~/utils/weekend/format";
import { WITHDRAW_GAS } from "~~/utils/weekend/gas";

const FAUCET_COOLDOWN_SECONDS = 3600;

const MarginPage: NextPage = () => {
  const { address } = useAccount();
  const { names, clearinghouse, sBill } = useDeployment();
  const system = useSystem();
  const account = useAccountState(address);
  const now = useNow();

  const usdc = useScaffoldWriteContract({ contractName: names.TestUSDC });
  const bill = useScaffoldWriteContract({ contractName: names.SBill });
  const house = useScaffoldWriteContract({ contractName: names.Clearinghouse });

  const [buyText, setBuyText] = useState("");
  const [redeemText, setRedeemText] = useState("");
  const [depositText, setDepositText] = useState("");
  const [withdrawText, setWithdrawText] = useState("");
  const [token, setToken] = useState<"sBILL" | "tUSDC">("sBILL");

  const buy = parseAmount(buyText);
  const redeem = parseAmount(redeemText);
  const deposit = parseAmount(depositText);
  const withdraw = parseAmount(withdrawText);

  const closed = system.isOpen === false ? "The T-bill market is closed until it reopens." : undefined;
  const paused = system.paused ? "New deposits are paused." : undefined;
  const usingSBill = token === "sBILL";
  const walletBalance = usingSBill ? account.walletSBill : account.walletUsdc;
  const marginBalance = usingSBill ? account.marginSBill : account.marginUsdc;
  const allowance = usingSBill ? account.sBillAllowanceClearinghouse : account.usdcAllowanceClearinghouse;
  const nextFaucet = Number(account.lastFaucetAt ?? 0n) + FAUCET_COOLDOWN_SECONDS - now;
  const sBillValue =
    account.marginSBill !== undefined && system.nav !== undefined
      ? (account.marginSBill * system.nav) / 10n ** 18n
      : undefined;

  return (
    <Page
      title="Margin"
      intro="Get test dollars, turn them into sBILL if you want your margin to earn interest, and post either one to your margin account."
    >
      {!address && <ConnectPrompt what="see your balances and post margin" />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Wallet tUSDC" value={fmtToken(account.walletUsdc)} />
        <Stat label="Wallet sBILL" value={fmtToken(account.walletSBill)} hint={`Worth ${fmtUsd(system.nav, 4)} each`} />
        <Stat
          label="Margin value"
          value={fmtUsd(account.collateralValue)}
          hint={`sBILL counts at ${fmtBps(10_000n - (system.haircutBps ?? 0n))} right now`}
        />
        <Stat
          label="Minimum to keep"
          value={fmtUsd(account.maintenance)}
          hint={account.tradeId ? `For trade ${account.tradeId}` : "No open trade"}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="1. Get test dollars" subtitle="tUSDC has no value. You can draw 100,000 once an hour.">
          <TxButton
            label="Get 100,000 tUSDC"
            blockedBecause={nextFaucet > 0 ? `Available again in ${fmtDuration(nextFaucet)}.` : undefined}
            action={() => usdc.writeContractAsync({ functionName: "faucet" })}
          />
        </Panel>

        <Panel
          title="2. Buy or redeem sBILL"
          subtitle={`sBILL is a mock T-bill fund share that grows ${fmtBps(system.apyBps)} a year. The fund only deals while the market is open.`}
        >
          <div className="grid gap-4">
            <div className="flex flex-col gap-2">
              <AmountField
                label="Buy with"
                value={buyText}
                onChange={setBuyText}
                max={account.walletUsdc}
                unit="tUSDC"
                hint={
                  buy && system.nav ? `You get about ${fmtToken((buy * 10n ** 18n) / system.nav)} sBILL.` : undefined
                }
              />
              {buy && (account.usdcAllowanceSBill ?? 0n) < buy ? (
                <TxButton
                  label="Step 1: let the fund take your tUSDC"
                  blockedBecause={closed}
                  action={() => usdc.writeContractAsync({ functionName: "approve", args: [sBill?.address, buy] })}
                />
              ) : (
                <TxButton
                  label="Buy sBILL"
                  blockedBecause={closed ?? (buy ? undefined : "Enter an amount.")}
                  action={() => bill.writeContractAsync({ functionName: "subscribe", args: [buy] })}
                  onDone={() => setBuyText("")}
                />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <AmountField
                label="Redeem"
                value={redeemText}
                onChange={setRedeemText}
                max={account.walletSBill}
                unit="sBILL"
                hint={redeem && system.nav ? `You get about ${fmtUsd((redeem * system.nav) / 10n ** 18n)}.` : undefined}
              />
              <TxButton
                label="Redeem sBILL"
                tone="btn-secondary"
                blockedBecause={closed ?? (redeem ? undefined : "Enter an amount.")}
                action={() => bill.writeContractAsync({ functionName: "redeem", args: [redeem] })}
                onDone={() => setRedeemText("")}
              />
            </div>
          </div>
        </Panel>

        <Panel
          title="3. Post or take out margin"
          subtitle="Margin backs your trade. You can post either token, or both."
        >
          <div role="tablist" className="tabs tabs-box mb-4 w-fit">
            {(["sBILL", "tUSDC"] as const).map(option => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={token === option}
                className={`tab ${token === option ? "tab-active" : ""}`}
                onClick={() => setToken(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="grid gap-4">
            <div className="flex flex-col gap-2">
              <AmountField
                label="Post"
                value={depositText}
                onChange={setDepositText}
                max={walletBalance}
                unit={token}
              />
              {deposit && (allowance ?? 0n) < deposit ? (
                <TxButton
                  label={`Step 1: let the clearinghouse take your ${token}`}
                  action={() =>
                    (usingSBill ? bill : usdc).writeContractAsync({
                      functionName: "approve",
                      args: [clearinghouse?.address, deposit],
                    })
                  }
                />
              ) : (
                <TxButton
                  label={`Post ${token}`}
                  blockedBecause={paused ?? (deposit ? undefined : "Enter an amount.")}
                  action={() =>
                    house.writeContractAsync({
                      functionName: usingSBill ? "depositSBill" : "depositUsdc",
                      args: [deposit],
                    })
                  }
                  onDone={() => setDepositText("")}
                />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <AmountField
                label="Take out"
                value={withdrawText}
                onChange={setWithdrawText}
                max={marginBalance}
                unit={token}
                hint={
                  account.tradeId
                    ? "You have an open trade. It settles first, and you must keep the margin needed to open it."
                    : undefined
                }
              />
              <TxButton
                label={`Take out ${token}`}
                tone="btn-secondary"
                blockedBecause={withdraw ? undefined : "Enter an amount."}
                action={() =>
                  house.writeContractAsync({
                    functionName: usingSBill ? "withdrawSBill" : "withdrawUsdc",
                    args: [withdraw],
                    ...WITHDRAW_GAS,
                  })
                }
                onDone={() => setWithdrawText("")}
              />
            </div>
          </div>
        </Panel>

        <Panel title="Your margin account">
          <Row label="tUSDC posted" value={fmtToken(account.marginUsdc)} />
          <Row label="sBILL posted" value={fmtToken(account.marginSBill)} />
          <Row label="sBILL at full value" value={fmtUsd(sBillValue)} />
          <Row
            label={`Haircut on sBILL (${system.isOpen ? "market open" : "market closed"})`}
            value={fmtBps(system.haircutBps)}
          />
          <Row label="Margin value" value={fmtUsd(account.collateralValue)} />
          <Row label="Including unsettled gains and losses" value={fmtUsd(account.equity)} />
          <p className="mb-0 mt-3 text-xs text-base-content/60">
            If you owe money and run out of tUSDC, your sBILL is sold automatically: through the fund at full value when
            the market is open, or to the vault at {fmtBps(system.discountBps)} below value when it&apos;s closed.
          </p>
        </Panel>
      </div>
    </Page>
  );
};

export default MarginPage;

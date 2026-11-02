# How the system works

This is the technical explanation in plain English. It covers everything: every contract, every formula, every script, and what happens when something goes wrong. You don't need to know Solidity to follow it.

- For the idea and why it matters, read [VISION.md](VISION.md) first.
- For status and to-do lists, see [CLAUDE.md](CLAUDE.md).
- If this document ever disagrees with the code, the code wins.

**Contents**

1. [The whole system on one page](#1-the-whole-system-on-one-page)
2. [Blockchain basics you need](#2-blockchain-basics-you-need)
3. [The contracts, one by one](#3-the-contracts-one-by-one)
4. [One full weekend, step by step](#4-one-full-weekend-step-by-step)
5. [The maths](#5-the-maths)
6. [Who controls what](#6-who-controls-what)
7. [What happens when things go wrong](#7-what-happens-when-things-go-wrong)
8. [The parts that aren't on the blockchain](#8-the-parts-that-arent-on-the-blockchain)
9. [The website](#9-the-website)
10. [The analysis, and what you can change](#10-the-analysis-and-what-you-can-change)
11. [How we know it works](#11-how-we-know-it-works)
12. [What is real and what is pretend](#12-what-is-real-and-what-is-pretend)
13. [Questions the professor might ask](#13-questions-the-professor-might-ask)
14. [Where everything lives](#14-where-everything-lives)

---

## 1. The whole system on one page

```text
                       BTC price
                   Chainlink feed
                         │
                         ▼
  Fund  ── sBILL ──►  CLEARINGHOUSE  ◄── tUSDC ──  Trader
  (short)             holds deposits               (long)
                      opens trades
                      moves money from loser to winner
                         │         │
          market open:   │         │   market closed:
          redeem at      │         │   sell at a discount
          full value     │         │
                         ▼         ▼
                       SBILL ◄── WEEKEND VAULT ◄── investors' tUSDC
                 the T-bill fund    buys sBILL when the market is shut,
                                    redeems it when the market reopens

        CALENDAR tells all of them whether the T-bill market is open.
        KEEPER is a robot script that regularly says "settle now".
```

In six sentences:

1. A fund puts **sBILL** (a tokenized T-bill that earns interest) into the **clearinghouse** as its deposit.
2. It opens a trade against someone else: it bets Bitcoin goes down, which cancels out the Bitcoin it already owns.
3. Whenever anyone asks, the clearinghouse reads the Bitcoin price from **Chainlink** and moves money from the side that lost to the side that won.
4. The winner must be paid in dollars (**tUSDC**). If the loser has run out of dollars, the clearinghouse sells some of the loser's sBILL to raise them.
5. When the T-bill market is open, it sells to the T-bill fund at full value. When it's closed, it sells to the **vault** at a small discount.
6. When the market reopens, the vault cashes in its sBILL at full value and keeps the difference.

That last pair of steps is the whole invention. Everything else is the normal machinery of a futures exchange.

---

## 2. Blockchain basics you need

**A smart contract** is a program that lives on the blockchain, with its own address and its own storage. Once deployed, its code can't be changed. Everyone can read it, and it does exactly what the code says, with no person involved.

**A read vs a transaction.** Reading a value is free and instant. Changing anything needs a transaction: a signed instruction from a wallet that costs gas and takes about 12 seconds on Sepolia.

**Gas** is the fee for a transaction, based on how much work it makes the network do. Storing a brand new value is the most expensive thing a contract can do, at about 22,100 gas per 32-byte slot. That's why [our gas change](docs/gas.md) was about storing less.

**A wallet** holds a private key, which is what signs transactions. Our deployer key is encrypted in `packages/hardhat/.env`, which is never committed. The password decrypts it when a script needs it.

**Sepolia** is Ethereum's test network. It works the same way as the real one, but the ETH is free and worthless.

**An event** is a note a contract writes into the transaction's record. Contracts can't read their own events, but websites and our notebook can. `Settled` and `SBillPurchased` are events, and they're the evidence that things happened.

**Revert** means a transaction failed and everything it did is undone, as though it never happened. It's all-or-nothing. When our contract says `revert InsufficientMargin`, no money moves and no state changes. The sender still pays a little gas.

**No decimals.** Contracts only do whole-number maths. So "1 tUSDC" is stored as `1,000,000,000,000,000,000` (1 followed by 18 zeros), and every amount in our system uses this 18-decimal scale. Division always rounds, so we choose which way it rounds (see [Rounding](#rounding-who-gets-the-last-fraction-of-a-cent)).

**Approve, then act.** A contract can't take your tokens without permission. So depositing is two transactions: first `approve` (you may take this much), then the deposit itself. This is why the website sometimes shows "Step 1" before the real button.

**`block.timestamp`** is the time of the current block, in seconds since 1970. It's the only clock a contract has. Validators can nudge it by a few seconds, which doesn't matter for us.

**A basis point (bp)** is 0.01%. So 10bp is 0.1%, and the "$0.999 on the dollar" price is a 10bp discount.

---

## 3. The contracts, one by one

There are six. All are in `packages/hardhat/contracts/`, and they use OpenZeppelin's audited building blocks for tokens, ownership and safety.

### TestUSDC: pretend dollars

The tUSDC token. It has a faucet, so anyone can get 100,000 once an hour. Real USDC has 6 decimals; ours has 18, so every amount in the system is on the same scale and there's less chance of a conversion mistake.

### SBill: our token, the pretend T-bill fund

**This is the token the brief requires us to mint.** It's an ERC-20 called sBILL.

- `nav()`, which means "net asset value", is what one sBILL is worth. It starts at $1.00 and grows in a straight line at 4% a year: `1 + 4% × seconds since deployment / seconds in a year`. After one day it's $1.00011.
- `subscribe(tUSDC)` buys sBILL at NAV. `redeem(sBILL)` sells it back at NAV. **Both revert if the market is closed.** That's the problem we're solving.
- The fund starts with 1,000,000 tUSDC in reserve to pay the interest, because there's no real T-bill behind it.

Nobody posts the NAV. A real fund's NAV would be published daily and could fall. We chose a fixed rate so that no trusted person is needed, and we state the cost of that choice: sBILL can't show T-bill price risk on-chain.

### MarketCalendar: is the market open?

Answers one question, using only the clock. The market is closed from **Friday 21:00 to Monday 14:00 UTC**. That's 4pm to 9am New York time in winter, which is 65 hours, the same closure the analysis uses.

```text
seconds into the week = (block.timestamp + 4 days) mod 7 days     (Sunday 00:00 is zero)
closed if that is before Monday 14:00, or after Friday 21:00
```

The "+ 4 days" is because 1 January 1970, where the clock starts, was a Thursday. The contract has no owner and no settings, so **nobody can change when the weekend happens**. It doesn't know about holidays or daylight saving, and we state that as a limit.

### DemoCalendar: the labelled switch

Does the same job with one owner-only switch, `setWeekend(true/false)`. It exists so we can show the weekend path on a Tuesday. It's used only by the sets labelled Demo and Stress, and it answers `isDemo() = true`, so nobody can mistake it for the real one. The report must say that the deployer holds this switch.

### WeekendVault: the weekend shop

An ERC-4626 vault, which is the standard for "deposit a token, get shares". You deposit tUSDC and get wvUSDC shares.

- **It buys sBILL only when the market is closed, and only from the clearinghouse.** Both rules are enforced in `buySBill`.
- **The price** is `NAV × (1 - discount)`, so $0.999 at 10bp.
- **It redeems on business days.** `redeemInventory()` sends all its sBILL to the fund. Anyone can call it.
- **Withdrawals are capped at its cash.** Money tied up in sBILL can't be withdrawn until redeemed, so one investor can't drain cash that's needed.
- **sBILL is valued at what the vault paid, not what it's worth.** Details are in [the vault's share price](#the-vaults-share-price).

The discount can be changed by the owner, up to a hard limit of 1% set at deployment, and only while the market is open. That means a fund holding sBILL into a weekend already knows the price it could be sold at.

### Clearinghouse: the referee

This is the main contract. It holds everyone's deposits and keeps the books.

| Function | What it does | Who can call it |
|---|---|---|
| `depositUsdc`, `depositSBill` | Put margin in | Anyone, unless paused |
| `withdrawUsdc`, `withdrawSBill` | Take margin out, after settling, keeping initial margin if a trade is open | The account's owner, even when paused |
| `postOffer` | "I'll go long/short this many BTC" | Anyone with enough margin, unless paused |
| `cancelOffer` | Cancel your own offer | The offer's maker |
| `acceptOffer` | Take the other side. The trade opens at the current price | Anyone else with enough margin, unless paused |
| `settle` | Pay the price change and funding since last time | **Anyone** |
| `closeTrade` | Settle, then end the trade | Either side |
| `liquidate` | Settle, then close a trade whose margin is too low, and earn the reward | **Anyone** |
| `setFundingRate`, `pause`, `unpause` | Admin | Owner only |

**Trades are bilateral.** Each trade has exactly one long and one short. There's no shared pool and no order book, so one person's loss is never spread over other users. The cost is that if one side is liquidated or closes, the other side's trade ends too.

**One account, one trade.** An account can hold one open trade and one open offer at a time. This keeps the books simple.

---

## 4. One full weekend, step by step

These are real formulas with round numbers. NAV is taken as $1.00 to keep the arithmetic easy.

### Friday, before the market closes

1. An investor deposits 50,000 tUSDC into the vault and gets 50,000 wvUSDC shares.
2. Fund A buys 30,000 sBILL from the fund with 30,000 tUSDC, then deposits the sBILL into the clearinghouse. Its margin value is `30,000 × 99% = $29,700`.
3. Trader B deposits 30,000 tUSDC into the clearinghouse.
4. Fund A posts an offer to go short 1 BTC. Trader B accepts it. Chainlink says $80,000, so the trade opens there. Position value is $80,000, so the initial margin needed is 20%, or $16,000. Both have enough. Leverage is `80,000 / 30,000 = 2.67x`.

### Saturday: the market is closed and Bitcoin rises 1.5%

Fund A's sBILL now only counts at 97%, so its margin value is $29,100. Chainlink now says $81,200.

Someone calls `settle(1)`. The keeper normally does this, but anyone can. Inside that one transaction:

1. **Read the price:** $81,200, after checking it isn't stale.
2. **Work out the amount:** `1 BTC × ($81,200 - $80,000) = $1,200`. The long gained, so the short owes it. (Funding would be added here. It's zero in this example.)
3. **Collect from Fund A:** it has no tUSDC, so the $1,200 shortfall must come from selling sBILL.
4. **Check the calendar:** closed, so go to the vault.
5. **Vault's price:** `$1.00 × (1 - 0.10%) = $0.999`.
6. **sBILL sold:** `$1,200 / $0.999 = 1,201.2012`, rounded up.
7. **The swap:** the vault takes 1,201.2012 sBILL from the clearinghouse and gives it $1,200 tUSDC.
8. **Pay the winner:** Trader B's account goes up by $1,200.
9. **Update the trade:** the last price is now $81,200, so the next settlement only pays the next change.

Trader B got paid on a Saturday, and could withdraw that money right now.

### Monday, after the market reopens

Anyone calls `redeemInventory()`. The vault hands its 1,201.2012 sBILL to the fund and gets back full NAV. NAV has also grown while the vault held the sBILL, so over a real 65-hour closure it would be $1.0003 and the vault would receive about $1,201.56.

The vault paid $1,200, so its profit is **$1.56**: $1.20 from the discount and $0.36 from interest. In the demo, the "weekend" lasts minutes, so the profit is about $1.20.

### The balances at each step

| | Fund A's margin | Trader B's margin | Vault cash | Vault's sBILL |
|---|---|---|---|---|
| Friday | 30,000 sBILL | 30,000 tUSDC | 50,000 | 0 |
| Saturday, after settling | 28,798.80 sBILL | 31,200 tUSDC | 48,800 | 1,201.20 |
| Monday, after redeeming | 28,798.80 sBILL | 31,200 tUSDC | about 50,001.56 | 0 |

**What did the fund pay for this?** $1.20, once. In exchange, it earned T-bill interest on all $30,000 all year instead of holding idle cash.

### Why the demo has two trades

With a single trade, if Bitcoin moved the wrong way the fund would *win*, nothing would need selling, and the vault would do nothing on camera. So the demo has two mirrored trades: Fund A short against Trader B, and Fund C long against Trader D. Both funds hold only sBILL, so whichever way Bitcoin moves, one fund has to pay through the vault.

---

## 5. The maths

### Margin value and the haircut

```text
margin value = tUSDC + (sBILL × NAV) × (1 - haircut)
```

The haircut is 1% on weekdays and 3% when the market is closed. It's a safety cushion: sBILL might be sold at a discount, so we count it as worth a bit less than it is. **The weekend haircut must be at least as big as the vault's largest possible discount**, and the contract refuses to deploy otherwise. So a forced sale can never surprise the system.

### The two margin levels

```text
position value     = BTC size × price
initial margin     = 20% of position value     needed to open a trade or to withdraw
maintenance margin = 10% of position value     below this you can be liquidated
```

The gap between them is the cushion. You need 20% to get in, and you're only forced out at 10%.

### What one settlement pays

```text
price gain for the long = size × (price now - price at last settlement)
funding paid by long    = position value × (funding total now - funding total at last settlement)
long's gain             = price gain - funding paid
```

If the long's gain is positive, the short pays that much to the long. If it's negative, the long pays the short.

### Where the money comes from

```text
Does the loser have enough tUSDC?
├── Yes → take it.
└── No  → take all its tUSDC, then raise the rest by selling sBILL:
          Is the market open?
          ├── Yes → redeem with the fund, at full NAV.
          └── No  → sell to the vault, at NAV minus the discount.
                    Does the vault have enough cash?
                    ├── Yes → done.
                    └── No  → the whole transaction reverts. Nothing happens.

If the loser's sBILL runs out too, the winner gets what was collected, and the shortfall is lost.
```

The `Settled` event records both `amountDue` and `amountPaid`, so any underpayment is visible on-chain.

### Funding

**What it's for.** A perpetual swap never expires, so something must keep its price near the real Bitcoin price. In real markets, when the swap trades above spot, longs pay shorts a small amount each hour, and that nudges the price back. In our system there's no separate swap price, so the owner posts a rate copied from a real exchange (Deribit). The keeper does this every 8 hours, capped at 0.1% an hour.

**A worked number.** A rate of 0.00125% an hour on an $80,000 position is $1 an hour, paid by the long to the short.

**The running total.** The contract keeps one number, `cumulativeFunding()`: how much a long has paid per dollar of position since deployment. It adds up as time passes at whatever rate is posted. Each trade remembers the total at its last settlement, and owes the difference.

Example: the rate is +0.00125% for 8 hours, then the owner posts -0.0005%, which runs for 4 hours.

```text
total = 8 × 0.00125% + 4 × (-0.0005%) = 0.008%
owed on an $80,000 position = $6.40, paid by the long
```

**Why it's built this way.** Our first version just multiplied the *current* rate by all the time since the last settlement. That had a real flaw: on a trade left unsettled for 30 days, the owner could post the maximum rate and instantly charge `0.1% × 720 hours = 72%` of the position, or $57,600. Now a new rate only applies from the moment it's posted. We found this by reading the code, not from a tool, and there's a test for it.

### Liquidation

Anyone can call `liquidate(tradeId)`. The contract settles first, then checks whether either side's margin value is below maintenance. If neither is, it reverts with `NotLiquidatable`. If one is:

1. It takes the reward from the losing side: 0.5% of position value.
2. It closes the whole trade (no partial liquidation).
3. It pays the reward to whoever called, in tUSDC.

Whatever margin the losing side has left stays in its account. Why reward strangers? Because it means someone is always motivated to clean up a bad position, without us having to be online. Our keeper does it too.

**The liquidation price** comes from one question: at what price does the margin that's left equal maintenance? For a short whose margin is all sBILL, with a position of 1 BTC:

```text
Loss at price P          = P - P0
sBILL sold to pay it     = (P - P0) / (1 - d)         d is the discount, 0 when the market is open
Margin value left        = h × (S - (P - P0) / (1 - d))    h = 1 - haircut, S = sBILL value at NAV
Liquidated when that is  = m × P                      m is 10%

Solve for P:   P = (h × S + h × P0 / (1 - d)) / (m + h / (1 - d))
```

If `d = 0`, this tidies up to the formula in the notebook: `h × (S + P0) / (m + h)`.

For our example, with $30,000 of margin and 1 BTC at $80,000:

| Who | Market | Liquidation price | BTC move needed |
|---|---|---|---|
| Short, sBILL margin | Open | $99,908 | +24.9% |
| Short, sBILL margin | Closed | $99,702 | +24.6% |
| Long, sBILL margin | Open | $55,618 | -30.5% |
| Long, sBILL margin | Closed | $55,774 | -30.3% |
| Long, tUSDC margin | Either | $55,556 | -30.6% |

For a bigger or smaller position, divide your margin by the BTC size first. This is why a liquidation needs a move of about 25% at the demo's size, and why the stress set exists. Its script works this price out, shows the contract refusing to liquidate 0.1% below it, then liquidates 0.1% above it.

### The vault's share price

```text
total assets = cash + what it paid for its sBILL
share price  = total assets / total shares
```

The sBILL is held at **cost**, not at its current value. So the share price doesn't move when the vault buys, and only rises when a profit is actually collected on Monday. We chose this so the share price never shows a gain the vault hasn't got yet.

There's a known side effect. Because the gain appears all at once, someone could deposit just before a redemption, collect a share of that profit, and withdraw. The amounts are small and a real product would add a waiting period, but we don't have one, and the report should say so.

### Rounding: who gets the last fraction of a cent

Contract division rounds, so someone gains or loses a tiny amount each time. We always round against the person being paid out, so the system can never give away more than it has.

| Calculation | Rounding |
|---|---|
| sBILL the vault takes for a dollar amount | Up (the vault's favour) |
| Dollars the vault pays for an sBILL amount | Down (the vault's favour) |
| NAV | Down |
| Signed values such as funding | Toward zero, because that's how Solidity divides |

The notebook copies these exact rules, which is how it matches the chain to the last of 18 decimal places.

### Packing data to save gas

Each storage slot holds 32 bytes, and a new one costs about 22,100 gas. Addresses take 20 bytes, so a slot has 12 bytes left over. We fit the trade's six fields into three slots instead of six:

```text
slot 1: long (20 bytes) + lastSettledAt (5) + open (1)
slot 2: short (20)      + size (12)
slot 3: lastPrice (16)  + lastFunding (16)
```

This cut the cost of opening a trade by 27%. The smaller number types are still huge: `size` holds billions of BTC, and `lastSettledAt` lasts until the year 36812. `SafeCast` makes the transaction revert instead of overflowing, if a value ever didn't fit. Numbers are in [docs/gas.md](docs/gas.md).

---

## 6. Who controls what

A stranger shouldn't have to trust us, so these limits are written into the contracts and shown live on the app's Controls page.

| The owner can | The limit |
|---|---|
| Post the funding rate | Up to 0.1% an hour, and only from that moment onward |
| Change the vault discount | Up to 1%, and only while the market is open |
| Pause new deposits, offers and trades | Settlement, closing, liquidation and withdrawals keep working |
| Switch the weekend on or off | **Only on the labelled Demo and Stress sets** |
| Mint test tUSDC | It's a test token with a public faucet anyway |

| Nobody can | Why |
|---|---|
| Move anyone's money | No function for it exists |
| Change margin levels, haircuts or the price feed | They're `immutable`, fixed at deployment |
| Change the real calendar | It has no owner and no settings |
| Point the vault at a different clearinghouse | `setClearinghouse` works once, ever |
| Upgrade the contracts | They aren't upgradeable. A fix means a new deployment |

**Other protections in the code:**

- **`nonReentrant`** on every clearinghouse function that moves money. Reentrancy is when a contract calls out and the other side calls back in before the first call has finished, which is how many famous hacks worked. This blocks it.
- **`SafeERC20`** for token transfers, which catches a token that fails quietly.
- **The trade's state is updated before any token moves**, so even a call-back would see correct numbers.
- **The vault only obeys the clearinghouse.** `buySBill` reverts for anyone else, so nobody can drain it by calling it directly.
- **Chainlink checks**, in `_price()`. The answer must be above zero, the round must be complete, and the price must be under 2 hours old. The feed updates about hourly, so 2 hours allows for a normal gap without accepting a dead feed.

---

## 7. What happens when things go wrong

| What goes wrong | What happens | Who is affected |
|---|---|---|
| Chainlink stops updating | After 2 hours, settlement, liquidation, new trades and withdrawals from accounts with a trade all revert, until a fresh price arrives. No money moves at a bad price | Everyone waits. Accounts with no trade can still withdraw |
| The vault runs out of cash at the weekend | `settle` and `liquidate` revert for sBILL-backed losers, until someone deposits or the market reopens | The winner waits. Losses keep building up, and a later settlement pays them all at once |
| Bitcoin moves more than the loser's whole deposit | The winner gets everything the loser had, and the rest is lost. `amountPaid` is less than `amountDue`. There's no insurance fund | The winner is underpaid. A liquidator's reward can be $0, because nothing is left to pay it |
| The keeper stops | Nothing breaks. Unsettled gains and losses simply add up until anyone settles. Liquidations wait for someone else to call | Bigger settlements later |
| The owner's key is lost | Funding stays at its last rate and the discount stays put. Everything else works | No new funding rates |
| The owner's key is stolen | The attacker can post funding at the cap, set the discount to 1%, or pause deposits. They can't take funds directly | Damage is limited by the caps |
| A counterparty closes the trade | Your trade ends at the current price, with everything settled | Your hedge is gone, and you'd need a new one. This is a real cost of bilateral trades |
| Someone sends the wrong amount | The contract checks and reverts, and the website explains why in plain English | Only the failed transaction's gas |

---

## 8. The parts that aren't on the blockchain

### The three sets of contracts

We deploy the whole system three times, from the same code. Each set's contract names have a different prefix.

| Set | Calendar | BTC price | What it's for |
|---|---|---|---|
| **Main** (no prefix) | Real, nobody can change it | Chainlink | The production design |
| **Demo** | Owner's switch | Chainlink | Showing the weekend on any day, with a real price |
| **Stress** | Owner's switch | Mock, anyone can move it | Showing a liquidation, which would otherwise need a 25% move |

### The one command: `yarn onchain:all`

This does everything that happens on Sepolia, in order, asking for the deployer password once:

| Step | What it does |
|---|---|
| 1 | Compiles the contracts |
| 2-4 | Deploys the main, demo and stress sets. Each deploys TestUSDC, a calendar, SBill, WeekendVault and Clearinghouse, links the vault to the clearinghouse, and mints the fund's interest reserve |
| 5 | Publishes the source code on Etherscan, so anyone can read it |
| 6 | **Demo setup** (`demoSetup.ts`): gives the four demo wallets gas, funds the vault, has the funds buy and post sBILL, and opens the two mirrored trades |
| 7 | **Weekend story** (`demoWeekend.ts`): posts funding, waits for a new Chainlink price, switches to "weekend", settles both trades, switches back, and redeems. This can take up to an hour, because Chainlink updates about hourly |
| 8 | **Keeper pass** (`keeper.ts`): one run of the robot, for evidence |
| 9 | **Liquidation** (`demoLiquidation.ts`): on the stress set, shows the refusal below the model's price, then the liquidation above it |
| 10 | **Evidence** (`evidence.ts`): writes `submission.json` and `docs/deployments.md` from the logs, so no address or hash is typed by hand |

If a step fails, it tells you how to resume, for example `START_AT=7 yarn onchain:all`. To rehearse without spending anything, run `yarn chain` in one terminal and `yarn onchain:all --network default` in another.

**This ran on Sepolia on November 1,** and cost about 0.0067 SepoliaETH. The results are in [CLAUDE.md](CLAUDE.md), and the links are in [docs/deployments.md](docs/deployments.md). The contracts are now frozen, so it shouldn't need to run again.

### The keeper

Chainlink Automation isn't available on test networks, so the keeper is our own script, `packages/hardhat/scripts/keeper.ts`. Every 10 minutes it:

1. Liquidates any trade below maintenance margin.
2. Settles any trade not settled for 55 minutes.
3. Redeems the vault's sBILL if the market is open.
4. Every 8 hours, posts the funding rate from Deribit (if its wallet is the owner).

It has no special power except posting funding, which needs the owner's key. Everything else, anyone in the world could do. `KEEPER_ONCE=1` runs a single pass.

### Where secrets live

`packages/hardhat/.env` holds the encrypted deployer key, the demo wallets' seed phrase and the Etherscan key. It's git-ignored, exists only on Sai's machine and is never printed. These are testnet wallets. **Never put real money in them.**

### What deployment leaves behind

- `packages/hardhat/deployments/sepolia/*.json`: each contract's address, interface (ABI) and source. The notebook reads these.
- `packages/nextjs/contracts/deployedContracts.ts`: the same, generated automatically for the website. By team decision, it also keeps the entries from our last local rehearsal, which the live site ignores.
- `packages/hardhat/demo-log.sepolia-demo.json` and `demo-log.sepolia-stress.json`: every transaction hash with a description.

---

## 9. The website

It's a Next.js app in `packages/nextjs`, built on Scaffold-ETH. Run it with `yarn start`, then open <http://localhost:3000>.

| Page | What it's for |
|---|---|
| **Overview** | Live prices, where the system is in the weekend story, open trades, and a plain-English activity log with links to Etherscan |
| **Margin** | Get tUSDC, buy or redeem sBILL, post or take out margin |
| **Trade** | Post and accept offers, see your position and liquidation price, settle, close |
| **Vault** | Deposit and withdraw, see the share price, trigger Monday's redemption |
| **Controls** | What the owner can and can't do, the safety rules read live, the admin actions, and links to each contract |
| **Economics** | The configurable analysis (see the next section) |
| **Debug** | Scaffold-ETH's raw view of every contract function |

**How a click becomes a transaction.** The page asks your wallet to sign. Scaffold-ETH's `useScaffoldWriteContract` first simulates the transaction, so a call that would fail is caught before you pay anything. The toast at the top shows "waiting", then "completed" with a link to Etherscan, and every number on the page refreshes.

**Things built to earn trust**, because the brief asks for them:

- Errors are in plain English. The contract's `InsufficientMargin` becomes "Your margin is too low for this. Deposit more, or use a smaller size." The list is in `packages/nextjs/utils/weekend/errors.ts`.
- A button that can't be used says why underneath, instead of just being grey.
- Irreversible actions (closing, liquidating) take two clicks, and the second says what will happen.
- A bar on every page says which set of contracts you're using and what's pretend about it.
- If the price feed is stale, a warning says so and explains that no money can move.

**How it reads data.** Rather than sending twenty separate requests per page, `useBatchRead` bundles them into one multicall, because public servers limit request rates. It uses a free public Sepolia server by default. Set `NEXT_PUBLIC_SEPOLIA_RPC_URL` to use your own, and `NEXT_PUBLIC_USE_LOCAL_CHAIN=true` to point the app at `yarn chain`.

---

## 10. The analysis, and what you can change

### What's configurable

Everything Swastik might want to change lives in two files, so nobody has to touch the code. [config/README.md](config/README.md) explains every field.

```text
config/protocol.json         what the contracts are deployed with
                             margins, haircuts, discount, funding cap
                             read by: the deploy script and the notebook

config/assumptions.json      the analysis's judgement calls
                             investor's required return, closure length, go-to-market inputs
                             read by: the notebook and the Economics page

config/analysis_results.json what the notebook found in the market data
                             written by: the notebook. Read by: the Economics page
```

### How the pieces connect

```text
market data ──┐
              ├──► notebook ──► charts and tables for the report
assumptions ──┤        │
              │        └──────► analysis_results.json ──► Economics page
              │                                               │
              └───────────────────────────────────────────────┤
                                                              │ "Copy as JSON"
                                                              ▼
                                                 paste into assumptions.json
```

### Three ways to change a number

| You want to | Do this | Needs a redeploy? |
|---|---|---|
| Try ideas quickly | Move the inputs on the Economics page | No |
| Make them the team's numbers | Copy the JSON into `config/assumptions.json`, re-run the notebook | No |
| Change the discount for real | The owner uses Controls, or the button on the Economics page. Then update `vaultDiscountBps` in `config/protocol.json`, because Section F stops if the two differ | No |
| Change a margin, haircut or the 4% | Edit `config/protocol.json`, then deploy again under a new `DEPLOY_PREFIX` | **Yes**, they're immutable |

### What the notebook does

`docs/analysis.ipynb` has seven sections:

- **A.** Hedged vs unhedged profit across price scenarios, with funding, and a rolling backtest.
- **B.** Liquidation prices.
- **C.** How risky weekends are compared with weekdays.
- **D.** What discount the vault needs.
- **E.** Whether the vault beats the fund's alternatives.
- **F.** Reconciling with the chain: every model number against what the contract actually did, to the last decimal.
- **G.** Going-to-market: revenue, and the hedge size needed to break even.

### The main finding

The 10bp discount covers the risk of each purchase (6.6bp), but not the cost of cash waiting around. A vault sized for 99% of weekends earns about 1.7% a year against 4% on T-bills. It would need 28-44bp, and the fund stops preferring it at about 42bp. So there's a workable price, but only just. This is a real finding, and we report it openly.

---

## 11. How we know it works

**Tests.** `yarn test` runs 37 tests on a local blockchain whose clock we can move, so we can test a real Saturday. They cover the calendar's exact edges, the vault's rules, the weekend and weekday paths, price feed checks, margin rules, funding and rate changes, liquidation (including through the vault, and when a deposit runs out), pausing, and owner limits. Many of them check that something *fails* when it should. Three runs of randomized price moves check that no token is ever created or lost.

**Reconciliation.** The notebook recomputes each number with the contract's formulas and compares it to the chain. On Sepolia, all 28 numbers match exactly. In a tougher local rehearsal with repeated demos, rate changes, a discount change and a liquidation, all 51 did.

**Liquidation model check.** `demoLiquidation.ts` predicts the price, and the contract confirms it from both sides.

**Security scan.** Slither's findings are each fixed or explained in [docs/slither.md](docs/slither.md). Slither didn't catch the funding flaw above. Reading the code did, which is a useful thing to say in the report.

**Gas.** [docs/gas.md](docs/gas.md) has the cost of each function and the before and after of our change, both locally and live on Sepolia.

**Deployed code.** All 16 contracts are verified on Etherscan, and the verified source of the 15 we checked is identical to the files in this repo.

---

## 12. What is real and what is pretend

| Real | Pretend |
|---|---|
| The contracts, verified on Etherscan | The money: tUSDC and sBILL are worthless test tokens |
| Every transaction, which anyone can check | sBILL's fixed 4%, with no T-bill price risk |
| Chainlink's BTC price on the main and demo sets | The weekend on the demo set, which is a switch |
| Margin, settlement, funding and liquidation logic | The price on the stress set, which anyone can move |
| Funding rates, copied from Deribit | That the rate comes from a market: the owner posts it |

**Known limits, to state in the report:**

- No insurance fund, so a loss beyond a deposit underpays the winner.
- One market, one position per account, full liquidation only.
- Either side can close a trade at any time, ending the other side's hedge.
- The calendar has no holidays, and is an hour off during daylight saving time.
- A vault depositor can time a deposit just before Monday's redemption to collect a share of the profit.
- Real tokenized funds such as BUIDL and BENJI only allow approved holders, so the vault and clearinghouse would need approval. This is in the report's risks section, with no code by team decision.

---

## 13. Questions the professor might ask

**How does "weekend" work on Sepolia, and who can change it?**
There are two calendars. `MarketCalendar` works it out from the clock (Friday 21:00 to Monday 14:00 UTC) and has no owner, so nobody can change it. `DemoCalendar` has a switch held by the deployer, used only on the labelled demo and stress sets, so we can show the weekend path on any day. It announces itself with `isDemo() = true`.

**Why is the staleness limit 2 hours?**
The feed updates about hourly. A limit of exactly 1 hour would stop the system during any normal gap, so it's set above that. The contract refuses to deploy with a limit of 1 hour or less.

**Why not just hold cash?**
Cash earns nothing. On a $1 million hedge at 2.6x, the analysis finds a fund earns about $14,150 a year with the vault at 10bp, against $10,050 with a cash buffer and nothing in all cash.

**Why does the vault buy at a discount instead of lending?**
A loan needs interest rates, loan terms and collateral checks. A purchase is one atomic swap. The vault holds a real asset, which it redeems on the next business day.

**What stops the owner stealing money?**
No function can move anyone's funds. The owner's powers are listed in [section 6](#6-who-controls-what), each with a hard limit, and nothing can be upgraded.

**What if the vault has no cash?**
Settlement reverts and waits. That's a safe failure: nobody is paid wrongly, but the winner waits. That's why vault sizing matters, and the notebook sizes it from the 99% weekend move.

**Why is sBILL held at cost in the vault?**
So the share price never shows a gain the vault hasn't collected. The trade-off is that the gain arrives all at once on redemption, which someone could time. We disclose that.

**Why is the discount adjustable, when so much else is fixed?**
Because the right discount depends on T-bill yields, which change. The owner can adjust it, but only up to a hard 1% limit, which is below the 3% weekend haircut, and never during a weekend.

**Why bilateral trades instead of a pool?**
So one user's loss is never spread over others. A pool needs a backstop, and we don't have one. The cost is that when one side leaves, the other's hedge ends.

**Why did you redeploy the contracts?**
Two reasons, both good ones to say out loud. Measuring gas showed that opening a trade was expensive, so we packed the storage. And reading the code showed that a new funding rate applied backwards in time, so we fixed it. We also moved the calendar to the 65-hour closure the analysis uses. The first deployment is in [docs/archive/sepolia-v1](docs/archive/sepolia-v1/README.md).

**Did the live run work first time?**
No. The weekend story, keeper pass and contract verification all completed, though Etherscan's rate limit meant a slower retry for verification. The liquidation step took three tries because of two bugs in our script, and the contracts behaved correctly each time. First, the script expected the wrong error code, so it treated the contract's correct refusal as a crash. Then a mock price update ran out of gas, because the gas estimate assumed that writing the current time would cost almost nothing, which [docs/gas.md](docs/gas.md) explains. We fixed both and carried on with the same open trade.

**How did you check what AI wrote?**
Tests, Slither, reconciling every number against the chain to 18 decimals, and reading it. This document exists so that we can explain every part of it ourselves. Report Section 8 covers this.

---

## 14. Where everything lives

```text
config/                     every setting you can change, with a README
docs/
  analysis.ipynb            the financial analysis
  ANALYSIS_GUIDE.md         the analysis plan and formulas
  deployments.md            addresses and key transactions, generated
  slither.md, gas.md        security scan and gas results
  figures/, data/           charts for the report, and market data
packages/hardhat/
  contracts/                the Solidity
  deploy/                   the deploy script
  scripts/                  keeper, demos, onchainAll, evidence
  test/WeekendMargin.ts     the tests
  deployments/sepolia/      what was deployed
packages/nextjs/
  app/                      one folder per page
  components/weekend/       shared pieces of the interface
  hooks/weekend/            reading from the contracts
  utils/weekend/            formatting, plain-English errors, economics formulas
submission.json             generated, for Brightspace
```

For the meaning of a word such as "perp" or "NAV", see the glossary at the end of [VISION.md](VISION.md).

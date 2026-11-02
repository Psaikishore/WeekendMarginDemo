# The vision, in plain English

Read this when you lose track of why we are doing any of this. For how it works underneath, in equally plain English, see [HOW_IT_WORKS.md](HOW_IT_WORKS.md). For status and to-do lists, see [CLAUDE.md](CLAUDE.md).

## The one-sentence version

**We let a fund keep its money in T-bills, earning interest, and still pay what it owes on a Saturday.**

## The problem

Bitcoin trades every hour of every day. Banks and the T-bill market close for the weekend.

Say a fund owns Bitcoin and wants to protect itself from price swings. It takes a bet in the opposite direction, called a **hedge**. If Bitcoin rises, the Bitcoin it owns gains and the hedge loses. If Bitcoin falls, the reverse. The two cancel out, which is the point.

But the hedge's losses have to be paid as they happen, including at 3am on a Sunday, in cash. The fund's safest asset is T-bills, which pay about 4% a year, and T-bills can't be turned into cash until Monday.

So funds keep piles of cash sitting around just in case, earning nothing. It's like keeping your savings in an account that closes on weekends, while your bills can arrive at any time. You end up keeping extra cash under the mattress.

Big exchanges have the same problem. CME now trades crypto 24/7, but its weekend trades don't clear until the next business day. When the market crashes on a weekend, this matters: around $19 billion of open positions were wiped out within 36 hours on October 10-11, 2025 (figure from RockawayX).

## Our answer

**A shop that stays open all weekend.**

If the fund needs cash on Saturday, the shop buys its T-bills for $0.999 on the dollar. On Monday, the shop cashes them in for the full $1.00 and keeps the difference.

- The fund pays a tiny fee, only when it needs cash, and earns T-bill interest the rest of the time.
- The person who won the bet gets paid on Saturday, not Monday.
- The shop's investors earn the fee.

Everything runs on smart contracts, so no bank has to be open and no person has to approve anything.

## Who's who

| Name | What it is, in simple terms |
|---|---|
| **sBILL** | Our token. A pretend share in a T-bill fund. Its value grows 4% a year. It can only be bought from or sold back to the fund on business days |
| **tUSDC** | Pretend dollars for the test network |
| **Clearinghouse** | The referee. It holds everyone's deposits, checks the Bitcoin price, and moves money from the loser to the winner |
| **Weekend Vault** | The weekend shop. A pool of cash from investors that buys sBILL at a small discount while the market is closed |
| **Calendar** | Answers one question: is the T-bill market open right now? |
| **Chainlink** | The trusted source of the Bitcoin price |
| **Keeper** | A small robot script that regularly tells the contracts to settle up |
| **Website** | Where a person can do all of this by clicking, with errors explained in plain English |

## The story, with numbers

These are the demo's position sizes, with round prices and a 1.5% move as the example.

**Friday.** Fund A deposits $30,000 of sBILL as margin and bets against 1 Bitcoin at $80,000. Trader B takes the other side, using $30,000 of tUSDC.

**Saturday.** Bitcoin rises 1.5%, so Fund A owes Trader B $1,200. Fund A has no cash, only sBILL, and the T-bill market is closed.
- *Without us:* Trader B waits until Monday, or Fund A has to keep idle cash just for this.
- *With us:* the clearinghouse sells about 1,201 of Fund A's sBILL to the vault at $0.999 each. Trader B is paid straight away.

**Monday.** The market reopens. The vault cashes in its sBILL at about $1.00 each, and keeps about $1.20 profit.

Fund A paid about $1.20 to avoid holding idle cash all year. That is the whole idea.

**This has now happened on Sepolia.** On the demo contracts, Bitcoin rose 0.56%, so Fund A owed $437.16. The vault paid that for 437.59 sBILL, the winner was paid at once, and the vault cashed in the sBILL for $437.59, keeping $0.44. The links are in [docs/deployments.md](docs/deployments.md).

## What's real and what's pretend

**Real:** the contracts, running on the Sepolia test network. The transactions, which anyone can check. The Bitcoin price from Chainlink.

**Pretend:**
- **The money.** tUSDC and sBILL are test tokens with no real value.
- **The 4%.** It's fixed in the contract. A real fund's return would move.
- **The weekend, in the demo.** We can't wait for a real weekend every time we show this, so the demo has a labelled switch that says "it's the weekend now". The system then behaves exactly as it would on a Saturday. Whoever deployed the demo holds that switch, and our report says so.
- **The price, on the stress set only.** A liquidation needs Bitcoin to move about 25% at the demo's size. So a third labelled set of contracts has a mock price, used only to show a liquidation.

There is also a real version of the calendar, `MarketCalendar`. It works from the actual date, and nobody can change it. That is the version a real product would use.

## What the numbers say

The full analysis is in [docs/analysis.ipynb](docs/analysis.ipynb).

- **The hedge works,** as long as it doesn't use too much borrowed money. At the demo's level, it removes about 92% of the risk of holding Bitcoin for a month.
- **Liquidation is the main danger.** If a side's deposit runs too low, the trade is shut down and the hedge is gone. With no top-ups, that happens in about 14% of 30-day periods at the demo's level, and about half at the highest level.
- **Weekends aren't more dangerous per hour.** They're just long, 65 hours with the market shut.
- **The fund clearly wins.** On a $1 million hedge, it earns about $14,150 a year with the vault, against $10,050 holding a cash buffer and nothing in all cash.
- **Our 0.1% fee is too low for the shop.** It covers the risk of each purchase, but the vault's cash sits idle most of the time. The vault earns about 1.2-1.7% a year, when T-bills pay 4%. To be a real business it would need a fee of about 0.3-0.4%, or a way to earn interest on its idle cash. This is a useful finding, and we report it openly.
- **The maths matches the contracts** exactly, down to the last digit. All 28 numbers checked on Sepolia match, and all 51 matched in a tougher local rehearsal.

## What could go wrong

- **Real T-bill tokens have rules.** BUIDL and BENJI only allow approved holders, so the vault and clearinghouse would need approval from the fund issuers. Our report's risks section covers this.
- **The vault can run out of cash.** Then settlement waits until more cash arrives or the market reopens.
- **The price feed can stop.** The contracts refuse any price older than 2 hours, so settlement pauses instead of using a bad price.
- **Someone can lose more than their deposit.** There is no insurance fund, so a huge sudden move could leave a winner underpaid.

## If this were a real business

- **Who it's for:** crypto hedge funds, market makers and basis traders who already hold tokenized T-bills.
- **Why they'd trust it:** open and verified code, tests and a security scan, limits on what the admin can do, and a calendar nobody can change.
- **How it makes money:** a share of the vault's fee, plus a small fee per trade.

Swastik is writing this up properly. The app's Economics page and Section G of the notebook work out the numbers, and every input can be changed.

## Where we are

**Done**
- [x] All contracts written, with 37 passing tests
- [x] Keeper script that settles, liquidates and posts funding
- [x] Analysis notebook, with every assumption in one config file
- [x] Website: margin, trading, vault, controls and a live economics page
- [x] Security scan and gas measurements, with changes made because of them
- [x] Everything on Sepolia: all 16 contracts verified, the weekend story, funding, a keeper pass and a liquidation
- [x] Notebook re-run against the live contracts, with all 28 numbers matching
- [x] `submission.json` written and checked, apart from the video link

**Still to do before Wednesday, Nov 4, 11:59pm ET**
- [ ] Check the analysis and make it our own, and replace the go-to-market placeholders (Swastik)
- [ ] Going-to-market plan and risks section (Swastik)
- [ ] Try one transaction on the live site with MetaMask (Sai)
- [ ] Video, then add its link to `submission.json` (both)
- [ ] Report, share the repo, tag it `final`, and upload to Brightspace (both)

## Words you'll hear

| Word | Meaning |
|---|---|
| **Perp (perpetual swap)** | A bet on Bitcoin's price that never expires |
| **Long / short** | Long gains when the price rises. Short gains when it falls |
| **Margin** | The deposit you must keep to hold a trade open |
| **Leverage** | How large the trade is compared with your deposit. $80,000 of Bitcoin on a $30,000 deposit is 2.7x |
| **Liquidation** | The trade is force-closed because the deposit got too low. Whoever triggers it earns a small reward |
| **Funding** | A regular payment between longs and shorts that keeps the perp's price close to the real price |
| **Haircut** | Counting a deposit as slightly less than it's worth, for safety. sBILL counts at 99% on weekdays, and 97% at weekends |
| **NAV** | What one fund share is worth today |
| **Settlement** | Actually moving the money from loser to winner |
| **Sepolia** | Ethereum's test network. It works like the real thing, but the money is free |
| **bp (basis point)** | One hundredth of a percent. 10bp is 0.1% |

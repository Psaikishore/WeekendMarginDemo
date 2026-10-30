# CLAUDE.md

@AGENTS.md

`AGENTS.md` above covers the Scaffold-ETH 2 toolchain. This file covers the project: what it is, where it stands and what to do next. New here? Read [VISION.md](VISION.md) first, which explains the idea in plain English.

## The project

An on-chain clearinghouse for Bitcoin perpetual swaps that accepts tokenized T-bills as margin and can still pay winners when the T-bill market is closed. If a loser holds only T-bill tokens over a weekend, a vault of investors' cash buys those tokens at a small discount, pays the winner at once, and redeems the tokens on Monday.

- **Course:** FRE-GY 6931 Blockchain & Cryptocurrency, Fall 2026, Prof. Richard Radnay, TA Hina Tomar. We are Team 9. Topic 2, hedging with perpetual swaps.
- **Due:** Wednesday, November 4, 2026, 11:59pm ET. Worth 30% of the grade.
- **Team:** Sai Kishore owns contracts and on-chain work. Swastik Mishra owns analysis and product (going to market).
- **The brief:** on Brightspace. It is course material, so keep it out of this public repo.

## Where things stand

As of October 30, 2026.

| Item | Owner | Status |
|---|---|---|
| Contracts and tests | Sai | Done: 25 tests pass |
| Sepolia deployment | Sai | Done: both sets below |
| Etherscan verification | Sai | `yarn verify` was run. Open each link below to confirm before submitting |
| Demo accounts and trades | Sai | Done: two trades open on the demo set |
| Keeper | Sai | Written and tested locally. Not yet run on Sepolia, so the funding rate there is still 0 |
| **Weekend demo on Sepolia** | Sai | **Not run yet.** Commands are below |
| Front end | Sai | Not started. `scaffold.config.ts` still targets the local chain, and the home page is the template's |
| Slither scan (`docs/slither.md`) | Sai | Not started |
| Gas, with one before/after change (`docs/gas.md`) | Sai | Not started |
| README | Sai | Still the template's. Must say what the project does and how to run the tests |
| **Financial analysis** | Swastik | **First draft done:** [docs/analysis.ipynb](docs/analysis.ipynb). Needs your review, then a re-run after the demo |
| **Going-to-market plan** | Swastik | Not started |
| **Risks: BUIDL and BENJI holder restrictions** | Swastik | Not started |
| Report PDF (`docs/`) | Both | Not started. Use LaTeX |
| Video, with every member speaking | Both | Not started |
| `submission.json`, repo shared, tag `final` | Sai | Not started. One of us uploads the report and `submission.json` to Brightspace |

## Swastik: start here

1. Read [VISION.md](VISION.md), then this file.
2. Set up and run the notebook (see "Setup"). Everything needed is in the repo, and you don't need any keys.
3. Read each "Reading the results" section in the notebook, and challenge every assumption. They are listed in its settings cell and under "Limits". The hurdle premium, redemption risk and gate loss are judgement calls you should be ready to defend.
4. Write the going-to-market section. The brief asks for users, trust, promotion, business model and risks, with rough numbers on what volume covers the running costs. Sections D and E of the notebook give you the vault's income and the 30-40bp price range.
5. Write the BUIDL and BENJI risks. Confirm the facts first. Our working understanding is that BUIDL holders must be allowlisted through Securitize, and that BENJI shares are held in KYC'd registered accounts. What it means for us: the vault and clearinghouse would need to be approved holders, vault depositors might need KYC, sBILL could only move to approved addresses (our design only sends it to the vault or the fund, never to a liquidator), and Monday redemption depends on a partnership with the issuer.
6. After Sai runs the demo, re-run Section F, then write Section 4 of the report using `docs/figures/`.

[docs/ANALYSIS_GUIDE.md](docs/ANALYSIS_GUIDE.md) is the original analysis plan, with the formulas.

## How it works

```text
           deposit sBILL or tUSDC          price, checked for staleness
  Fund / Trader ─────────────► Clearinghouse ◄──────── Chainlink BTC/USD
                                │        │
              weekday: redeem   │        │  market closed: sell at NAV - 10bp
                                ▼        ▼
                              SBill ◄── WeekendVault ◄── investors deposit tUSDC
                                  Monday: redeem, keep the discount
```

| Contract | What it does |
|---|---|
| `TestUSDC.sol` | Test dollars, 18 decimals, with a faucet (100,000 per hour) |
| `SBill.sol` | **Our token.** ERC-20 mock T-bill share. NAV grows at a fixed 4%. Buy and redeem only when the market is open |
| `MarketCalendar.sol` | The real calendar: weekend is Saturday 00:00 to Monday 00:00 UTC. No admin, nobody can change it |
| `DemoCalendar.sol` | The demo calendar: an owner-only switch for "it is the weekend now". Used only by the Demo set |
| `WeekendVault.sol` | ERC-4626 vault of tUSDC. Buys sBILL at NAV minus 10bp, only from the clearinghouse and only when the market is closed. Anyone can trigger redemption on business days. Inventory is held at cost, and withdrawals are capped at cash |
| `Clearinghouse.sol` | Deposits, offers, bilateral trades, settlement, funding, liquidation. Ownable, Pausable, ReentrancyGuard |

**Settlement.** Anyone can call `settle(tradeId)`. It pays the price change plus funding from the loser to the winner in tUSDC. If the loser runs out of tUSDC, its sBILL is converted: through the fund on weekdays, or sold to the vault when the market is closed.

**Liquidation.** Anyone can call `liquidate(tradeId)` when, after settlement, either side's margin is below maintenance. The caller earns 0.5% of notional, and the whole trade closes.

**Settings.** These are fixed at deployment in `packages/hardhat/deploy/00_deploy_weekend_margin.ts`. If a document disagrees with the contract, the contract wins.

| Setting | Value |
|---|---|
| Initial / maintenance margin | 20% / 10% of notional |
| sBILL haircut | 1% weekdays, 3% when the market is closed |
| sBILL interest | 4% a year, simple |
| Vault discount | 10bp |
| Liquidation reward | 0.5% of notional |
| Funding | Posted by the owner, capped at 0.1% per hour. Positive means longs pay shorts |
| Oldest accepted price | 2 hours (the feed updates about hourly) |

## On Sepolia

The Chainlink BTC/USD feed is `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43`. Full addresses and ABIs are in `packages/hardhat/deployments/sepolia/`.

**Demo set (use this for the demo, video and reconciliation).** It has 50,000 tUSDC in the vault, Fund A short vs Trader B long, and Fund C long vs Trader D short, each 1 BTC with 30,000 margin, opened at $77,853.66. The funds post sBILL and the traders post tUSDC, so whichever way BTC moves, one sBILL-backed fund has to pay.

| Contract | Address |
|---|---|
| DemoClearinghouse | [0x7dc8107086bbfd17093f54936fe719bb1cc8e41e](https://sepolia.etherscan.io/address/0x7dc8107086bbfd17093f54936fe719bb1cc8e41e#code) |
| DemoWeekendVault | [0x73954e6726c4c80ccb08485f74830a6210b1d618](https://sepolia.etherscan.io/address/0x73954e6726c4c80ccb08485f74830a6210b1d618#code) |
| DemoSBill | [0xe82652b02bc9f63f79e7c958db21565b1b2a5b55](https://sepolia.etherscan.io/address/0xe82652b02bc9f63f79e7c958db21565b1b2a5b55#code) |
| DemoTestUSDC | [0xedcb92c0a4f8f501de5ecd6780d0361aa766a609](https://sepolia.etherscan.io/address/0xedcb92c0a4f8f501de5ecd6780d0361aa766a609#code) |
| DemoMarketCalendar (a `DemoCalendar`) | [0x890837d453b122759a8df8fb8552dc6a3adfaf50](https://sepolia.etherscan.io/address/0x890837d453b122759a8df8fb8552dc6a3adfaf50#code) |

**Main set (the real calendar).** Deployed and wired together, with no trades and an empty vault. It shows the production design.

| Contract | Address |
|---|---|
| Clearinghouse | [0x28f687ebb11fa2ef878ba9666b04a7a7ba3bbedf](https://sepolia.etherscan.io/address/0x28f687ebb11fa2ef878ba9666b04a7a7ba3bbedf#code) |
| WeekendVault | [0xe713d3b67df48bab11a595880e3c1090d7a38cd2](https://sepolia.etherscan.io/address/0xe713d3b67df48bab11a595880e3c1090d7a38cd2#code) |
| SBill | [0x04cac5d9bbac0371a8f90cee53c1177980d5b7b8](https://sepolia.etherscan.io/address/0x04cac5d9bbac0371a8f90cee53c1177980d5b7b8#code) |
| TestUSDC | [0x6e558d2e5272e54674bcae5f7b21af8c90c42499](https://sepolia.etherscan.io/address/0x6e558d2e5272e54674bcae5f7b21af8c90c42499#code) |
| MarketCalendar | [0xc130421bf0d52a45502a4aaea8d2983f32512031](https://sepolia.etherscan.io/address/0xc130421bf0d52a45502a4aaea8d2983f32512031#code) |

Every demo transaction hash is logged in `packages/hardhat/demo-log.sepolia-demo.json`, ready for `submission.json`.

## What the professor asked for

| Feedback on the proposal | Where it is answered |
|---|---|
| Financial analysis: hedged vs unhedged P&L, funding, liquidation price, and vault economics, including the discount needed given the T-bill yield and weekend price risk | Notebook, Sections A-E |
| A going-to-market plan | Report Section 6. **Not written yet** |
| Build the end-to-end path first | Done in that order. Say so in the report |
| How does "weekend" work on Sepolia, and who can change the calendar? Staleness limit above 1 hour | Two calendars (below), and a 2-hour limit |
| Risks: BUIDL and BENJI holder restrictions | Risks section only, by team decision: no allowlist code. **Not written yet** |

The proposal was not resubmitted; these points go into the final project.

## Design decisions

These are for report Section 2, which asks what we chose, what we considered instead, and what changed along the way.

- **Bilateral trades, not a pool.** Each trade has one long and one short, so losses are never spread across other users. The cost: when one side is liquidated, the other side's hedge ends too.
- **Fixed NAV instead of a posted NAV. Changed from the proposal.** A keeper posting NAV would be another trusted role. A fixed 4% has none, but it can't show T-bill price risk on-chain.
- **Two calendars. Changed during the build.** We first gave `MarketCalendar` a fixed time offset for the demo, but that only shifts which real days count as the weekend, so the demo depended on the recording day. Now the real calendar has no admin, and a separately labelled demo copy has a switch. **The report must say that the deployer controls the demo's switch.**
- **2-hour staleness limit.** It sits above the feed's 1-hour heartbeat, so a normal gap doesn't stop settlement.
- **Vault inventory held at cost, withdrawals capped at cash.** The share price rises only when a discount is actually realised, and a depositor can't drain cash that is owed elsewhere.
- **Two mirrored demo trades.** With one trade, a price move in the wrong direction wouldn't touch the vault.
- **Deribit for funding.** The brief names BitMEX, but its API returns 403 from our US network.
- **Sepolia gas price of 0.05 gwei.** The default tip was draining a small test wallet.
- **10bp discount.** This was our estimate before the analysis. It covers the risk of each use, but not the cost of cash waiting (see below).

**Known limits.** sBILL is a mock. Funding is posted by the owner, not set by a market. There is no insurance fund, so a loss beyond a deposit underpays the winner. Each account has one market and one position, and liquidation is full only. The contract's weekend is 48 hours, against a real closure of about 65, and it has no holidays.

**When things fail.** If the vault lacks cash, `settle()` and `liquidate()` revert until cash arrives or the market reopens. If the feed is stale, settlement, liquidation, and withdrawals from accounts with an open trade all revert until a fresh price arrives. Both are safe failures, but they are real, and the report's trust section should say so.

## What the analysis found

The numbers are in [docs/analysis.ipynb](docs/analysis.ipynb), with the data in `docs/data/` and charts in `docs/figures/`.

1. **The hedge works at modest leverage.** At the demo's 2.6x, it removes 92% of 30-day variance, and earns about $340 a month per BTC with typical funding.
2. **Liquidation is the main threat.** With no top-ups, the short at 2.6x is liquidated in 14% of 30-day windows, and at 4.9x in about half.
3. **BTC isn't riskier per hour on a weekend.** Hourly volatility is 0.52% in closures and 0.68% outside. The 99% move over a 65-hour closure is +11.1% and -13.0%.
4. **10bp covers each use but not idle cash.** The required discount per use is 6.6bp (base) and 13.2bp (stress). But a vault sized for 99% of weekends earns 1.2-1.7% a year against 4.01% on T-bills. It needs 28-44bp serving both longs and shorts, or a way to earn on idle cash.
5. **The fund gains up to 42bp,** compared with holding a cash buffer. So a price that suits both sides exists, but the room is narrow.
6. **Reconciliation:** 13 numbers match Sepolia to the wei today. The demo adds settlements, funding and vault trades. That code passed on a local chain, where all 29 numbers matched.

**Open decision for the team:** keep 10bp on-chain and report this result openly (our suggestion), or redeploy the demo with a higher discount.

## Setup

**Contracts and tests.** Needs Node 22.10 or newer, and Yarn 4 through Corepack.

```bash
corepack enable
yarn install
yarn test
```

**Notebook.** Needs Python 3.10 or newer.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r docs/requirements.txt
jupyter lab docs/analysis.ipynb
```

**On Sai's machine,** Node 22 and Yarn are in the `crypto` mamba environment.

## Commands

**Try the demo on a local chain.** No keys are needed, and the mock price moves +1.5% by itself. Use no `--network` flag: `--network localhost` asks for the deployer's password.

```bash
yarn chain
DEMO=true yarn deploy
DEMO=true yarn demo:setup
DEMO=true yarn demo:weekend
```

Local runs overwrite the Sepolia ABIs, so clean up afterwards: `git checkout packages/nextjs/contracts/deployedContracts.ts`, and delete `packages/hardhat/deployments/default` and `packages/hardhat/demo-log.default-demo.json`.

**On Sepolia (Sai only, needs the deployer password).** The first command posts a funding rate from Deribit and settles any trade older than 55 minutes. The second runs the weekend story, and `DEMO_PAUSE=1` waits for Enter between steps, for narrating the video. It may wait up to an hour for a new Chainlink price.

```bash
DEMO=true KEEPER_ONCE=1 yarn keeper --network sepolia
DEMO=true DEMO_PAUSE=1 yarn demo:weekend --network sepolia
```

**Other things worth knowing.** `yarn check-types` shows 3 errors in the template's own `rocketh/*.ts` files; plain `tsc` is clean, so ignore them. Tests live in `packages/hardhat/test/WeekendMargin.ts`.

## Rules

- **Never commit or print secrets.** `packages/hardhat/.env` holds the encrypted deployer key, the demo wallets' mnemonic and the Etherscan API key. It is git-ignored and exists only on Sai's machine.
- **This repo is public,** and it's graded at the tag `final`. Never put real money in any wallet used here.
- **Only Sai sends Sepolia transactions.** Coding agents should not run deployments or transactions on Sepolia unless asked.
- **Commit and push only when asked.**
- **Don't hand-edit numbers in the notebook.** Change the inputs and re-run it. Numbers that disagree with the contracts cost us marks.
- **Be open about what is mock.** The report must state the limits above, and should not present the demo as a real weekend.
- **Keep a note of how AI is used.** Course policy is "Welcome with Attribution", and report Section 8 asks which tools we used, for what, and how we checked the output. So far, Claude Code has drafted the contracts, tests, scripts, this notebook and these documents. The team reviews them, and the tests and the Sepolia reconciliation check them.
- **Don't copy code from earlier-term projects** without attribution or the professor's approval.

## What gets submitted

- **Contracts:** every contract, including our token, on Sepolia and verified on Etherscan.
- **Repo:** shared with the professor and TA, tagged `final`, with a README.
- **`submission.json`** in the root: team, members and NetIDs, contracts, key transactions, features with evidence, video link. A feature only counts if it has evidence: a transaction hash, a file, or a moment in the video.
- **Report PDF in `docs/`, with these headings:** 1. Objective; 2. Design decisions; 3. Architecture (addresses in a table); 4. Financial analysis; 5. Testing, security and gas; 6. Going to market; 7. Summary and what you learned; 8. AI Use.
- **Financial analysis in `docs/`:** at least one number must match Sepolia.
- **Video:** narrated, every member speaks, and at least one live Sepolia transaction.

**Graded on, 5 points each:** rigor of the analysis; design decisions; scope delivered; presentation and going to market; code quality; advanced features.

**Advanced features we are claiming, and evidence still needed:**

| Feature | Evidence |
|---|---|
| Test suite with revert tests | `packages/hardhat/test/WeekendMargin.ts` |
| Keeper | `packages/hardhat/scripts/keeper.ts`. Needs a Sepolia run |
| Chainlink staleness and sign checks | `Clearinghouse.sol`, tests |
| On-chain funding settlement | Tests. **Needs a Sepolia funding payment** |
| Liquidation with a reward | Tests. **No Sepolia transaction: it needs a 25% BTC move at the demo's size.** Team to decide how to show it |
| Slither scan, gas before/after, front end | **Not done yet** |
| Weekend vault and calendar-aware margin | Needs the Sepolia demo |

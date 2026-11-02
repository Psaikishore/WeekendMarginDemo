# CLAUDE.md

@AGENTS.md

`AGENTS.md` above covers the Scaffold-ETH 2 toolchain. This file covers the project: what it is, where it stands and what to do next. New here? Read [VISION.md](VISION.md) for the idea, then [HOW_IT_WORKS.md](HOW_IT_WORKS.md), which explains every contract and formula in plain English.

## The project

An on-chain clearinghouse for Bitcoin perpetual swaps that accepts tokenized T-bills as margin and can still pay winners when the T-bill market is closed. If a loser holds only T-bill tokens over a weekend, a vault of investors' cash buys those tokens at a small discount, pays the winner at once, and redeems the tokens on Monday.

- **Course:** FRE-GY 6931 Blockchain & Cryptocurrency, Fall 2026, Prof. Richard Radnay, TA Hina Tomar. We are Team 9. Topic 2, hedging with perpetual swaps.
- **Due:** Wednesday, November 4, 2026, 11:59pm ET. Worth 30% of the grade.
- **Team:** Sai Kishore owns contracts and on-chain work. Swastik Mishra owns analysis and product (going to market).
- **The brief:** on Brightspace. It is course material, so keep it out of this public repo.

## Where things stand

As of the night of November 1, 2026 (New York time). **The final contracts are live on Sepolia and the evidence is in the repo.** Every address and key transaction is in [docs/deployments.md](docs/deployments.md), and the results are under "The live run" below. The first deployment is archived in [docs/archive/sepolia-v1](docs/archive/sepolia-v1/README.md), and nothing in the repo points at it any more.

**The contracts are frozen.** The code must match what is deployed, so changing a contract means redeploying everything and redoing the evidence, and the deployer has test ETH for only about one more full run. All remaining work is analysis, writing and the video.

| Item | Owner | Status |
|---|---|---|
| Contracts and tests | Sai | Done: 37 tests pass |
| Keeper, demo scripts, liquidation script | Sai | Done, and run on Sepolia |
| Front end | Sai | Done: margin, trade, vault, controls, economics. Every flow tested on a local chain with a test wallet. On Sepolia, the pages read the live contracts correctly, but no transaction has been sent from the site with MetaMask yet |
| Slither scan | Sai | Done: [docs/slither.md](docs/slither.md) |
| Gas, with one before/after change | Sai | Done: [docs/gas.md](docs/gas.md) |
| README | Sai | Done |
| Deploy, demo and liquidation on Sepolia | Sai | Done on November 1. See "The live run" below |
| Etherscan verification | Sai | Done: 16 of 16 contracts, confirmed through the Etherscan API. The verified source of the 15 contracts we checked is identical to the files in this repo |
| **Financial analysis** | Swastik | **First draft done:** [docs/analysis.ipynb](docs/analysis.ipynb). Needs your review. Section F reads the live contracts, and all 28 numbers match to the wei |
| **Going-to-market plan** | Swastik | The model is built (notebook Section G and the Economics page), with placeholder inputs. The plan itself isn't written |
| **Risks: BUIDL and BENJI holder restrictions** | Swastik | Not started |
| Report PDF (`docs/`) | Both | Not started. Use LaTeX |
| Video, with every member speaking | Both | Not started |
| `submission.json` | Sai | Written and checked: it matches the brief's template, and all 16 addresses and 8 transactions were confirmed on Sepolia. **The video link is still empty.** Add it with `VIDEO_URL=https://... yarn evidence` |
| Repo shared with the professor and TA, tag `final`, Brightspace upload | Both | Not done. The tag goes on last, because the repo at that tag is what gets graded |

**What's left, in order:**

1. **Swastik:** review the analysis, replace the `goToMarket` placeholders, and write the going-to-market plan, the BUIDL and BENJI risks, and report Section 4.
2. **Sai:** send one transaction from the live site with MetaMask, which hasn't been tried yet.
3. **Both:** record the video, with every member speaking and at least one live transaction (see "Commands").
4. **Sai:** after recording, run `VIDEO_URL=... yarn evidence`, re-run the notebook and commit, because the recording adds new transactions.
5. **Both:** finish the report PDF in `docs/`, share the repo, tag `final`, and have one person upload the report and `submission.json` to Brightspace by the deadline.

## Swastik: start here

1. Read [VISION.md](VISION.md), then this file.
2. Set up and run the notebook (see "Setup"). Everything needed is in the repo, and you don't need any keys. Section F reads the live contracts over the internet, for free.
3. Read each "Reading the results" section in the notebook, and challenge every assumption. **All of them are in [config/assumptions.json](config/README.md), so you never need to edit a code cell to change one.** The hurdle premium, redemption risk and gate loss are judgement calls you should be ready to defend.
4. Try ideas on the app's **Economics** page (`yarn start`), which recalculates as you type. When you like the numbers, press "Copy as JSON", paste into `config/assumptions.json` and re-run the notebook.
5. Write the going-to-market section. The brief asks for users, trust, promotion, business model and risks, with rough numbers on what volume covers the running costs. **The `goToMarket` inputs are made-up placeholders that only show how the model works. Replace them with numbers you can defend.** Section G then gives you the break-even hedge size.
6. Write the BUIDL and BENJI risks. Confirm the facts first. Our working understanding is that BUIDL holders must be allowlisted through Securitize, and that BENJI shares are held in KYC'd registered accounts. What it means for us: the vault and clearinghouse would need to be approved holders, vault depositors might need KYC, sBILL could only move to approved addresses (our design only sends it to the vault or the fund, never to a liquidator), and Monday redemption depends on a partnership with the issuer.
7. Write Section 4 of the report using `docs/figures/` and Section F's table, which is the required number matching Sepolia.

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
| `MarketCalendar.sol` | The real calendar: closed from Friday 21:00 to Monday 14:00 UTC, 65 hours. No admin, nobody can change it |
| `DemoCalendar.sol` | The demo calendar: an owner-only switch for "it is the weekend now". Used only by the Demo and Stress sets |
| `WeekendVault.sol` | ERC-4626 vault of tUSDC. Buys sBILL at NAV minus a discount, only from the clearinghouse and only when the market is closed. The owner can change the discount, up to a hard limit, only while the market is open. Anyone can trigger redemption on business days. Inventory is held at cost, and withdrawals are capped at cash |
| `Clearinghouse.sol` | Deposits, offers, bilateral trades, settlement, funding, liquidation. Ownable, Pausable, ReentrancyGuard |

**Settlement.** Anyone can call `settle(tradeId)`. It pays the price change plus funding from the loser to the winner in tUSDC. If the loser runs out of tUSDC, its sBILL is converted: through the fund on weekdays, or sold to the vault when the market is closed.

**Liquidation.** Anyone can call `liquidate(tradeId)` when, after settlement, either side's margin is below maintenance. The caller earns 0.5% of notional, and the whole trade closes.

**Settings.** These come from [config/protocol.json](config/README.md) at deployment. If a document disagrees with the contract, the contract wins.

| Setting | Value |
|---|---|
| Initial / maintenance margin | 20% / 10% of notional |
| sBILL haircut | 1% weekdays, 3% when the market is closed |
| sBILL interest | 4% a year, simple |
| Vault discount | 10bp to start. The owner can change it up to 1%, only while the market is open |
| Liquidation reward | 0.5% of notional |
| Funding | Posted by the owner, capped at 0.1% per hour, applying only from the moment it's posted. Positive means longs pay shorts |
| Oldest accepted price | 2 hours (the feed updates about hourly) |

## On Sepolia

The Chainlink BTC/USD feed is `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43`. Addresses and transactions are in [docs/deployments.md](docs/deployments.md), which `yarn evidence` writes. ABIs are in `packages/hardhat/deployments/sepolia/`.

| Set | Calendar | BTC price | What it's for |
|---|---|---|---|
| **Main** (no prefix) | Real, nobody can change it | Chainlink | The production design. No trades, empty vault |
| **Demo** | Owner's switch | Chainlink | The demo, video and reconciliation. 50,000 tUSDC in the vault, Fund A short vs Trader B long, and Fund C long vs Trader D short, each 1 BTC with 30,000 margin. The funds post sBILL and the traders post tUSDC, so whichever way BTC moves, one sBILL-backed fund has to pay |
| **Stress** | Owner's switch | **Mock, anyone can move it** | Showing a liquidation, which would need a 25% BTC move at the demo's size. **The report must say this price is a mock** |

Every demo transaction hash is logged in `packages/hardhat/demo-log.sepolia-demo.json` and `demo-log.sepolia-stress.json`, and `yarn evidence` turns them into `submission.json`.

## The live run

`yarn onchain:all` ran on Sepolia on November 1, New York time (November 2 UTC).

| What it shows | Result | Proof |
|---|---|---|
| Weekend path, demo set | BTC moved from $78,025.31 to $78,462.47, so Fund A owed $437.16. The vault paid that for 437.59 sBILL, the winner was paid at once, and the vault redeemed the sBILL for $437.59, a **$0.44 profit** | [settlement](https://sepolia.etherscan.io/tx/0x6386b7da7d301f822b1ec2765c585bdf6cf096c73d5575d25d15e22d9153d89c), [redemption](https://sepolia.etherscan.io/tx/0x73bd20e396b21f742f633ad33bb5f621f5b636439dbd4e22dc82411eda14c813) |
| Funding | Paid in each settlement, using the rate from Deribit: about $0.008 per trade in the weekend settlement | The settlement above, `FundingApplied` event |
| Keeper | One pass posted funding and settled both trades | [keeper settlement](https://sepolia.etherscan.io/tx/0xab77d5949d13654c01c898635aacaaef394ff454e6cc583a3ffd858b6cf55557) |
| Liquidation, stress set with a **mock price** | The model predicted $93,364.46. The contract refused at 0.1% below and accepted at 0.1% above. Trader D earned $467.29, and the vault later made $10.94 | [liquidation](https://sepolia.etherscan.io/tx/0x4036f3cc7c2febb3abf3a7e4524d3040effc0cc84fe92f96e1217121b6ee146b) |
| Real calendar, main set | During the real weekend, at 02:18 UTC on Monday, it read closed, and a simulated sBILL purchase failed with `MarketClosed` | Read from the contract, and shown on the site |
| Reconciliation | All 28 numbers match the chain to the wei | Notebook Section F, `docs/data/sepolia_reconciliation.csv` |

The vault's profit is small because BTC moved only 0.56% and just 0.9% of the vault's cash was used. That is the analysis's finding about idle cash, seen live.

**What went wrong, which the report should say:**

- **The liquidation step took three tries, because of two script bugs. The contracts behaved correctly each time.** The script first misread the contract's refusal, because it expected the wrong error code. Then a [mock price update ran out of gas](https://sepolia.etherscan.io/tx/0x463025497e01ff34a10aa3bce9aa63964ff7237a3b9e5bf18edce2888dfcfdee), because the gas estimate came out too low (explained in [docs/gas.md](docs/gas.md)). Both are fixed. As a result, the stress log shows the "just below" price three times, and the mock feed has one failed transaction.
- **Etherscan's rate limit** rejected many verification requests on the first pass. A slower retry verified them, and `yarn verify` now waits between requests.
- **Sepolia gas is far above the local numbers,** about 3.5 times for `acceptOffer` and about 7 times for deploying `Clearinghouse`. A full run cost about 0.0067 SepoliaETH, and the deployer has about 0.0079 left. See [docs/gas.md](docs/gas.md).

**Not tested on Sepolia yet:**

- Sending a transaction from the site with MetaMask. The site reads the live contracts correctly, and every flow was tested on a local chain with a test wallet.
- A repeat run of the weekend story. Its first step withdraws the fund's spare tUSDC, with a fixed gas limit added after the live run. That has only run locally, so the first video take will be its first live use.

## What the professor asked for

| Feedback on the proposal | Where it is answered |
|---|---|
| Financial analysis: hedged vs unhedged P&L, funding, liquidation price, and vault economics, including the discount needed given the T-bill yield and weekend price risk | Notebook, Sections A-E |
| A going-to-market plan | Report Section 6. **Not written yet.** The numbers come from notebook Section G |
| Build the end-to-end path first | Done in that order. Say so in the report |
| How does "weekend" work on Sepolia, and who can change the calendar? Staleness limit above 1 hour | Two calendars (below), and a 2-hour limit |
| Risks: BUIDL and BENJI holder restrictions | Risks section only, by team decision: no allowlist code. **Not written yet** |

The proposal was not resubmitted; these points go into the final project.

## Design decisions

These are for report Section 2, which asks what we chose, what we considered instead, and what changed along the way.

- **Bilateral trades, not a pool.** Each trade has one long and one short, so losses are never spread across other users. The cost: when one side is liquidated, the other side's hedge ends too.
- **Packed storage. Changed because of gas measurements.** Opening a trade cost 244,696 gas, mostly new storage slots, so we fit the trade into three slots instead of six. That saved 27% locally. Measured live on Sepolia, `acceptOffer` fell 33.6% and `postOffer` 27.3%. See [docs/gas.md](docs/gas.md).
- **Funding as a running total. Changed after reading the code.** The first version multiplied the current rate by all the time since the last settlement, so the owner could post a high rate and charge it backwards over a long gap: 72% of a position over 30 days at the cap. Now a rate applies only from the moment it's posted.
- **A 65-hour calendar. Changed so the contract matches the analysis.** The first version closed for 48 hours, Saturday and Sunday in UTC, while the analysis used the real 65-hour closure. Now both use 65.
- **Adjustable discount within a hard limit. Changed after the analysis.** The right discount depends on T-bill yields, and the analysis showed 10bp is too low for a real vault. So the owner can change it, but only up to 1%, only while the market is open, and the limit can't exceed the weekend haircut.
- **A third set of contracts with a mock price.** A real liquidation would need a 25% BTC move. Tests alone would be weaker evidence, and the rubric wants features to work on Sepolia. So a clearly labelled set shows it. The script also checks our formula: the contract refuses 0.1% below the predicted price and accepts 0.1% above it.
- **Fixed NAV instead of a posted NAV. Changed from the proposal.** A keeper posting NAV would be another trusted role. A fixed 4% has none, but it can't show T-bill price risk on-chain.
- **Two calendars. Changed during the build.** We first gave `MarketCalendar` a fixed time offset for the demo, but that only shifts which real days count as the weekend, so the demo depended on the recording day. Now the real calendar has no admin, and a separately labelled demo copy has a switch. **The report must say that the deployer controls the demo's switch.**
- **2-hour staleness limit.** It sits above the feed's 1-hour heartbeat, so a normal gap doesn't stop settlement.
- **Vault inventory held at cost, withdrawals capped at cash.** The share price rises only when a discount is actually realised, and a depositor can't drain cash that is owed elsewhere.
- **Two mirrored demo trades.** With one trade, a price move in the wrong direction wouldn't touch the vault.
- **Deribit for funding.** The brief names BitMEX, but its API returns 403 from our US network.
- **Sepolia gas price of 0.05 gwei.** The default tip was draining a small test wallet.
- **10bp discount.** This was our estimate before the analysis, and it's what we deploy with. It covers the risk of each use, but not the cost of cash waiting (see below).

**Known limits.** sBILL is a mock. Funding is posted by the owner, not set by a market. There is no insurance fund, so a loss beyond a deposit underpays the winner, and a liquidator's reward can be $0 in that case. Each account has one market and one position, and liquidation is full only. Either side can close a trade, which ends the other side's hedge. The calendar has no holidays and doesn't move for daylight saving. Someone can time a vault deposit just before Monday's redemption to collect a share of the profit.

**When things fail.** If the vault lacks cash, `settle()` and `liquidate()` revert until cash arrives or the market reopens. If the feed is stale, settlement, liquidation, and withdrawals from accounts with an open trade all revert until a fresh price arrives. Both are safe failures, but they are real, and the report's trust section should say so.

## What the analysis found

The numbers are in [docs/analysis.ipynb](docs/analysis.ipynb), with the data in `docs/data/` and charts in `docs/figures/`.

1. **The hedge works at modest leverage.** At the demo's 2.6x, it removes 92% of 30-day variance, and earns about $340 a month per BTC with typical funding.
2. **Liquidation is the main threat.** With no top-ups, the short at 2.6x is liquidated in 14% of 30-day windows, and at 4.9x in about half.
3. **BTC isn't riskier per hour on a weekend.** Hourly volatility is 0.52% in closures and 0.68% outside. The 99% move over a 65-hour closure is +11.1% and -13.0%.
4. **10bp covers each use but not idle cash.** The required discount per use is 6.6bp (base) and 13.2bp (stress). But a vault sized for 99% of weekends earns 1.2-1.7% a year against 4.01% on T-bills. It needs 28-44bp serving both longs and shorts, or a way to earn on idle cash.
5. **The fund gains up to 42bp,** compared with holding a cash buffer. So a price that suits both sides exists, but the room is narrow.
6. **Reconciliation:** on Sepolia, all 28 numbers match to the wei. On a local chain, with repeated demos, rate changes, a discount change and a liquidation, all 51 matched too.

**Decision made:** we deployed with 10bp and report this result openly. If the team prefers a higher discount, the owner can change it on the Controls page without a redeploy, and `vaultDiscountBps` in `config/protocol.json` must then be updated to match.

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

**On Sai's machine,** Node 22 and Yarn are in the `crypto` mamba environment. A new shell says `yarn: command not found` until that environment is active.

## Commands

**Try everything on a local chain.** No keys are needed, and the mock price moves by itself. Run `yarn chain` in one terminal, then:

```bash
yarn onchain:all --network default
NEXT_PUBLIC_USE_LOCAL_CHAIN=true yarn start
```

Clean up afterwards: delete `packages/hardhat/deployments/default` and `packages/hardhat/demo-log.default-*.json`, then run `git checkout packages/nextjs/contracts/deployedContracts.ts`.

**To see the live site,** run `yarn start` without the local-chain flag. It reads Sepolia, and you need a wallet only to send transactions.

**On Sepolia (Sai only, needs the deployer password). Already done, so don't run this unless a contract changes.** It deploys and verifies all three sets, sets up the demo, runs the weekend story, a keeper pass and the liquidation, then writes `submission.json` and `docs/deployments.md`. The weekend story can wait up to an hour for a new Chainlink price. If a step fails, it says how to resume, for example `START_AT=9 yarn onchain:all`.

```bash
yarn onchain:all
```

**For the video,** you can re-run the weekend story at any time. It asks for the deployer password, and can wait up to an hour for a new Chainlink price, so start it before you plan to record. `DEMO_PAUSE=1` waits for Enter between steps, so you can narrate.

```bash
DEMO=true DEMO_PAUSE=1 yarn demo:weekend --network sepolia
```

**After any new Sepolia transactions,** run `yarn evidence` and re-run the notebook, which rewrites Section F's table. Both are read-only and need no password:

```bash
jupyter nbconvert --to notebook --execute --inplace docs/analysis.ipynb
```

**Add the video link when you have it:**

```bash
VIDEO_URL=https://your-video-link yarn evidence
```

**Other things worth knowing.** `yarn check-types` shows errors in the template's own `rocketh/*.ts` files, which you can ignore. Tests live in `packages/hardhat/test/WeekendMargin.ts`. By team decision, `deployedContracts.ts` keeps the local-chain (31337) entries from Sai's last rehearsal alongside the Sepolia ones. They don't affect the live site, and those addresses exist only on a local chain that has been deployed to, so run the local commands above before using the local-chain flag.

## Rules

- **Never commit or print secrets.** `packages/hardhat/.env` holds the encrypted deployer key, the demo wallets' mnemonic and the Etherscan API key. It is git-ignored and exists only on Sai's machine.
- **This repo is public,** and it's graded at the tag `final`. Never put real money in any wallet used here.
- **Only Sai sends Sepolia transactions.** Coding agents should not run deployments or transactions on Sepolia unless asked. Reading Sepolia is fine: the notebook and the site need no keys. The password is typed by a person, never by an agent.
- **Don't change anything in `packages/hardhat/contracts/`.** See "Where things stand".
- **Commit and push only when asked.**
- **Don't hand-edit numbers in the notebook.** Change `config/assumptions.json` and re-run it. Numbers that disagree with the contracts cost us marks.
- **Be open about what is mock.** The report must state the limits above, and should not present the demo as a real weekend.
- **Keep a note of how AI is used.** Course policy is "Welcome with Attribution", and report Section 8 asks which tools we used, for what, and how we checked the output. So far, Claude Code has drafted the contracts, tests, scripts, front end, notebook and these documents. It also watched the live run and diagnosed and fixed its script bugs, while Sai approved each on-chain command and typed the password. The team reviews the work, and the tests and the reconciliation check it.
- **Don't copy code from earlier-term projects** without attribution or the professor's approval.

## What gets submitted

- **Contracts:** every contract, including our token, on Sepolia and verified on Etherscan.
- **Repo:** shared with the professor and TA, tagged `final`, with a README.
- **`submission.json`** in the root: team, members and NetIDs, contracts, key transactions, features with evidence, video link. A feature only counts if it has evidence: a transaction hash, a file, or a moment in the video.
- **Report PDF in `docs/`, with these headings:** 1. Objective; 2. Design decisions; 3. Architecture (addresses in a table); 4. Financial analysis; 5. Testing, security and gas; 6. Going to market; 7. Summary and what you learned; 8. AI Use.
- **Financial analysis in `docs/`:** at least one number must match Sepolia.
- **Video:** narrated, every member speaks, and at least one live Sepolia transaction.

**Graded on, 5 points each:** rigor of the analysis; design decisions; scope delivered; presentation and going to market; code quality; advanced features.

**Advanced features we are claiming.** `yarn evidence` fills these into `submission.json`, including the transaction hashes.

| Feature | Evidence |
|---|---|
| Test suite with revert tests | `packages/hardhat/test/WeekendMargin.ts` |
| Slither scan, each finding fixed or explained | [docs/slither.md](docs/slither.md) |
| Gas, with a change made because of it | [docs/gas.md](docs/gas.md) |
| Front end | `packages/nextjs/app`, and the video |
| Keeper | `packages/hardhat/scripts/keeper.ts`, [Sepolia transaction](https://sepolia.etherscan.io/tx/0xab77d5949d13654c01c898635aacaaef394ff454e6cc583a3ffd858b6cf55557) |
| Chainlink staleness and sign checks | `Clearinghouse.sol`, tests |
| On-chain funding settlement | Tests, [Sepolia transaction](https://sepolia.etherscan.io/tx/0x6386b7da7d301f822b1ec2765c585bdf6cf096c73d5575d25d15e22d9153d89c) |
| Liquidation with a reward, plus a keeper | Tests, [Sepolia transaction on the stress set](https://sepolia.etherscan.io/tx/0x4036f3cc7c2febb3abf3a7e4524d3040effc0cc84fe92f96e1217121b6ee146b) |
| Weekend vault and calendar-aware margin | Tests, [Sepolia transaction](https://sepolia.etherscan.io/tx/0x6386b7da7d301f822b1ec2765c585bdf6cf096c73d5575d25d15e22d9153d89c) |

# Financial Analysis Guide

Owner: Swastik. Due with the project: Wed Nov 4, 11:59pm ET.

**Status, Oct 30:** a first draft of everything below is built in [analysis.ipynb](analysis.ipynb). The data sources are tested and the data is saved in `docs/data/`. This guide stays as the plan and the formulas; the notebook has the results. What's left: review the assumptions, and re-run Section F after the Sepolia demo.

**Goal:** answer two questions with numbers.

1. How well does the Bitcoin hedge work, and what do funding and liquidation cost?
2. What discount must the weekend vault charge, and is using it cheaper than keeping idle cash?

**Deliverables**

- `docs/analysis.ipynb` (or an Excel workbook): the brief requires one of these in `docs/`.
- Charts and tables for Section 4 of the report, "Financial analysis", with every assumption stated.

The rubric rewards correct formulas, stated assumptions, sensitivity tests and model numbers that match the contracts.

## 1. Contract settings to use

These come from `packages/hardhat/deploy/00_deploy_weekend_margin.ts`. If they change, the contract values win.

| Setting | Value |
|---|---|
| Initial margin | 20% of notional |
| Maintenance margin | 10% of notional |
| sBILL haircut | 1% weekdays, 3% weekends |
| sBILL interest | 4% a year, simple |
| Vault discount | 0.10% below NAV |
| Liquidation reward | 0.5% of notional |
| Funding rate cap | 0.1% per hour |
| Oldest accepted price | 2 hours |
| Demo positions | 1 BTC; 30,000 margin per account; 50,000 tUSDC in the vault |

The weekend in the contract is Saturday 00:00 to Monday 00:00 UTC (48 hours). A real market closure, Friday 4pm to Monday 9:30am ET, is about 65 hours. Use 65 hours for the economics, and state this difference in the report.

## 2. Data

| Data | Suggested source | Notes |
|---|---|---|
| BTC hourly prices | Coinbase Exchange candles, `BTC-USD`, 3600-second granularity | Returns at most 300 candles per request, so page through |
| Funding history | Deribit `public/get_funding_rate_history`, `BTC-PERPETUAL` | The BitMEX API returned 403 on our US network. Try BitMEX first because the brief names it, and state which source you used |
| T-bill yield | FRED series `DTB3` | Quoted in percent per year |

All three endpoints work, and the notebook saves their data to `docs/data/`. BitMEX still returned 403 on Oct 30, so the notebook uses Deribit.

## 3. Analyses

### A. Hedged vs unhedged P&L (required)

Take a fund that owns 1 BTC bought at `P0`, across BTC moves from -50% to +50%.

```text
Unhedged P&L = P1 - P0
Short perp P&L = -(P1 - P0) + funding received
Hedged P&L = funding received + sBILL interest - vault costs
```

Positive funding means longs pay shorts. Show:

- one chart of hedged vs unhedged P&L;
- funding over a typical month and a stressed month, using the history;
- the moves at which the hedge is liquidated. A liquidated hedge leaves the fund unhedged, so show that case too.

### B. Liquidation price (required)

`D` is the deposit, `h` is the share of it that counts as margin (`1 - haircut`; 1 for tUSDC), and `m` is 10%.

```text
Short: P_liq = h(D + P0) / (m + h)
Long:  P_liq = h(P0 - D) / (h - m)
```

These ignore funding, interest and the vault discount. Example: `D` = 30,000, `P0` = 83,000 and `h` = 0.99 give a short liquidation price of about $102,633.

Make a table at 2x, 5x and 10x leverage (`D` = notional / leverage) for tUSDC, weekday sBILL and weekend sBILL. Note that 10x (10% margin) can't open under the 20% initial margin rule, and 5x is the limit. Show 10x as a comparison and say so.

### C. Weekend vs weekday risk

Using the hourly data, compare BTC moves over the weekend closure with weekday overnight moves.

- Report the standard deviation, 99% VaR and expected shortfall for each.
- Test the square-root-of-time rule: does risk grow with the square root of the horizon?
- Use the results to test whether the 20% and 10% margins and the haircuts are enough. Recommend changes if they aren't.

### D. Vault economics (the professor asked for this)

```text
Required discount = carry + T-bill price risk + redemption risk

carry            = hurdle rate x hours / 8760
T-bill price risk = duration x weekend yield shock
redemption risk  = chance of delayed redemption x cost of the delay
```

Example: a 4% hurdle over 65 hours gives a carry of about 3 basis points. Duration of 0.25 years with a 25bp shock gives about 6 basis points. Those two already total about 9, against our 10bp discount. Replace these placeholder inputs with estimates you can defend.

Then show:

- **Vault return:** discount x share of cash used x weekends per year (about 52), plus T-bill interest earned while holding the sBILL.
- **Sensitivity:** return against discount and usage, as a table or heatmap. Vary the yield and shock too.
- **Vault size:** 99% weekend BTC move x open interest margined in sBILL. If the vault runs short, `settle()` reverts, so this number matters.

### E. Vault vs idle cash

For a fund with a given margin balance, compare over a year:

```text
Idle cash:   interest = 0
sBILL + vault: T-bill interest - (discount x sBILL sold on weekends)
```

Use the historical weekend moves to estimate how much sBILL gets sold. Find the break-even discount, where the two are equal.

**Stress test:** run October 10-11, 2025 through the model. How much would the vault have had to pay, and would 50,000 tUSDC have been enough for the demo size?

### F. Reconcile with Sepolia (required)

The brief requires at least one model number to match a deployed contract. The notebook checks every number it can:

```text
nav             = 1 + 0.04 x seconds since deployment / (365 x 86400)
amount due      = size x |price - last price| (plus or minus funding)
funding         = notional x hourly rate x elapsed seconds / 3600
vault price     = nav x 0.999
sBILL sold      = amount paid / vault price (rounded up)
```

Contracts use whole-number maths with 18 decimals, so use Python integers (not floats) to match exactly, and round the way the contract does. Most inputs come from events:

- `Settled`, `FundingApplied` and `CollateralConverted` on the clearinghouse;
- `SBillPurchased` and `InventoryRedeemed` on the vault.

Transaction hashes are in `packages/hardhat/demo-log.sepolia-demo.json`. Show model value, on-chain value and difference in a table, with the Etherscan link for each.

## 4. Limits to state in the report

- sBILL is a mock: it has a fixed 4% rate, no T-bill price risk on-chain, and pays interest from a pre-funded reserve.
- Funding is posted by the owner within a cap, not set by a market.
- There is no insurance fund, so a loss beyond a deposit underpays the winner.
- Positions are simple: one market, one position per account, full liquidation only.
- Real tokenized funds restrict who can hold them (the risks section will cover BUIDL and BENJI).

## 5. Suggested order

1. Download the data and do A and B. They don't need anything deployed.
2. Do C, then D and E.
3. Do F once Sepolia transactions exist.
4. Write Section 4 of the report and send the charts to Sai.

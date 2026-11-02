# Configuration

Every number you might want to change is in this folder, so nobody has to edit code to try a different assumption. For how the pieces fit together, see section 10 of [HOW_IT_WORKS.md](../HOW_IT_WORKS.md).

## `assumptions.json`: the analysis's judgement calls

**Swastik owns this file.** The notebook and the app's Economics page both read it. To change it, edit it directly, or move the inputs on the Economics page and press "Copy as JSON". Then run the notebook again.

| Field | Meaning |
|---|---|
| `demoPosition.entryPrice` | BTC price for the reference position in Sections A, B and E. About where the demo opened |
| `demoPosition.marginUsd` | Margin on that position. Sets the leverage |
| `demoPosition.vaultCashUsd` | Vault size in the stress test |
| `market.closureHours` | How long the T-bill market is shut. 65 is what the real calendar contract uses |
| `market.overnightHours` | A weekday overnight, for the risk comparison in Section C |
| `market.weekendsPerYear` | |
| `market.holdDays` | How long the fund keeps its hedge in Sections A and B |
| `vaultInvestor.hurdlePremium` | What vault investors want above T-bills, for taking contract and liquidity risk. **A judgement call** |
| `vaultInvestor.longWeekendsPerYear` | Weekends with a Monday holiday |
| `vaultInvestor.longWeekendExtraHours` | The extra time cash is tied up on those weekends |
| `vaultInvestor.fundGatesOncePerYears` | How rarely a real T-bill fund delays redemption. **A judgement call** |
| `vaultInvestor.gateLoss` | What the vault loses if that happens. **A judgement call** |
| `vaultInvestor.cases` | The low, base and stress cases: investor premium, T-bill duration, and which percentile of weekend yield moves to use |
| `fund.hedgeNotionalUsd` | Hedge size for the fund comparison in Section E |
| `goToMarket.*` | Inputs to Section G. **All of these are placeholders for Swastik to replace.** They're round numbers that show how the model works, not estimates from any source |

## `protocol.json`: what the contracts are deployed with

The deploy script reads this file. The notebook reads it too, and Section F stops with an error if it disagrees with the chain, because the contract values win.

| Field | Meaning | Can it change after deployment? |
|---|---|---|
| `sBillApyBps` | sBILL's interest, 400 = 4% | No |
| `vaultDiscountBps` | Starting vault discount, 10 = 0.10% | Yes: the owner can, up to the limit, while the market is open |
| `vaultMaxDiscountBps` | Hard limit on the discount. Can't exceed the weekend haircut | No |
| `fundInterestReserve` | tUSDC minted to the fund to pay interest | No |
| `maxPriceAgeSeconds` | Oldest Chainlink price accepted. Must be above 3600 | No |
| `initialMarginBps` | Margin to open a trade or withdraw | No |
| `maintenanceMarginBps` | Below this, you can be liquidated | No |
| `weekdayHaircutBps`, `weekendHaircutBps` | How much less sBILL counts for as margin | No |
| `liquidationRewardBps` | Liquidator's reward, as a share of the position. Must be below maintenance margin | No |
| `maxFundingBpsPerHour` | Cap on the funding rate the owner can post | No |

**To change a "No" field,** edit the file and deploy a new set under a new name:

```bash
DEMO=true DEPLOY_PREFIX=Demo2 yarn deploy --network sepolia
```

The vault links to its clearinghouse once, for good. So if you re-deploy under the *same* name after changing a setting, the script stops with an error instead of leaving you with a broken set.

## `analysis_results.json`: what the notebook found

The notebook writes this file. **Don't edit it by hand.** It holds the numbers that come from market data, such as the T-bill yield and how much of the vault gets used, so that the Economics page can start from them.

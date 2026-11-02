# Security scan with Slither

Slither 0.11.6, on every contract in `packages/hardhat/contracts/` except the test mock, with the same compiler as the deployment (solc 0.8.30).

**Result: 26 findings on our code. We fixed 4, and each of the other 22 is explained below as a false positive or an accepted design choice.** None of them is an exploitable bug.

| Severity | Before | After |
|---|---:|---:|
| High | 1 | 1 |
| Medium | 9 | 8 |
| Low | 14 | 12 |
| Informational | 2 | 1 |

"Before" counts findings in our own files, not OpenZeppelin's. It leaves out three informational notes about mixed `pragma` versions, which are about the library's files.

## How to run it

```bash
pip install slither-analyzer solc-select
solc-select install 0.8.30 && solc-select use 0.8.30
cd packages/hardhat
slither contracts/Clearinghouse.sol --solc-remaps "@openzeppelin=$PWD/node_modules/@openzeppelin" --filter-paths node_modules
```

Repeat for each contract file. `--filter-paths node_modules` hides findings inside OpenZeppelin.

## What we fixed

| Finding | Where | The fix |
|---|---|---|
| `uninitialized-local` (Medium) | `Clearinghouse.liquidate`: `address account` was declared with no value and set in a branch | Rewrote it, so the check comes first and the variable is set once |
| `shadowing-local` (Low), twice | `WeekendVault.maxWithdraw` and `maxRedeem`: a parameter called `owner` hid the `owner()` function | Renamed the parameter to `holder` |
| `unindexed-event-address` (Informational) | `WeekendVault.ClearinghouseSet` | Made the address `indexed` |

We also reduced a `reentrancy-no-eth` finding. `_settle` now updates the trade's price, funding total and time **before** any token moves. See below for why the finding remains.

## What we looked at and kept

| Finding | Where | Why it's fine |
|---|---|---|
| `weak-prng` (High) | `MarketCalendar.secondsIntoWeek` | False positive. Slither sees `%` on a timestamp and assumes someone is generating a random number. This is arithmetic to find the time of the week, and no randomness is involved |
| `reentrancy-no-eth` (Medium), 4 | `closeTrade`, `liquidate`, `_settle`, `_collect` | State is written after calls to the vault and sBILL. Every entry point is `nonReentrant`, those contracts are our own and fixed at deployment, and the ERC-20 tokens here have no hooks, so no outside code can run during the call. `_settle` updates the trade before the calls, and sBILL is deducted from the account before being sold |
| `incorrect-equality` (Medium), 3 | `redeemInventory` (`shares == 0`), `_settle` (`amountDue == 0`), `unsettledPnl` (`tradeId == 0`) | False positive. Slither warns about exact comparisons because a balance can be nudged by a stray transfer. Each of these is a "nothing to do" check. Sending the vault one wei of sBILL only means `redeemInventory` redeems it, and a trade ID can't be influenced from outside |
| `unused-return` (Medium) | `_price` | Deliberate. `latestRoundData` returns five values, and we check four. `startedAt` adds nothing once `updatedAt` is checked |
| `missing-zero-check` (Low) | `setClearinghouse` | Harmless. If zero were passed, the link would stay unset and the owner could call it again. The deploy script checks the link, and it can't be changed once set |
| `reentrancy-events` (Low) | `redeemInventory` | The event is written after the call to sBILL, our own contract. `inventoryCost` is already zeroed before that call |
| `timestamp` (Low), 10 | NAV, funding, the calendar, the staleness check, the faucet | The system depends on the clock by design. Validators can move a block's time by a few seconds. At 4% a year that changes NAV by a tiny fraction of a cent, and a few seconds at the edge of the weekend changes nothing that matters |
| `solc-version` (Informational) | `pragma ^0.8.20` | The pragma allows older compilers with known bugs, but the project compiles with exactly 0.8.30, set in `hardhat.config.ts` |

**OpenZeppelin's own files** produce further findings, such as `incorrect-exp` in `Math.mulDiv`. The `^` there is intended (the library's comment explains it), and the library is audited, so we didn't change it.

## What Slither didn't find

A scanner looks for known code patterns. It can't tell whether the finance is right. Reading the code found three things it missed, all now fixed:

1. **Funding applied backwards in time.** On a trade left unsettled for 30 days, the owner could post the maximum rate and instantly charge 72% of the position. A new rate now only applies from the moment it's posted, and a test covers it.
2. **Nothing tied the discount to the haircut.** The clearinghouse now refuses to deploy unless the weekend haircut is at least the vault's maximum discount.
3. **The calendar disagreed with the analysis.** The contract used a 48-hour weekend, and the analysis 65 hours. Both now use 65.

Known limits that remain are listed in section 12 of [HOW_IT_WORKS.md](../HOW_IT_WORKS.md).

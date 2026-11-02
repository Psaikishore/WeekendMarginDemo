# Gas

Measured with `yarn test`, which runs the Hardhat tests with `--gas-stats`.

## The change we made because of it

**What the first measurement showed.** At commit `4ad4251`, opening a trade cost 244,696 gas, by far the most expensive thing a user does. The cause was storage. A new storage slot costs about 22,100 gas, and the `Trade` struct used six slots, most of them far larger than they needed to be. A `bool` took a whole slot, and a timestamp took 32 bytes when 5 will do.

**What we changed.** We reordered and narrowed the fields so that `Trade` fits in three slots and `Offer` in one. `SafeCast` reverts if a value ever doesn't fit, and the ranges are far beyond anything real: `size` as `uint96` holds billions of BTC, and `lastSettledAt` as `uint40` lasts until the year 36812.

```solidity
// Before: six slots                // After: three slots
struct Trade {                      struct Trade {
    address long;                       address long;          // slot 1
    address short;                      uint40 lastSettledAt;  // slot 1
    uint256 size;                       bool open;             // slot 1
    uint256 lastPrice;                  address short;         // slot 2
    uint256 lastSettledAt;              uint96 size;           // slot 2
    bool open;                          uint128 lastPrice;     // slot 3
}                                       int128 lastFunding;    // slot 3
                                    }
```

**Before and after.** These two columns come from the same 25 tests, so they compare like with like. The only difference is the packing.

| Function | Before | After packing | Saved | Saved % |
|---|---:|---:|---:|---:|
| `acceptOffer` (opens a trade) | 244,696 | 179,359 | 65,337 | 26.7% |
| `postOffer` | 125,021 | 103,090 | 21,931 | 17.5% |
| `settle`, paid in tUSDC | 71,706 | 65,977 | 5,729 | 8.0% |
| `settle`, through the vault | 168,527 | 162,798 | 5,729 | 3.4% |
| `closeTrade` | 114,845 | 111,013 | 3,832 | 3.3% |
| `liquidate` | 168,231 | 164,484 | 3,747 | 2.2% |
| Deploying the clearinghouse (once) | 2,478,887 | 2,602,307 | -123,420 | -5.0% |

The first row matches the theory: three fewer new slots at 22,100 gas each is 66,300, and we saved 65,337. Packing costs a little more at deployment, for its extra code, and a position only has to open twice to earn that back.

**Then we spent some of it on a correctness fix.** A later review found that a new funding rate applied backwards in time, so we replaced the calculation with a running total. Each trade now stores one more value. Packing kept it in the same three slots, where a fourth slot would have added 22,100 gas to every trade opened. We accepted the cost, because a correct number is worth more than 6,000 gas.

| Function | After packing | With the funding fix | Added |
|---|---:|---:|---:|
| `acceptOffer` | 179,359 | 185,299 | 5,940 |
| `settle`, paid in tUSDC | 65,977 | 72,188 | 6,211 |
| `settle`, through the vault | 162,798 | 171,829 | 9,031 |
| `setFundingRate` | 46,961 | 54,667 | 7,706 |

Opening a trade is still 24% cheaper than where we started.

## What the main functions cost now

From `yarn test`, using the median for each function. The ETH column uses an example gas price of 10 gwei, so scale it for any other price. Our Sepolia transactions use 0.05 gwei.

| Function | Gas | ETH at 10 gwei |
|---|---:|---:|
| `Clearinghouse.acceptOffer` | 185,299 | 0.00185 |
| `Clearinghouse.settle`, through the vault | 171,829 | 0.00172 |
| `Clearinghouse.liquidate` | 170,636 | 0.00171 |
| `WeekendVault.deposit` | 108,810 | 0.00109 |
| `Clearinghouse.postOffer` | 103,061 | 0.00103 |
| `Clearinghouse.withdrawUsdc` | 95,225 | 0.00095 |
| `SBill.subscribe` | 90,745 | 0.00091 |
| `Clearinghouse.depositUsdc` | 84,143 | 0.00084 |
| `Clearinghouse.depositSBill` | 79,285 | 0.00079 |
| `Clearinghouse.settle`, paid in tUSDC | 72,188 | 0.00072 |
| `WeekendVault.withdraw` | 59,619 | 0.00060 |
| `WeekendVault.redeemInventory` | 57,535 | 0.00058 |
| `Clearinghouse.setFundingRate` | 54,667 | 0.00055 |
| `SBill.redeem` | 46,034 | 0.00046 |

The settle through the vault figure is the most expensive case measured for that function, because it includes the sBILL sale.

Deployment, on the local network: Clearinghouse 2,680,272; WeekendVault 1,663,630; SBill 883,720.

## The same numbers on Sepolia

Everything above comes from the local Hardhat network, which is the right place to compare two versions of the code. Sepolia charges more, and the gap is widest for deploying code and writing new storage. The figures below are `gasUsed` from the live transactions listed in `packages/hardhat/demo-log.*.json`.

**The packing change, measured live.** These are the same steps from the same script, on the first deployment and the final one. The final version also carries the funding fix.

| Step | First deployment | Final deployment | Change |
|---|---|---|---|
| `postOffer` | 403,079 | 293,219 | -27.3% |
| `acceptOffer` | 963,410 | 639,709 | -33.6% |

**Other live costs.**

| Step | Gas |
|---|---|
| Liquidation, through the vault | 546,113 |
| `settle`, through the vault (the vault's first purchase) | 406,146 |
| `settle`, paid in tUSDC | 105,282 to 203,202 |
| `setFundingRate` | 143,875 |
| `redeemInventory` | 79,398 |
| Deploying one full set of contracts | 42 to 44 million (about 0.0021 SepoliaETH at 0.05 gwei) |

**A lesson about gas estimates.** One mock price update in the live run [ran out of gas](https://sepolia.etherscan.io/tx/0x463025497e01ff34a10aa3bce9aa63964ff7237a3b9e5bf18edce2888dfcfdee). The mock stores `block.timestamp`, and this update came straight after another one. The gas estimate ran against the block holding that last update, so writing the same timestamp looked cheap, and it gave a limit of 42,672 gas when the update needs 52,297. The price did not change and no funds were involved. `demoLiquidation.ts` now sets a fixed limit for these updates, and `demoWeekend.ts` does the same for its one similar case, a withdrawal straight after a settle.

## To reproduce

The "before" column is commit `4ad4251`. Check it out in a separate copy and run `yarn test`. The contract, tests and deploy script there all use the old layout.

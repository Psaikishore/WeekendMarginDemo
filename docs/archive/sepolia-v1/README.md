# The first Sepolia deployment

This is what was on Sepolia until October 31, 2026. **It no longer matches the code.** It stays here as a record of what changed and why, which report Section 2 asks for. The full address and ABI files are in the git history, at commit `4ad4251`.

## Why we replaced it

| Change | Why |
|---|---|
| Packed the `Trade` and `Offer` storage | Measuring gas showed that opening a trade cost 244,696 gas, mostly from new storage slots. See [docs/gas.md](../../gas.md) |
| Funding became a running total | The old version applied a new rate backwards over all the time since the last settlement |
| The real calendar closes for 65 hours | The old version closed for 48 hours, which disagreed with the analysis |
| The discount can be changed, within a hard limit | The analysis showed the right discount depends on T-bill yields |

The two demo trades opened on October 30 at $77,853.66 were never settled, and the old contracts remain on Sepolia.

## Demo set

| Contract | Address |
|---|---|
| DemoClearinghouse | [`0x7dc8107086bbfd17093f54936fe719bb1cc8e41e`](https://sepolia.etherscan.io/address/0x7dc8107086bbfd17093f54936fe719bb1cc8e41e) |
| DemoMarketCalendar | [`0x890837d453b122759a8df8fb8552dc6a3adfaf50`](https://sepolia.etherscan.io/address/0x890837d453b122759a8df8fb8552dc6a3adfaf50) |
| DemoSBill | [`0xe82652b02bc9f63f79e7c958db21565b1b2a5b55`](https://sepolia.etherscan.io/address/0xe82652b02bc9f63f79e7c958db21565b1b2a5b55) |
| DemoTestUSDC | [`0xedcb92c0a4f8f501de5ecd6780d0361aa766a609`](https://sepolia.etherscan.io/address/0xedcb92c0a4f8f501de5ecd6780d0361aa766a609) |
| DemoWeekendVault | [`0x73954e6726c4c80ccb08485f74830a6210b1d618`](https://sepolia.etherscan.io/address/0x73954e6726c4c80ccb08485f74830a6210b1d618) |

## Main set

| Contract | Address |
|---|---|
| Clearinghouse | [`0x28f687ebb11fa2ef878ba9666b04a7a7ba3bbedf`](https://sepolia.etherscan.io/address/0x28f687ebb11fa2ef878ba9666b04a7a7ba3bbedf) |
| MarketCalendar | [`0xc130421bf0d52a45502a4aaea8d2983f32512031`](https://sepolia.etherscan.io/address/0xc130421bf0d52a45502a4aaea8d2983f32512031) |
| SBill | [`0x04cac5d9bbac0371a8f90cee53c1177980d5b7b8`](https://sepolia.etherscan.io/address/0x04cac5d9bbac0371a8f90cee53c1177980d5b7b8) |
| TestUSDC | [`0x6e558d2e5272e54674bcae5f7b21af8c90c42499`](https://sepolia.etherscan.io/address/0x6e558d2e5272e54674bcae5f7b21af8c90c42499) |
| WeekendVault | [`0xe713d3b67df48bab11a595880e3c1090d7a38cd2`](https://sepolia.etherscan.io/address/0xe713d3b67df48bab11a595880e3c1090d7a38cd2) |

`demo-log.sepolia-demo.json` lists its setup transactions, and `reconciliation.csv` is the notebook's check against it.

# Deployments

Written by `yarn evidence` from the files in `packages/hardhat/deployments/sepolia`. Do not edit by hand.

The Chainlink BTC/USD feed is `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43`.

## Main set

The production design: real calendar and the Chainlink price. No trades.

| Contract | Address |
|---|---|
| TestUSDC | [`0xaa171e5d4c32c015919746825a9dc7db5345816e`](https://sepolia.etherscan.io/address/0xaa171e5d4c32c015919746825a9dc7db5345816e) |
| SBill | [`0x47262f3f13b4ce7d321ffee44549e2ca6bf6dce1`](https://sepolia.etherscan.io/address/0x47262f3f13b4ce7d321ffee44549e2ca6bf6dce1) |
| MarketCalendar | [`0x553dfffb3022be731faed4f37f94e519ee207b3d`](https://sepolia.etherscan.io/address/0x553dfffb3022be731faed4f37f94e519ee207b3d) |
| WeekendVault | [`0xe3285b5999bc52d01904376fe17ca41cb3c49334`](https://sepolia.etherscan.io/address/0xe3285b5999bc52d01904376fe17ca41cb3c49334) |
| Clearinghouse | [`0x57073f0c313c0edf42a03350ca71cf2b0e734113`](https://sepolia.etherscan.io/address/0x57073f0c313c0edf42a03350ca71cf2b0e734113) |

## Demo set

The owner can switch the weekend on and off. Chainlink price.

| Contract | Address |
|---|---|
| DemoTestUSDC | [`0xfa56765d9124f42ab3b6c6bc648f3dd94a7e3de0`](https://sepolia.etherscan.io/address/0xfa56765d9124f42ab3b6c6bc648f3dd94a7e3de0) |
| DemoSBill | [`0x2aff94631070707436ef712c4a6e77ecaf4c6720`](https://sepolia.etherscan.io/address/0x2aff94631070707436ef712c4a6e77ecaf4c6720) |
| DemoMarketCalendar | [`0x03dd285f95b8e3dbd5e23149453699ce93968792`](https://sepolia.etherscan.io/address/0x03dd285f95b8e3dbd5e23149453699ce93968792) |
| DemoWeekendVault | [`0xadaea677da9e6c0a145b7458f009b9276addedba`](https://sepolia.etherscan.io/address/0xadaea677da9e6c0a145b7458f009b9276addedba) |
| DemoClearinghouse | [`0xb6c1f1fd62e393aa2bcdd31d07736daee247f906`](https://sepolia.etherscan.io/address/0xb6c1f1fd62e393aa2bcdd31d07736daee247f906) |

## Stress set

As the demo set, but the BTC price is a mock anyone can move.

| Contract | Address |
|---|---|
| StressTestUSDC | [`0x70ccd20eb29fae085edc35f5d3fd7544937b9aa3`](https://sepolia.etherscan.io/address/0x70ccd20eb29fae085edc35f5d3fd7544937b9aa3) |
| StressSBill | [`0xef88d920b75b9df5a5373354803c558d11d5c51b`](https://sepolia.etherscan.io/address/0xef88d920b75b9df5a5373354803c558d11d5c51b) |
| StressMarketCalendar | [`0xecfcd395e329df9967b73ab3c2a68f81a01429ae`](https://sepolia.etherscan.io/address/0xecfcd395e329df9967b73ab3c2a68f81a01429ae) |
| StressWeekendVault | [`0xacc258550cabc72de480ffadd666d94992ec16d5`](https://sepolia.etherscan.io/address/0xacc258550cabc72de480ffadd666d94992ec16d5) |
| StressClearinghouse | [`0xa1a1636ff2f17b2891145d29beb25fd4493211da`](https://sepolia.etherscan.io/address/0xa1a1636ff2f17b2891145d29beb25fd4493211da) |
| StressMockBtcUsdFeed | [`0x84fab5b7d4374d93d58274fa161d89518781d866`](https://sepolia.etherscan.io/address/0x84fab5b7d4374d93d58274fa161d89518781d866) |

## Key transactions

| What it shows | Transaction |
|---|---|
| a fund posts sBILL as margin | [`0x5132c08f97abdb8c6e0a5a0e506ffb6f2e6de2d7db16810c276b1e0cca3bd81f`](https://sepolia.etherscan.io/tx/0x5132c08f97abdb8c6e0a5a0e506ffb6f2e6de2d7db16810c276b1e0cca3bd81f) |
| a trade opens at the Chainlink price | [`0x5e5802a28e5fe9b9dd1d6d5adbe02a9f46741e2c6cf655c931930909173ba7a9`](https://sepolia.etherscan.io/tx/0x5e5802a28e5fe9b9dd1d6d5adbe02a9f46741e2c6cf655c931930909173ba7a9) |
| the funding rate is posted | [`0xf3b72056ab79a4dc8b173ce21b064411b6b2dd675c7a9c59577b1ddcba0b9987`](https://sepolia.etherscan.io/tx/0xf3b72056ab79a4dc8b173ce21b064411b6b2dd675c7a9c59577b1ddcba0b9987) |
| the T-bill market closes (demo switch) | [`0x30437de25e6a6656a38802fe28aa85dce63a2c8c3068973a8dd39b020d5cdf0d`](https://sepolia.etherscan.io/tx/0x30437de25e6a6656a38802fe28aa85dce63a2c8c3068973a8dd39b020d5cdf0d) |
| settlement pays the winner through the vault, with funding | [`0x6386b7da7d301f822b1ec2765c585bdf6cf096c73d5575d25d15e22d9153d89c`](https://sepolia.etherscan.io/tx/0x6386b7da7d301f822b1ec2765c585bdf6cf096c73d5575d25d15e22d9153d89c) |
| the vault redeems its sBILL and keeps the discount | [`0x73bd20e396b21f742f633ad33bb5f621f5b636439dbd4e22dc82411eda14c813`](https://sepolia.etherscan.io/tx/0x73bd20e396b21f742f633ad33bb5f621f5b636439dbd4e22dc82411eda14c813) |
| the keeper settles a trade | [`0xab77d5949d13654c01c898635aacaaef394ff454e6cc583a3ffd858b6cf55557`](https://sepolia.etherscan.io/tx/0xab77d5949d13654c01c898635aacaaef394ff454e6cc583a3ffd858b6cf55557) |
| a liquidation pays the winner and the liquidator through the vault | [`0x4036f3cc7c2febb3abf3a7e4524d3040effc0cc84fe92f96e1217121b6ee146b`](https://sepolia.etherscan.io/tx/0x4036f3cc7c2febb3abf3a7e4524d3040effc0cc84fe92f96e1217121b6ee146b) |

The full lists are in `packages/hardhat/demo-log.*.json`.

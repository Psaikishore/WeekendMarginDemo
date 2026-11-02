# Weekend Margin

**An on-chain clearinghouse for Bitcoin perpetual swaps that takes tokenized T-bills as margin, and can still pay winners when the T-bill market is closed.**

Bitcoin trades all weekend, but banks and T-bill markets don't. So a fund hedging Bitcoin has to keep idle cash in case it owes money on a Saturday. Here, it posts a tokenized T-bill (sBILL) as margin and earns interest instead. If it owes money while the market is closed, a vault of investors' cash buys its sBILL at a small discount, the winner is paid at once, and the vault redeems the sBILL at full value on Monday.

Built for FRE-GY 6931 Blockchain & Cryptocurrency, Fall 2026, by Team 9: Sai Kishore and Swastik Mishra. It runs on the Sepolia test network, and every token is a test token with no value.

| Read this | For |
|---|---|
| [VISION.md](VISION.md) | The idea, in plain English |
| [HOW_IT_WORKS.md](HOW_IT_WORKS.md) | Every contract, formula and failure case, in plain English |
| [docs/deployments.md](docs/deployments.md) | Contract addresses and key transactions |
| [docs/analysis.ipynb](docs/analysis.ipynb) | The financial analysis |
| [config/README.md](config/README.md) | Every setting and assumption you can change |
| [docs/slither.md](docs/slither.md), [docs/gas.md](docs/gas.md) | The security scan and gas measurements |

## Live on Sepolia

All 16 contracts are deployed and verified on Etherscan. On the labelled demo set, BTC moved 0.56%, so a fund holding only sBILL owed $437.16 while the demo's market was closed. The vault [bought its sBILL at a 0.1% discount](https://sepolia.etherscan.io/tx/0x6386b7da7d301f822b1ec2765c585bdf6cf096c73d5575d25d15e22d9153d89c) and the winner was paid at once. The vault then [redeemed it](https://sepolia.etherscan.io/tx/0x73bd20e396b21f742f633ad33bb5f621f5b636439dbd4e22dc82411eda14c813) for a $0.44 profit. A separate set with a mock price shows [a liquidation](https://sepolia.etherscan.io/tx/0x4036f3cc7c2febb3abf3a7e4524d3040effc0cc84fe92f96e1217121b6ee146b) at the price the model predicted. All 28 numbers checked in the analysis match the chain exactly.

The demo set's weekend is a switch held by the deployer, so the path can be shown on any day. The main set uses the real calendar, which nobody can change. Every address and key transaction is in [docs/deployments.md](docs/deployments.md).

## How it fits together

```text
           deposit sBILL or tUSDC          price, checked for staleness
  Fund / Trader ─────────────► Clearinghouse ◄──────── Chainlink BTC/USD
                                │        │
              weekday: redeem   │        │  market closed: sell at NAV minus the discount
                                ▼        ▼
                              SBill ◄── WeekendVault ◄── investors deposit tUSDC
                                  Monday: redeem, keep the discount
```

| Contract | What it does |
|---|---|
| `SBill` | **Our token.** A mock T-bill fund share (ERC-20). NAV grows at a fixed 4%, and it can only be bought or redeemed while the market is open |
| `TestUSDC` | Test dollars, with a faucet |
| `MarketCalendar` | The real calendar: closed from Friday 21:00 to Monday 14:00 UTC. Nobody can change it |
| `DemoCalendar` | A labelled copy with an owner's switch, to show the weekend path on any day |
| `WeekendVault` | ERC-4626 pool of tUSDC. Buys sBILL at a discount while the market is closed, and redeems it on business days |
| `Clearinghouse` | Holds margin, opens trades between two accounts, settles price moves and funding, and liquidates |

## Run the tests

You need Node 22.10 or newer, and Yarn 4 through Corepack.

```bash
corepack enable
yarn install
yarn test
```

This runs 37 tests on a local chain, including tests that expect a revert, and prints the gas used by each function.

## Run the app

The app reads the contracts on Sepolia, so you can browse it with no wallet. To send transactions, connect a wallet holding a little SepoliaETH.

```bash
yarn start
```

Then open <http://localhost:3000>.

## Try the whole thing locally

No keys are needed, and the mock price moves by itself. In one terminal:

```bash
yarn chain
```

In another:

```bash
yarn onchain:all --network default
NEXT_PUBLIC_USE_LOCAL_CHAIN=true yarn start
```

This deploys all three sets of contracts, then runs the weekend story, a keeper pass and a liquidation. `deployedContracts.ts` also holds local-chain entries from our last rehearsal. They don't affect the live site, and this command replaces them with your own. Afterwards, delete `packages/hardhat/deployments/default` and `packages/hardhat/demo-log.default-*.json`, and put back the generated file with `git checkout packages/nextjs/contracts/deployedContracts.ts`.

## Run the analysis

You need Python 3.10 or newer.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r docs/requirements.txt
jupyter lab docs/analysis.ipynb
```

To change an assumption, edit `config/assumptions.json` and run the notebook again, or try values on the app's Economics page first.

## Deploy to Sepolia

The project is already deployed, so this is only for making your own copy. It needs a deployer account, created with `yarn generate` or `yarn account:import`, holding about 0.01 SepoliaETH. One command does everything that happens on-chain:

```bash
yarn onchain:all
```

It asks for the password once, deploys and verifies the three sets of contracts, runs the demo and the liquidation, and writes `submission.json` and `docs/deployments.md`. See section 8 of [HOW_IT_WORKS.md](HOW_IT_WORKS.md) for each step.

## Built with

[Scaffold-ETH 2](https://scaffoldeth.io) (Hardhat), OpenZeppelin Contracts and Chainlink Data Feeds. Claude Code helped write the contracts, tests, scripts, front end, notebook and documents. The report's AI Use section says how, and how we checked the output.

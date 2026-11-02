import { network } from "hardhat";
import { deploymentAddress } from "./lib/demo.js";

/**
 * Local rehearsal only (yarn chain): moves the clock to the next Saturday 12:00 or Monday 15:00 UTC
 * and moves the mock BTC price by REHEARSE_MOVE_PCT percent (default +2).
 * Usage: REHEARSE_TO=saturday yarn workspace @se-2/hardhat hardhat run scripts/rehearseWeekend.ts
 */
const DAY = 86_400;
const target = (process.env.REHEARSE_TO ?? "saturday").toLowerCase();
const movePct = Number(process.env.REHEARSE_MOVE_PCT ?? "2");

const { ethers, networkName, provider } = await network.create();
const { chainId } = await ethers.provider.getNetwork();
if (chainId !== 31337n) throw new Error("rehearseWeekend only runs on the local Hardhat chain");

const latest = (await ethers.provider.getBlock("latest"))!.timestamp;
const today = Math.floor(latest / DAY);
const wanted = target === "monday" ? 1 : 6;
let ahead = (wanted - ((today + 4) % 7) + 7) % 7;
if (ahead === 0) ahead = 7;
const hour = target === "monday" ? 15 : 12;
await provider.request({ method: "evm_setNextBlockTimestamp", params: [(today + ahead) * DAY + hour * 3600] });
await provider.request({ method: "evm_mine", params: [] });

const feed = await ethers.getContractAt("MockV3Aggregator", deploymentAddress(networkName, "MockBtcUsdFeed"));
const [, answer] = await feed.latestRoundData();
const moved = (answer * BigInt(Math.round((100 + movePct) * 100))) / 10_000n;
await (await feed.updateAnswer(moved)).wait();
console.log(`Clock moved to ${target} ${hour}:00 UTC; mock BTC/USD ${Number(answer) / 1e8} -> ${Number(moved) / 1e8}`);

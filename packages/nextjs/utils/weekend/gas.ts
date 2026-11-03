/**
 * Fixed gas limits for the calls a wallet's estimate gets wrong. An estimate made right after another
 * write in the same block comes out short, because the timestamp it rewrites looks unchanged
 * (see docs/gas.md). Unused gas is refunded, so a generous limit costs nothing.
 */
export const SETTLE_GAS = { gas: 700_000n };
export const WITHDRAW_GAS = { gas: 500_000n };
export const MOCK_UPDATE_GAS = { gas: 100_000n };

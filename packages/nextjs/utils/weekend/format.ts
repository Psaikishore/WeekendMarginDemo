import { formatUnits, parseUnits } from "viem";

const number = (value: number, digits: number) =>
  value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** All amounts in the system use 18 decimals. */
export const toNumber = (value: bigint) => Number(formatUnits(value, 18));

export const fmtUsd = (value: bigint | undefined, digits = 2) => {
  if (value === undefined) return "–";
  return `${value < 0n ? "-" : ""}$${number(Math.abs(toNumber(value)), digits)}`;
};

export const fmtToken = (value: bigint | undefined, digits = 2) =>
  value === undefined ? "–" : number(toNumber(value), digits);

export const fmtBps = (bps: bigint | number | undefined) =>
  bps === undefined ? "–" : `${number(Number(bps) / 100, Number(bps) % 100 === 0 ? 0 : 2)}%`;

export const fmtFundingPct = (rate: bigint | undefined) =>
  rate === undefined ? "–" : `${number(toNumber(rate) * 100, 5)}%`;

export const fmtFundingRate = (rate: bigint | undefined) =>
  rate === undefined ? "–" : `${fmtFundingPct(rate)} an hour`;

export const fmtDuration = (seconds: number) => {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

/** Reads what a person typed. Returns undefined unless it is a positive amount. */
export const parseAmount = (text: string) => {
  try {
    const value = parseUnits(text.trim().replace(/,/g, ""), 18);
    return value > 0n ? value : undefined;
  } catch {
    return undefined;
  }
};

export const fmtInput = (value: bigint) => formatUnits(value, 18);

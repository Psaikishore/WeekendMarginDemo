/**
 * The vault and going-to-market models from docs/analysis.ipynb (Sections B, D, E and G), for the
 * Economics page. The notebook is the source of truth. If you change a formula, change it in both.
 * Rates and shares are fractions: 0.04 is 4%, and 0.001 is 10 basis points.
 */
const HOURS_A_YEAR = 8760;
const HOURS_A_WEEK = 168;

export type DiscountInputs = {
  tBillYield: number;
  hurdlePremium: number;
  closureHours: number;
  tBillDurationYears: number;
  yieldShock: number;
  longWeekendsPerYear: number;
  weekendsPerYear: number;
  longWeekendExtraHours: number;
  fundGatesOncePerYears: number;
  gateLoss: number;
};

/** The discount the vault needs on each dollar it actually uses (Section D). */
export const requiredDiscount = (i: DiscountInputs) => {
  const hurdle = i.tBillYield + i.hurdlePremium;
  const netCarry = ((hurdle - i.tBillYield) * i.closureHours) / HOURS_A_YEAR;
  const priceRisk = i.tBillDurationYears * i.yieldShock;
  const redemptionRisk =
    ((i.longWeekendsPerYear / i.weekendsPerYear) * hurdle * i.longWeekendExtraHours) / HOURS_A_YEAR +
    (1 / (i.fundGatesOncePerYears * i.weekendsPerYear)) * i.gateLoss;
  return { netCarry, priceRisk, redemptionRisk, total: netCarry + priceRisk + redemptionRisk };
};

const idleReturn = (y: number, closureHours: number, sweep: boolean) =>
  sweep ? (y * (HOURS_A_WEEK - closureHours)) / HOURS_A_WEEK : 0;

/** What the vault earns on its cash in a year (Section D). */
export const vaultReturn = (
  discount: number,
  usage: number,
  y: number,
  closureHours: number,
  weekends: number,
  sweep: boolean,
) => weekends * usage * (discount + (y * closureHours) / HOURS_A_YEAR) + idleReturn(y, closureHours, sweep);

/** The discount at which the vault earns `hurdle` (Section D). */
export const discountNeeded = (
  usage: number,
  y: number,
  hurdle: number,
  closureHours: number,
  weekends: number,
  sweep: boolean,
) => (hurdle - idleReturn(y, closureHours, sweep)) / (weekends * usage) - (y * closureHours) / HOURS_A_YEAR;

/** The highest discount at which the fund still prefers the vault to each alternative (Section E). */
export const fundLimits = (y: number, margin: number, buffer: number, soldPerYear: number, closureHours: number) => ({
  againstAllCash: (y * margin) / soldPerYear,
  againstCashBuffer: (y * buffer) / soldPerYear,
  againstFridaySwap: (((y * buffer) / soldPerYear) * closureHours) / HOURS_A_WEEK,
});

/** What the fund earns on its margin in a year, under each plan (Section E). */
export const fundIncome = (y: number, margin: number, buffer: number, soldPerYear: number, discount: number) => ({
  withVault: y * margin - discount * soldPerYear,
  withCashBuffer: y * (margin - buffer),
  allCash: 0,
});

export type GoToMarketInputs = {
  discount: number;
  protocolShare: number;
  clearingFeeBpsPerSide: number;
  turnsPerYear: number;
  soldPerNotionalPerYear: number;
  runningCosts: number;
};

/** Revenue per $1 of hedges, and the hedge size that pays the running costs (Section G). */
export const goToMarket = (i: GoToMarketInputs) => {
  const vaultFees = i.soldPerNotionalPerYear * i.discount * i.protocolShare;
  const clearingFees = 2 * (i.clearingFeeBpsPerSide / 10_000) * i.turnsPerYear;
  const perDollar = vaultFees + clearingFees;
  return {
    vaultFees,
    clearingFees,
    perDollar,
    breakEvenNotional: perDollar > 0 ? i.runningCosts / perDollar : Infinity,
  };
};

/**
 * BTC price at which an account falls to maintenance margin, ignoring funding and interest (Section B).
 * The account pays its tUSDC first. After that, each dollar lost sells 1/(1 - discount) dollars of sBILL.
 */
export const liquidationPrice = ({
  isLong,
  size,
  usdc: totalUsdc,
  sbillValue: totalSBillValue,
  price,
  haircut,
  discount,
  maintenance,
}: {
  isLong: boolean;
  size: number;
  usdc: number;
  sbillValue: number;
  price: number;
  haircut: number;
  discount: number;
  maintenance: number;
}) => {
  // Everything below is per 1 BTC of position.
  const usdc = totalUsdc / size;
  const sbillValue = totalSBillValue / size;
  const h = 1 - haircut;
  const m = maintenance;
  const sold = h / (1 - discount);
  if (isLong) {
    const whilePayingCash = (price - usdc - h * sbillValue) / (1 - m);
    if (price - whilePayingCash <= usdc) return Math.max(whilePayingCash, 0);
    return Math.max((sold * (price - usdc) - h * sbillValue) / (sold - m), 0);
  }
  const whilePayingCash = (usdc + h * sbillValue + price) / (1 + m);
  if (whilePayingCash - price <= usdc) return whilePayingCash;
  return (h * sbillValue + sold * (usdc + price)) / (m + sold);
};

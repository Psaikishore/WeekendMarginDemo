/**
 * Contract errors in plain English. A person who has just had a transaction refused should be told
 * what happened and what to do next, not shown `InsufficientMargin(1, 2)`.
 */
const PLAIN_ERRORS: Record<string, string> = {
  MarketClosed: "The T-bill market is closed, so sBILL can't be bought or redeemed until it reopens.",
  MarketOpen: "The market is open, so the vault isn't buying. sBILL goes through the fund at full value instead.",
  InsufficientMargin: "Your margin is too low for this. Deposit more, or use a smaller size.",
  InsufficientBalance: "Your margin account doesn't hold that much of this token.",
  InsufficientLiquidity:
    "The weekend vault doesn't have enough cash for this. Settlement can run once more cash is deposited or the market reopens.",
  StalePrice:
    "The Chainlink BTC price is too old, so the system refuses to use it. Try again after the next price update.",
  InvalidPrice: "The price feed returned a zero or negative price, so the system refuses to use it.",
  IncompletePriceRound: "The price feed's latest round isn't complete yet. Try again shortly.",
  HasOpenTrade: "This account already has an open trade. Each account can hold one at a time.",
  HasActiveOffer: "This account already has an open offer. Cancel it first.",
  NoActiveOffer: "This account has no open offer to cancel.",
  OfferNotActive: "That offer has been taken or cancelled.",
  CannotTakeOwnOffer: "You can't accept your own offer. Use a different account for the other side.",
  TradeNotOpen: "That trade has already closed.",
  NotTradeParty: "Only the long or the short in this trade can close it.",
  NotLiquidatable: "Both sides still have enough margin, so this trade can't be liquidated.",
  FundingRateTooHigh: "That funding rate is above the cap fixed at deployment.",
  DiscountTooHigh: "That discount is above the hard limit fixed at deployment.",
  NothingToRedeem: "The vault holds no sBILL to redeem.",
  ZeroAmount: "Enter an amount above zero.",
  FaucetCooldown: "You can use the faucet once an hour. Try again later.",
  OwnableUnauthorizedAccount: "Only the owner of this contract can do that. Connect the owner's wallet.",
  EnforcedPause: "New deposits and trades are paused. Settlement, withdrawals and closing still work.",
  ERC20InsufficientBalance: "Your wallet doesn't hold enough of this token.",
  ERC20InsufficientAllowance: "Approve the token first, then try again.",
  ERC4626ExceededMaxWithdraw:
    "The vault can only pay out the cash it holds. The rest comes back when it redeems its sBILL.",
  ERC4626ExceededMaxRedeem:
    "The vault can only pay out the cash it holds. The rest comes back when it redeems its sBILL.",
};

export const explainError = (message: string) => {
  const known = Object.keys(PLAIN_ERRORS).find(name => message.includes(name));
  if (known) return PLAIN_ERRORS[known];
  if (/user (rejected|denied)/i.test(message)) return "You cancelled this in your wallet. Nothing was sent.";
  if (/insufficient funds/i.test(message)) return "Your wallet doesn't have enough ETH to pay for gas.";
  return message;
};

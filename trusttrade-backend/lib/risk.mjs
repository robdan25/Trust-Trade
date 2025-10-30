/**
 * Simple risk sizing helper.
 * mode: "conservative" | "balanced" | "aggressive"
 */
export function positionSizeUSD(balanceUSD, mode="balanced"){
  const pct = mode==="aggressive" ? 1.00 : mode==="conservative" ? 0.50 : 0.75;
  return balanceUSD * pct;
}

/**
 * Basic sanity checks before sending an order.
 */
export function preTradeChecks({balanceUSD, price, minNotional=10}){
  if (!isFinite(price) || price<=0) return {ok:false, reason:"invalid_price"};
  if (!isFinite(balanceUSD) || balanceUSD<=0) return {ok:false, reason:"no_balance"};
  if (balanceUSD < minNotional) return {ok:false, reason:"below_min_notional"};
  return {ok:true};
}

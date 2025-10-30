export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i=0;i<values.length;i++){
    sum += values[i];
    if (i >= n) sum -= values[i-n];
    if (i >= n-1) out[i] = sum / n;
  }
  return out;
}

// Calculate price momentum (rate of change)
export function momentum(values, period = 14) {
  const momentum = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      momentum.push(null);
    } else {
      const change = ((values[i] - values[i - period]) / values[i - period]) * 100;
      momentum.push(change);
    }
  }
  return momentum;
}

// Calculate volatility (standard deviation)
export function volatility(values, period = 20) {
  const vol = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      vol.push(null);
    } else {
      const slice = values.slice(i - period + 1, i + 1);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
      vol.push(Math.sqrt(variance));
    }
  }
  return vol;
}

// Assess profit opportunity with risk/reward (configurable thresholds)
export function assessProfitOpportunity(closes, shortN = 12, longN = 26, thresholds = {}) {
  const {
    momentumThreshold = 0.8,      // Optimized: 0.8% (was 1.5% conservative)
    smaDiffThreshold = 0.25,       // Optimized: 0.25% (was 0.5% conservative)
    pricePositionPercent = 0.05    // Optimized: 5% (was 2% conservative)
  } = thresholds;

  const currentPrice = closes[closes.length - 1];
  const a = sma(closes, shortN);
  const b = sma(closes, longN);
  const mom = momentum(closes, 14);
  const vol = volatility(closes, 20);

  const currentMomentum = mom[mom.length - 1];
  const currentVol = vol[vol.length - 1];
  const avgPrice = closes.slice(-20).reduce((sum, p) => sum + p, 0) / 20;

  // Calculate signal strength
  const shortSMA = a[a.length - 1];
  const longSMA = b[b.length - 1];
  const smaDiff = shortSMA && longSMA ? ((shortSMA - longSMA) / longSMA) * 100 : 0;

  // Determine if there's a profit opportunity
  let profitOpportunity = false;
  let reason = '';
  let expectedProfit = 0;
  let riskReward = 0;

  // BUY opportunity: Using configurable thresholds
  if (currentMomentum > momentumThreshold && smaDiff > smaDiffThreshold && currentPrice < avgPrice * (1 + pricePositionPercent)) {
    profitOpportunity = true;
    expectedProfit = ((avgPrice * 1.03 - currentPrice) / currentPrice) * 100;
    riskReward = expectedProfit / (currentVol || 1);
    reason = `BUY: +${currentMomentum.toFixed(2)}% momentum, ${smaDiff.toFixed(2)}% SMA advantage`;
  }
  // SELL opportunity: Using configurable thresholds
  else if (currentMomentum < -momentumThreshold && smaDiff < -smaDiffThreshold && currentPrice > avgPrice * (1 - pricePositionPercent)) {
    profitOpportunity = true;
    expectedProfit = ((currentPrice - avgPrice * 0.97) / currentPrice) * 100;
    riskReward = expectedProfit / (currentVol || 1);
    reason = `SELL: ${currentMomentum.toFixed(2)}% momentum, ${smaDiff.toFixed(2)}% SMA disadvantage`;
  }

  return {
    profitOpportunity,
    reason,
    expectedProfit: expectedProfit.toFixed(2),
    riskReward: riskReward.toFixed(2),
    momentum: currentMomentum?.toFixed(2) || 0,
    volatility: currentVol?.toFixed(2) || 0,
    smaDiff: smaDiff.toFixed(2)
  };
}

export function lastSmaSignal(closes, shortN=12, longN=26) {
  const a = sma(closes, shortN);
  const b = sma(closes, longN);
  let sig = "hold", lastIdx = -1;
  for (let i = 1; i < closes.length; i++) {
    if (a[i-1]!=null && b[i-1]!=null && a[i]!=null && b[i]!=null){
      const prev = a[i-1]-b[i-1], cur = a[i]-b[i];
      if (prev<=0 && cur>0){ sig="buy"; lastIdx=i; }
      if (prev>=0 && cur<0){ sig="sell"; lastIdx=i; }
    }
  }
  return { signal: sig, a, b, lastIdx };
}

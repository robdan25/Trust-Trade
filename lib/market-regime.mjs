/**
 * Market Regime Detection
 *
 * Determines the current market state and recommends optimal trading strategy
 *
 * Market Regimes:
 * - TRENDING_UP: Strong uptrend → Use Momentum strategy
 * - TRENDING_DOWN: Strong downtrend → Use Momentum strategy (short)
 * - RANGING: Sideways movement → Use Mean Reversion or Grid Trading
 * - VOLATILE: High volatility → Use Grid Trading
 * - CHOPPY: Unclear direction → Hold cash, wait for clarity
 */

import { atr, ema, bollingerBands } from './indicators-advanced.mjs';
import { sma, momentum } from './indicators.mjs';

/**
 * Market Regime Types
 */
export const MARKET_REGIMES = {
  TRENDING_UP: 'trending-up',
  TRENDING_DOWN: 'trending-down',
  RANGING: 'ranging',
  VOLATILE: 'volatile',
  CHOPPY: 'choppy'
};

/**
 * Recommended strategies for each regime
 */
export const REGIME_STRATEGIES = {
  [MARKET_REGIMES.TRENDING_UP]: 'momentum',
  [MARKET_REGIMES.TRENDING_DOWN]: 'momentum',
  [MARKET_REGIMES.RANGING]: 'mean-reversion',
  [MARKET_REGIMES.VOLATILE]: 'grid-trading',
  [MARKET_REGIMES.CHOPPY]: 'hold'
};

/**
 * Detect current market regime
 * @param {Array} candles - Array of candle objects
 * @returns {Object} Market regime analysis
 */
export function detectMarketRegime(candles) {
  if (candles.length < 100) {
    return {
      regime: MARKET_REGIMES.CHOPPY,
      confidence: 0,
      reason: 'Insufficient data for regime detection',
      recommendedStrategy: 'hold'
    };
  }

  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];

  // 1. TREND ANALYSIS
  const trendAnalysis = analyzeTrend(closes);

  // 2. VOLATILITY ANALYSIS
  const volatilityAnalysis = analyzeVolatility(candles);

  // 3. RANGE ANALYSIS
  const rangeAnalysis = analyzeRange(closes);

  // Determine regime based on multiple factors
  let regime = MARKET_REGIMES.CHOPPY;
  let confidence = 0;
  let reason = '';

  // TRENDING REGIME (highest priority if strong trend)
  if (trendAnalysis.trending && trendAnalysis.strength > 70) {
    regime = trendAnalysis.direction === 'up'
      ? MARKET_REGIMES.TRENDING_UP
      : MARKET_REGIMES.TRENDING_DOWN;
    confidence = trendAnalysis.strength;
    reason = `Strong ${trendAnalysis.direction}trend: ${trendAnalysis.strength}% strength, ${trendAnalysis.emaSeparation}% EMA separation`;
  }

  // VOLATILE REGIME (high volatility with ranging)
  else if (volatilityAnalysis.high && rangeAnalysis.ranging) {
    regime = MARKET_REGIMES.VOLATILE;
    confidence = Math.round((volatilityAnalysis.score * 0.6 + rangeAnalysis.score * 0.4) * 100);
    reason = `High volatility ranging: ${volatilityAnalysis.atrPercent}% ATR, ${rangeAnalysis.oscillations} price swings`;
  }

  // RANGING REGIME (low volatility, oscillating)
  else if (rangeAnalysis.ranging && !volatilityAnalysis.high) {
    regime = MARKET_REGIMES.RANGING;
    confidence = rangeAnalysis.score * 100;
    reason = `Ranging market: ${rangeAnalysis.oscillations} oscillations, ${volatilityAnalysis.atrPercent}% volatility`;
  }

  // WEAK TREND - still count as trending if moderate strength
  else if (trendAnalysis.trending && trendAnalysis.strength > 50) {
    regime = trendAnalysis.direction === 'up'
      ? MARKET_REGIMES.TRENDING_UP
      : MARKET_REGIMES.TRENDING_DOWN;
    confidence = trendAnalysis.strength;
    reason = `Moderate ${trendAnalysis.direction}trend: ${trendAnalysis.strength}% strength`;
  }

  // CHOPPY REGIME (unclear conditions)
  else {
    regime = MARKET_REGIMES.CHOPPY;
    confidence = 30;
    reason = `Choppy market: No clear trend (${trendAnalysis.strength}%), low volatility (${volatilityAnalysis.atrPercent}%)`;
  }

  const recommendedStrategy = REGIME_STRATEGIES[regime];

  return {
    regime,
    confidence: Math.round(confidence),
    reason,
    recommendedStrategy,

    // Detailed analysis
    trend: trendAnalysis,
    volatility: volatilityAnalysis,
    range: rangeAnalysis,

    currentPrice,
    timestamp: Date.now()
  };
}

/**
 * Analyze trend strength and direction
 * @param {Array} closes - Closing prices
 * @returns {Object} Trend analysis
 */
function analyzeTrend(closes) {
  // Calculate multiple EMAs for trend detection
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema100 = ema(closes, 100);

  const currentEMA20 = ema20[ema20.length - 1];
  const currentEMA50 = ema50[ema50.length - 1];
  const currentEMA100 = ema100[ema100.length - 1];

  // EMA alignment (all pointing same direction = strong trend)
  const uptrend = currentEMA20 > currentEMA50 && currentEMA50 > currentEMA100;
  const downtrend = currentEMA20 < currentEMA50 && currentEMA50 < currentEMA100;

  // Calculate EMA separation (how far apart they are)
  const emaSeparation = Math.abs((currentEMA20 - currentEMA50) / currentEMA50) * 100;

  // Calculate momentum
  const momentumValues = momentum(closes, 14);
  const currentMomentum = momentumValues[momentumValues.length - 1];
  const momentumPercent = Math.abs(currentMomentum / closes[closes.length - 15] * 100);

  // Calculate ADX (Average Directional Index) approximation
  // Higher ADX = stronger trend
  const adxApprox = Math.min((emaSeparation * 20 + momentumPercent * 10), 100);

  const trending = uptrend || downtrend;
  const direction = uptrend ? 'up' : downtrend ? 'down' : 'sideways';
  const strength = Math.round(adxApprox);

  return {
    trending,
    direction,
    strength,
    ema20: currentEMA20,
    ema50: currentEMA50,
    ema100: currentEMA100,
    emaSeparation: emaSeparation.toFixed(2),
    momentum: momentumPercent.toFixed(2),
    aligned: uptrend || downtrend
  };
}

/**
 * Analyze market volatility
 * @param {Array} candles - Candle objects
 * @returns {Object} Volatility analysis
 */
function analyzeVolatility(candles) {
  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];

  // Calculate ATR (Average True Range)
  const atrValues = atr(candles, 14);
  const currentATR = atrValues[atrValues.length - 1];
  const atrPercent = (currentATR / currentPrice) * 100;

  // Calculate Bollinger Band width
  const bb = bollingerBands(closes, 20, 2);
  const currentBB = {
    upper: bb.upper[bb.upper.length - 1],
    middle: bb.middle[bb.middle.length - 1],
    lower: bb.lower[bb.lower.length - 1]
  };
  const bbWidth = ((currentBB.upper - currentBB.lower) / currentBB.middle) * 100;

  // Classify volatility
  let level = 'low';
  let score = 0;

  if (atrPercent > 2.0 || bbWidth > 4.0) {
    level = 'high';
    score = 0.9;
  } else if (atrPercent > 1.0 || bbWidth > 2.0) {
    level = 'moderate';
    score = 0.6;
  } else {
    level = 'low';
    score = 0.3;
  }

  return {
    level,
    high: level === 'high',
    moderate: level === 'moderate',
    low: level === 'low',
    score,
    atr: currentATR,
    atrPercent: atrPercent.toFixed(2),
    bbWidth: bbWidth.toFixed(2)
  };
}

/**
 * Analyze if market is ranging
 * @param {Array} closes - Closing prices
 * @returns {Object} Range analysis
 */
function analyzeRange(closes) {
  // Calculate SMA for mean
  const sma50 = sma(closes, 50);
  const currentSMA = sma50[sma50.length - 1];

  // Count how many times price crosses SMA (oscillations)
  let oscillations = 0;
  let totalDeviation = 0;
  let maxDeviation = 0;

  for (let i = closes.length - 50; i < closes.length; i++) {
    if (i > 0 && sma50[i] !== null && sma50[i - 1] !== null) {
      // Count crosses
      const prevAbove = closes[i - 1] > sma50[i - 1];
      const currAbove = closes[i] > sma50[i];
      if (prevAbove !== currAbove) oscillations++;

      // Track deviation from mean
      const deviation = Math.abs((closes[i] - sma50[i]) / sma50[i]) * 100;
      totalDeviation += deviation;
      maxDeviation = Math.max(maxDeviation, deviation);
    }
  }

  const avgDeviation = totalDeviation / 50;

  // Market is ranging if:
  // 1. Multiple oscillations (at least 5)
  // 2. Low average deviation from mean (< 2%)
  // 3. Max deviation stays within bounds (< 5%)
  const oscillationScore = Math.min(oscillations / 8, 1.0); // 8+ oscillations = perfect
  const deviationScore = avgDeviation < 2.0 ? 1.0 : 2.0 / avgDeviation;
  const boundsScore = maxDeviation < 5.0 ? 1.0 : 5.0 / maxDeviation;

  const score = (oscillationScore * 0.5 + deviationScore * 0.3 + boundsScore * 0.2);
  const ranging = score >= 0.6;

  return {
    ranging,
    score,
    oscillations,
    avgDeviation: avgDeviation.toFixed(2),
    maxDeviation: maxDeviation.toFixed(2),
    sma: currentSMA
  };
}

/**
 * Get regime change alerts
 * Compares previous regime to current regime
 * @param {Object} prevRegime - Previous regime detection result
 * @param {Object} currentRegime - Current regime detection result
 * @returns {Object} Change analysis
 */
export function detectRegimeChange(prevRegime, currentRegime) {
  if (!prevRegime) {
    return {
      changed: false,
      message: 'Initial regime detection'
    };
  }

  const changed = prevRegime.regime !== currentRegime.regime;

  if (!changed) {
    return {
      changed: false,
      message: `Regime stable: ${currentRegime.regime}`
    };
  }

  const confidenceDiff = currentRegime.confidence - prevRegime.confidence;

  return {
    changed: true,
    from: prevRegime.regime,
    to: currentRegime.regime,
    fromStrategy: prevRegime.recommendedStrategy,
    toStrategy: currentRegime.recommendedStrategy,
    confidenceDiff,
    message: `Regime changed: ${prevRegime.regime} → ${currentRegime.regime} (${currentRegime.confidence}% confidence)`,
    shouldSwitchStrategy: prevRegime.recommendedStrategy !== currentRegime.recommendedStrategy
  };
}

/**
 * Get regime summary for logging
 * @param {Object} regime - Regime detection result
 * @returns {string} Human-readable summary
 */
export function getRegimeSummary(regime) {
  const { regime: type, confidence, recommendedStrategy } = regime;

  const emoji = {
    'trending-up': '📈',
    'trending-down': '📉',
    'ranging': '↔️',
    'volatile': '⚡',
    'choppy': '🌊'
  }[type] || '❓';

  return `${emoji} ${type.toUpperCase()} (${confidence}%) → Strategy: ${recommendedStrategy}`;
}

export default {
  MARKET_REGIMES,
  REGIME_STRATEGIES,
  detectMarketRegime,
  detectRegimeChange,
  getRegimeSummary
};

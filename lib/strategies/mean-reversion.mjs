/**
 * Mean Reversion Trading Strategy
 *
 * Philosophy: "What goes up must come down, what goes down must come up"
 * Best for: Ranging/sideways markets with clear support/resistance
 *
 * Entry Signals:
 * - Price at lower Bollinger Band + RSI oversold → BUY
 * - Price at upper Bollinger Band + RSI overbought → SELL
 *
 * Exit Signals:
 * - Price returns to middle Bollinger Band (mean)
 * - Stop-loss if trend continues against position
 */

import { rsi, bollingerBands, interpretRSI, interpretBollingerBands } from '../indicators-advanced.mjs';
import { sma } from '../indicators.mjs';

/**
 * Mean Reversion Strategy Configuration
 */
export const MEAN_REVERSION_CONFIG = {
  name: 'Mean Reversion',
  description: 'Buys oversold, sells overbought, expects return to mean',

  // Indicator settings
  rsiPeriod: 14,
  rsiOversold: 30,
  rsiOverbought: 70,
  bbPeriod: 20,
  bbStdDev: 2,

  // Risk management
  stopLossPercent: 1.5,  // Tighter stops for mean reversion
  takeProfitPercent: 3.0, // Profit at mean reversion

  // Signal requirements
  minConfidence: 65, // Require high confidence for counter-trend

  // Market conditions
  bestInRanging: true,
  bestInTrending: false,
  requiredVolatility: { min: 0.5, max: 3.0 } // Works in moderate volatility
};

/**
 * Analyze market for mean reversion opportunities
 * @param {Array} candles - Array of candle objects
 * @param {Object} config - Strategy configuration
 * @returns {Object} Mean reversion signal
 */
export function analyzeMeanReversion(candles, config = {}) {
  const {
    rsiPeriod = MEAN_REVERSION_CONFIG.rsiPeriod,
    rsiOversold = MEAN_REVERSION_CONFIG.rsiOversold,
    rsiOverbought = MEAN_REVERSION_CONFIG.rsiOverbought,
    bbPeriod = MEAN_REVERSION_CONFIG.bbPeriod,
    bbStdDev = MEAN_REVERSION_CONFIG.bbStdDev
  } = config;

  if (candles.length < 100) {
    return {
      signal: 'hold',
      confidence: 0,
      reason: 'Insufficient data for mean reversion analysis',
      strategy: 'mean-reversion'
    };
  }

  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];

  // Calculate RSI
  const rsiValues = rsi(closes, rsiPeriod);
  const currentRSI = rsiValues[rsiValues.length - 1];
  const rsiInterpretation = interpretRSI(currentRSI);

  // Calculate Bollinger Bands
  const bb = bollingerBands(closes, bbPeriod, bbStdDev);
  const currentBB = {
    upper: bb.upper[bb.upper.length - 1],
    middle: bb.middle[bb.middle.length - 1],
    lower: bb.lower[bb.lower.length - 1]
  };
  const bbInterpretation = interpretBollingerBands(currentPrice, currentBB);

  // Calculate distance from bands
  const bandwidth = currentBB.upper - currentBB.lower;
  const percentB = (currentPrice - currentBB.lower) / bandwidth;
  const distanceFromMean = Math.abs(currentPrice - currentBB.middle) / currentBB.middle * 100;

  let signal = 'hold';
  let confidence = 0;
  let reason = '';
  let entryPrice = currentPrice;
  let targetPrice = currentBB.middle;

  // OVERSOLD CONDITION - Look for BUY
  if (currentRSI < rsiOversold && percentB < 0.2) {
    signal = 'buy';

    // Confidence based on how oversold
    const rsiStrength = (rsiOversold - currentRSI) / rsiOversold; // 0-1
    const bbStrength = (0.2 - percentB) / 0.2; // 0-1
    confidence = Math.min(Math.round((rsiStrength * 0.6 + bbStrength * 0.4) * 100), 100);

    reason = `Oversold mean reversion: RSI ${currentRSI.toFixed(1)} (${rsiOversold}), Price at ${(percentB * 100).toFixed(0)}% of BB`;
    targetPrice = currentBB.middle;
  }

  // OVERBOUGHT CONDITION - Look for SELL
  else if (currentRSI > rsiOverbought && percentB > 0.8) {
    signal = 'sell';

    // Confidence based on how overbought
    const rsiStrength = (currentRSI - rsiOverbought) / (100 - rsiOverbought); // 0-1
    const bbStrength = (percentB - 0.8) / 0.2; // 0-1
    confidence = Math.min(Math.round((rsiStrength * 0.6 + bbStrength * 0.4) * 100), 100);

    reason = `Overbought mean reversion: RSI ${currentRSI.toFixed(1)} (${rsiOverbought}), Price at ${(percentB * 100).toFixed(0)}% of BB`;
    targetPrice = currentBB.middle;
  }

  // NEUTRAL - Price near mean or unclear signal
  else {
    confidence = 0;
    reason = `No mean reversion setup: RSI ${currentRSI.toFixed(1)}, Price at ${(percentB * 100).toFixed(0)}% of BB (${distanceFromMean.toFixed(1)}% from mean)`;
  }

  // Calculate potential profit
  const potentialProfitPercent = signal !== 'hold'
    ? Math.abs((targetPrice - entryPrice) / entryPrice) * 100
    : 0;

  return {
    signal,
    confidence,
    reason,
    strategy: 'mean-reversion',

    // Price levels
    entryPrice,
    targetPrice,
    currentPrice,
    meanPrice: currentBB.middle,

    // Indicators
    indicators: {
      rsi: {
        value: currentRSI,
        oversold: currentRSI < rsiOversold,
        overbought: currentRSI > rsiOverbought,
        interpretation: rsiInterpretation
      },
      bollingerBands: {
        upper: currentBB.upper,
        middle: currentBB.middle,
        lower: currentBB.lower,
        percentB,
        distanceFromMean,
        interpretation: bbInterpretation
      }
    },

    // Metrics
    potentialProfitPercent: potentialProfitPercent.toFixed(2),
    distanceFromMean: distanceFromMean.toFixed(2),

    timestamp: Date.now()
  };
}

/**
 * Check if should exit mean reversion position
 * @param {Object} position - Current position
 * @param {number} currentPrice - Current market price
 * @param {Object} bb - Bollinger Bands data
 * @returns {Object} Exit recommendation
 */
export function checkMeanReversionExit(position, currentPrice, bb) {
  const currentBB = {
    upper: bb.upper[bb.upper.length - 1],
    middle: bb.middle[bb.middle.length - 1],
    lower: bb.lower[bb.lower.length - 1]
  };

  const bandwidth = currentBB.upper - currentBB.lower;
  const percentB = (currentPrice - currentBB.lower) / bandwidth;

  let shouldExit = false;
  let exitReason = null;

  // Exit BUY position when price returns to mean
  if (position.side === 'buy') {
    if (currentPrice >= currentBB.middle * 0.99) { // Within 1% of mean
      shouldExit = true;
      exitReason = 'mean-reversion-target';
    }
  }

  // Exit SELL position when price returns to mean
  if (position.side === 'sell') {
    if (currentPrice <= currentBB.middle * 1.01) { // Within 1% of mean
      shouldExit = true;
      exitReason = 'mean-reversion-target';
    }
  }

  return {
    shouldExit,
    exitReason,
    currentPercentB: percentB,
    distanceFromMean: Math.abs(currentPrice - currentBB.middle) / currentBB.middle * 100
  };
}

/**
 * Validate if market conditions are suitable for mean reversion
 * @param {Array} candles - Array of candles
 * @returns {Object} Suitability assessment
 */
export function isSuitableForMeanReversion(candles) {
  if (candles.length < 100) {
    return {
      suitable: false,
      reason: 'Insufficient data',
      confidence: 0
    };
  }

  const closes = candles.map(c => c.close);

  // Calculate volatility (standard deviation of returns)
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance) * 100;

  // Check if price is ranging (not trending)
  const sma50 = sma(closes, 50);
  const currentSMA = sma50[sma50.length - 1];
  const priceChanges = [];

  for (let i = closes.length - 50; i < closes.length; i++) {
    if (sma50[i] !== null) {
      priceChanges.push(Math.abs((closes[i] - sma50[i]) / sma50[i]));
    }
  }

  const avgDeviation = priceChanges.reduce((sum, d) => sum + d, 0) / priceChanges.length * 100;

  // Mean reversion works best when:
  // 1. Moderate volatility (0.5% - 3%)
  // 2. Price oscillates around mean (low average deviation)
  const volatilityScore = volatility >= 0.5 && volatility <= 3.0 ? 1.0 : 0.5;
  const rangingScore = avgDeviation < 2.0 ? 1.0 : 0.5; // Price stays within 2% of SMA

  const suitabilityScore = (volatilityScore * 0.5 + rangingScore * 0.5) * 100;
  const suitable = suitabilityScore >= 60;

  return {
    suitable,
    confidence: Math.round(suitabilityScore),
    reason: suitable
      ? `Good ranging market: ${volatility.toFixed(2)}% volatility, ${avgDeviation.toFixed(2)}% avg deviation`
      : `Not ideal: ${volatility.toFixed(2)}% volatility, ${avgDeviation.toFixed(2)}% avg deviation from mean`,
    metrics: {
      volatility: volatility.toFixed(2),
      avgDeviation: avgDeviation.toFixed(2),
      volatilityScore,
      rangingScore
    }
  };
}

export default {
  MEAN_REVERSION_CONFIG,
  analyzeMeanReversion,
  checkMeanReversionExit,
  isSuitableForMeanReversion
};

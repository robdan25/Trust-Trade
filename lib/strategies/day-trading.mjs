/**
 * Day Trading / Scalping Strategy
 *
 * Philosophy: "Quick in, quick out - capture small moves frequently"
 * Best for: Active trading during volatile hours
 *
 * Characteristics:
 * - Multiple trades per day (5-20+)
 * - Small profit targets (0.5-1.5%)
 * - Tight stop losses (0.3-0.8%)
 * - Fast entries and exits
 * - High win rate required (65%+)
 *
 * Entry Signals:
 * - Quick momentum shifts (1-5 minute candles)
 * - Volume spikes + price breakout
 * - RSI divergence + MACD confirmation
 *
 * Exit Signals:
 * - Take profit: 0.5-1.5% gain
 * - Stop loss: 0.3-0.8% loss
 * - Time-based exit: 5-30 minutes max hold
 */

import { rsi, macd, ema, analyzeVolume } from '../indicators-advanced.mjs';
import { momentum } from '../indicators.mjs';

/**
 * Day Trading Strategy Configuration
 */
export const DAY_TRADING_CONFIG = {
  name: 'Day Trading / Scalping',
  description: 'Quick scalps with tight stops and small profits',

  // Timeframe
  interval: '1m', // 1-minute candles for quick entries
  holdTimeMax: 1800000, // 30 minutes max hold time
  holdTimeMin: 300000,  // 5 minutes min hold time

  // Profit targets (smaller than swing trading)
  takeProfitPercent: 1.0,  // 1% profit target
  stopLossPercent: 0.5,    // 0.5% stop loss
  trailingStopPercent: 0.3, // Tight trailing stop

  // Signal requirements
  minConfidence: 70,       // Need higher confidence for day trading
  minMomentum: 0.3,        // Minimum 0.3% momentum (smaller moves)
  minVolumeRatio: 1.5,     // Need strong volume (150% of average)

  // Risk management
  maxTradesPerDay: 20,     // Max 20 day trades
  maxLossPerDay: -2.0,     // Stop if down 2% for the day
  riskPerTrade: 0.5,       // Risk 0.5% per trade

  // Market conditions
  bestInRanging: false,
  bestInTrending: false,
  bestInVolatile: true,    // Best during high volatility
  requiredVolatility: { min: 0.5, max: 5.0 }
};

/**
 * Analyze market for day trading opportunities
 * @param {Array} candles - Array of candle objects (1-minute)
 * @param {Object} config - Strategy configuration
 * @returns {Object} Day trading signal
 */
export function analyzeDayTrading(candles, config = {}) {
  const {
    minMomentum = DAY_TRADING_CONFIG.minMomentum,
    minVolumeRatio = DAY_TRADING_CONFIG.minVolumeRatio,
    minConfidence = DAY_TRADING_CONFIG.minConfidence
  } = config;

  if (candles.length < 50) {
    return {
      signal: 'hold',
      confidence: 0,
      reason: 'Insufficient data for day trading',
      strategy: 'day-trading'
    };
  }

  const closes = candles.map(c => c.c);
  const currentPrice = closes[closes.length - 1];

  // 1. Quick Momentum Check (last 5 candles)
  const recentCloses = closes.slice(-5);
  const quickMomentum = ((recentCloses[4] - recentCloses[0]) / recentCloses[0]) * 100;

  // 2. RSI for quick oversold/overbought
  const rsiValues = rsi(closes, 7); // Faster RSI for day trading
  const currentRSI = rsiValues[rsiValues.length - 1];

  // 3. MACD for momentum confirmation
  const macdResult = macd(closes, 8, 17, 9); // Faster MACD settings
  const currentMACD = {
    macd: macdResult.macd[macdResult.macd.length - 1],
    signal: macdResult.signal[macdResult.signal.length - 1],
    histogram: macdResult.histogram[macdResult.histogram.length - 1]
  };
  const prevHistogram = macdResult.histogram[macdResult.histogram.length - 2];

  // 4. EMA for quick trend
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const currentEMA9 = ema9[ema9.length - 1];
  const currentEMA21 = ema21[ema21.length - 1];

  // 5. Volume spike detection
  const volumeAnalysis = analyzeVolume(candles, 20);
  const volumeSpike = volumeAnalysis.volumeRatio > minVolumeRatio;

  let signal = 'hold';
  let confidence = 0;
  let reason = '';
  let entryType = null;

  // SCALP BUY CONDITIONS
  // 1. Quick Momentum Breakout
  if (
    quickMomentum > minMomentum &&
    currentRSI < 50 &&
    currentMACD.histogram > 0 &&
    currentPrice > currentEMA9 &&
    volumeSpike
  ) {
    signal = 'buy';
    entryType = 'momentum-breakout';

    // Calculate confidence
    const momentumStrength = Math.min(quickMomentum / 1.0, 1.0); // 0-1
    const rsiStrength = (50 - currentRSI) / 50; // 0-1 (lower RSI = stronger)
    const volumeStrength = Math.min((volumeAnalysis.volumeRatio - 1.0) / 1.0, 1.0);
    const macdStrength = currentMACD.histogram > prevHistogram ? 1.0 : 0.5;

    confidence = Math.round((
      momentumStrength * 0.35 +
      rsiStrength * 0.25 +
      volumeStrength * 0.25 +
      macdStrength * 0.15
    ) * 100);

    reason = `Momentum breakout: ${quickMomentum.toFixed(2)}% quick move, RSI ${currentRSI.toFixed(1)}, ${(volumeAnalysis.volumeRatio * 100).toFixed(0)}% volume`;
  }

  // 2. RSI Bounce from Oversold
  else if (
    currentRSI < 30 &&
    currentMACD.histogram > prevHistogram &&
    quickMomentum > 0 &&
    volumeSpike
  ) {
    signal = 'buy';
    entryType = 'rsi-bounce';

    const rsiStrength = (30 - currentRSI) / 30;
    const macdStrength = Math.abs(currentMACD.histogram) / 50;
    const volumeStrength = Math.min((volumeAnalysis.volumeRatio - 1.0) / 1.0, 1.0);

    confidence = Math.round((
      rsiStrength * 0.5 +
      macdStrength * 0.3 +
      volumeStrength * 0.2
    ) * 100);

    reason = `RSI bounce: ${currentRSI.toFixed(1)} oversold, MACD turning bullish, ${(volumeAnalysis.volumeRatio * 100).toFixed(0)}% volume`;
  }

  // 3. EMA Crossover Scalp
  else if (
    currentEMA9 > currentEMA21 &&
    ema9[ema9.length - 2] <= ema21[ema21.length - 2] && // Just crossed
    volumeSpike &&
    currentRSI > 40
  ) {
    signal = 'buy';
    entryType = 'ema-cross';

    confidence = 75; // EMA crosses are reliable

    reason = `EMA(9) crossed above EMA(21), ${(volumeAnalysis.volumeRatio * 100).toFixed(0)}% volume`;
  }

  // SCALP SELL CONDITIONS
  // 1. Quick Momentum Reversal
  else if (
    quickMomentum < -minMomentum &&
    currentRSI > 50 &&
    currentMACD.histogram < 0 &&
    currentPrice < currentEMA9 &&
    volumeSpike
  ) {
    signal = 'sell';
    entryType = 'momentum-reversal';

    const momentumStrength = Math.min(Math.abs(quickMomentum) / 1.0, 1.0);
    const rsiStrength = (currentRSI - 50) / 50;
    const volumeStrength = Math.min((volumeAnalysis.volumeRatio - 1.0) / 1.0, 1.0);

    confidence = Math.round((
      momentumStrength * 0.35 +
      rsiStrength * 0.25 +
      volumeStrength * 0.25 +
      0.15 // MACD bearish
    ) * 100);

    reason = `Momentum reversal: ${quickMomentum.toFixed(2)}% drop, RSI ${currentRSI.toFixed(1)}, ${(volumeAnalysis.volumeRatio * 100).toFixed(0)}% volume`;
  }

  // 2. RSI Overbought Rejection
  else if (
    currentRSI > 70 &&
    currentMACD.histogram < prevHistogram &&
    quickMomentum < 0 &&
    volumeSpike
  ) {
    signal = 'sell';
    entryType = 'rsi-rejection';

    const rsiStrength = (currentRSI - 70) / 30;
    const volumeStrength = Math.min((volumeAnalysis.volumeRatio - 1.0) / 1.0, 1.0);

    confidence = Math.round((
      rsiStrength * 0.5 +
      volumeStrength * 0.3 +
      0.2 // MACD bearish
    ) * 100);

    reason = `RSI rejection: ${currentRSI.toFixed(1)} overbought, MACD turning bearish`;
  }

  // Calculate expected move size
  const expectedMove = signal !== 'hold'
    ? (signal === 'buy' ? DAY_TRADING_CONFIG.takeProfitPercent : -DAY_TRADING_CONFIG.takeProfitPercent)
    : 0;

  return {
    signal,
    confidence,
    reason,
    strategy: 'day-trading',
    entryType,

    // Price levels
    currentPrice,
    targetPrice: signal === 'buy'
      ? currentPrice * (1 + DAY_TRADING_CONFIG.takeProfitPercent / 100)
      : currentPrice * (1 - DAY_TRADING_CONFIG.takeProfitPercent / 100),
    stopPrice: signal === 'buy'
      ? currentPrice * (1 - DAY_TRADING_CONFIG.stopLossPercent / 100)
      : currentPrice * (1 + DAY_TRADING_CONFIG.stopLossPercent / 100),

    // Indicators
    indicators: {
      quickMomentum: quickMomentum.toFixed(2),
      rsi: currentRSI.toFixed(1),
      macd: currentMACD.histogram.toFixed(2),
      ema9: currentEMA9.toFixed(2),
      ema21: currentEMA21.toFixed(2),
      volumeRatio: volumeAnalysis.volumeRatio.toFixed(2)
    },

    // Metrics
    expectedMove: expectedMove.toFixed(2),
    riskReward: (DAY_TRADING_CONFIG.takeProfitPercent / DAY_TRADING_CONFIG.stopLossPercent).toFixed(1),
    holdTimeMax: DAY_TRADING_CONFIG.holdTimeMax / 60000, // Convert to minutes

    timestamp: Date.now()
  };
}

/**
 * Check if should exit day trade
 * @param {Object} position - Current position
 * @param {number} currentPrice - Current market price
 * @param {number} entryTime - Entry timestamp
 * @returns {Object} Exit recommendation
 */
export function checkDayTradeExit(position, currentPrice, entryTime = null) {
  let shouldExit = false;
  let exitReason = null;
  let exitType = null;

  const holdTime = entryTime ? Date.now() - entryTime : 0;

  // 1. Take Profit Hit
  if (position.side === 'buy' && currentPrice >= position.takeProfitPrice) {
    shouldExit = true;
    exitReason = 'take-profit';
    exitType = 'target';
  } else if (position.side === 'sell' && currentPrice <= position.takeProfitPrice) {
    shouldExit = true;
    exitReason = 'take-profit';
    exitType = 'target';
  }

  // 2. Stop Loss Hit
  else if (position.side === 'buy' && currentPrice <= position.stopLossPrice) {
    shouldExit = true;
    exitReason = 'stop-loss';
    exitType = 'stop';
  } else if (position.side === 'sell' && currentPrice >= position.stopLossPrice) {
    shouldExit = true;
    exitReason = 'stop-loss';
    exitType = 'stop';
  }

  // 3. Max Hold Time Exceeded
  else if (holdTime > DAY_TRADING_CONFIG.holdTimeMax) {
    shouldExit = true;
    exitReason = 'max-hold-time';
    exitType = 'time';
  }

  // 4. Break Even After Min Hold Time (if near entry)
  else if (
    holdTime > DAY_TRADING_CONFIG.holdTimeMin &&
    Math.abs((currentPrice - position.entryPrice) / position.entryPrice) < 0.001
  ) {
    shouldExit = true;
    exitReason = 'break-even-timeout';
    exitType = 'time';
  }

  const profitPercent = position.side === 'buy'
    ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
    : ((position.entryPrice - currentPrice) / position.entryPrice) * 100;

  return {
    shouldExit,
    exitReason,
    exitType,
    currentPrice,
    profitPercent: profitPercent.toFixed(2),
    holdTime: Math.round(holdTime / 1000), // seconds
    holdTimeMinutes: (holdTime / 60000).toFixed(1)
  };
}

/**
 * Check daily trading limits
 * @param {Array} todaysTrades - Today's completed trades
 * @returns {Object} Limit status
 */
export function checkDayTradingLimits(todaysTrades) {
  const tradeCount = todaysTrades.length;
  const totalPnl = todaysTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const totalPnlPercent = todaysTrades.reduce((sum, t) => sum + (t.pnl_pct || 0), 0);

  const limitReached = {
    maxTrades: tradeCount >= DAY_TRADING_CONFIG.maxTradesPerDay,
    maxLoss: totalPnlPercent <= DAY_TRADING_CONFIG.maxLossPerDay,
    canTrade: true
  };

  // Stop trading if limits hit
  if (limitReached.maxTrades || limitReached.maxLoss) {
    limitReached.canTrade = false;
  }

  return {
    ...limitReached,
    tradeCount,
    tradesRemaining: Math.max(0, DAY_TRADING_CONFIG.maxTradesPerDay - tradeCount),
    totalPnl: totalPnl.toFixed(2),
    totalPnlPercent: totalPnlPercent.toFixed(2),
    reason: !limitReached.canTrade
      ? limitReached.maxTrades
        ? `Max trades reached (${tradeCount}/${DAY_TRADING_CONFIG.maxTradesPerDay})`
        : `Max daily loss reached (${totalPnlPercent.toFixed(2)}%)`
      : null
  };
}

/**
 * Validate if suitable for day trading
 * @param {Array} candles - Array of candles
 * @returns {Object} Suitability assessment
 */
export function isSuitableForDayTrading(candles) {
  if (candles.length < 50) {
    return {
      suitable: false,
      reason: 'Insufficient data',
      confidence: 0
    };
  }

  const closes = candles.map(c => c.c);

  // Calculate quick volatility (last 20 candles)
  const recentCloses = closes.slice(-20);
  const returns = [];
  for (let i = 1; i < recentCloses.length; i++) {
    returns.push((recentCloses[i] - recentCloses[i - 1]) / recentCloses[i - 1]);
  }
  const volatility = Math.sqrt(
    returns.reduce((sum, r) => sum + r * r, 0) / returns.length
  ) * 100;

  // Check volume activity
  const volumeAnalysis = analyzeVolume(candles, 20);
  const activeVolume = volumeAnalysis.volumeRatio > 1.0;

  // Day trading needs volatility + volume
  const volatilityScore = volatility >= 0.5 && volatility <= 5.0 ? 1.0 : 0.5;
  const volumeScore = activeVolume ? 1.0 : 0.5;

  const suitabilityScore = (volatilityScore * 0.6 + volumeScore * 0.4) * 100;
  const suitable = suitabilityScore >= 60;

  return {
    suitable,
    confidence: Math.round(suitabilityScore),
    reason: suitable
      ? `Good day trading conditions: ${volatility.toFixed(2)}% volatility, ${(volumeAnalysis.volumeRatio * 100).toFixed(0)}% volume`
      : `Poor conditions: ${volatility.toFixed(2)}% volatility, ${(volumeAnalysis.volumeRatio * 100).toFixed(0)}% volume`,
    metrics: {
      volatility: volatility.toFixed(2),
      volumeRatio: volumeAnalysis.volumeRatio.toFixed(2),
      volatilityScore,
      volumeScore
    }
  };
}

export default {
  DAY_TRADING_CONFIG,
  analyzeDayTrading,
  checkDayTradeExit,
  checkDayTradingLimits,
  isSuitableForDayTrading
};

/**
 * Momentum Trading Strategy
 *
 * Philosophy: "The trend is your friend - ride the wave"
 * Best for: Strong trending markets with clear direction
 *
 * Entry Signals:
 * - MACD bullish crossover + high volume + rising price → BUY
 * - MACD bearish crossover + high volume + falling price → SELL
 *
 * Exit Signals:
 * - MACD reversal signal
 * - Volume dries up
 * - Price breaks below trailing stop
 */

import { macd, ema, analyzeVolume, interpretMACD } from '../indicators-advanced.mjs';
import { momentum } from '../indicators.mjs';

/**
 * Momentum Strategy Configuration
 */
export const MOMENTUM_CONFIG = {
  name: 'Momentum',
  description: 'Rides strong trends with MACD and volume confirmation',

  // Indicator settings
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  emaPeriod: 20,
  momentumPeriod: 14,
  volumePeriod: 20,

  // Risk management
  stopLossPercent: 2.5,  // Wider stops for trend following
  takeProfitPercent: 6.0, // Let profits run
  useTrailingStop: true,
  trailingStopPercent: 2.0,

  // Signal requirements
  minConfidence: 60,
  minMomentum: 1.0, // Minimum 1% momentum
  minVolumeRatio: 1.2, // Volume must be 120% of average

  // Market conditions
  bestInRanging: false,
  bestInTrending: true,
  requiredVolatility: { min: 1.0, max: 10.0 } // Works in higher volatility
};

/**
 * Analyze market for momentum opportunities
 * @param {Array} candles - Array of candle objects
 * @param {Object} config - Strategy configuration
 * @returns {Object} Momentum signal
 */
export function analyzeMomentum(candles, config = {}) {
  const {
    macdFast = MOMENTUM_CONFIG.macdFast,
    macdSlow = MOMENTUM_CONFIG.macdSlow,
    macdSignal = MOMENTUM_CONFIG.macdSignal,
    emaPeriod = MOMENTUM_CONFIG.emaPeriod,
    momentumPeriod = MOMENTUM_CONFIG.momentumPeriod,
    volumePeriod = MOMENTUM_CONFIG.volumePeriod,
    minMomentum = MOMENTUM_CONFIG.minMomentum,
    minVolumeRatio = MOMENTUM_CONFIG.minVolumeRatio
  } = config;

  if (candles.length < 100) {
    return {
      signal: 'hold',
      confidence: 0,
      reason: 'Insufficient data for momentum analysis',
      strategy: 'momentum'
    };
  }

  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];

  // Calculate MACD
  const macdResult = macd(closes, macdFast, macdSlow, macdSignal);
  const currentMACD = {
    macd: macdResult.macd[macdResult.macd.length - 1],
    signal: macdResult.signal[macdResult.signal.length - 1],
    histogram: macdResult.histogram[macdResult.histogram.length - 1]
  };
  const prevHistogram = macdResult.histogram[macdResult.histogram.length - 2];
  const macdInterpretation = interpretMACD(currentMACD, prevHistogram);

  // Calculate EMA for trend direction
  const emaValues = ema(closes, emaPeriod);
  const currentEMA = emaValues[emaValues.length - 1];
  const aboveEMA = currentPrice > currentEMA;

  // Calculate price momentum
  const currentMomentum = momentum(closes, momentumPeriod);
  const momentumValue = currentMomentum[currentMomentum.length - 1];
  const momentumPercent = momentumValue / closes[closes.length - momentumPeriod - 1] * 100;

  // Analyze volume
  const volumeAnalysis = analyzeVolume(candles, volumePeriod);

  // Check for strong trend
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const currentEMA20 = ema20[ema20.length - 1];
  const currentEMA50 = ema50[ema50.length - 1];
  const trendStrength = Math.abs((currentEMA20 - currentEMA50) / currentEMA50) * 100;

  let signal = 'hold';
  let confidence = 0;
  let reason = '';

  // BULLISH MOMENTUM - Look for BUY
  if (
    macdInterpretation.signal === 'buy' &&
    aboveEMA &&
    momentumPercent > minMomentum &&
    volumeAnalysis.volumeRatio >= minVolumeRatio
  ) {
    signal = 'buy';

    // Confidence based on strength of indicators
    const macdStrength = macdInterpretation.strength; // 0-1
    const momentumStrength = Math.min(momentumPercent / 5.0, 1.0); // 0-1 (5% = max)
    const volumeStrength = Math.min((volumeAnalysis.volumeRatio - 1.0) / 0.5, 1.0); // 0-1
    const trendStrength = Math.min(trendStrength / 2.0, 1.0); // 0-1 (2% = strong)

    confidence = Math.round((
      macdStrength * 0.4 +
      momentumStrength * 0.3 +
      volumeStrength * 0.2 +
      trendStrength * 0.1
    ) * 100);

    reason = `Strong bullish momentum: MACD ${macdInterpretation.condition}, ${momentumPercent.toFixed(1)}% momentum, ${(volumeAnalysis.volumeRatio * 100).toFixed(0)}% volume`;
  }

  // BEARISH MOMENTUM - Look for SELL
  else if (
    macdInterpretation.signal === 'sell' &&
    !aboveEMA &&
    momentumPercent < -minMomentum &&
    volumeAnalysis.volumeRatio >= minVolumeRatio
  ) {
    signal = 'sell';

    // Confidence based on strength of indicators
    const macdStrength = macdInterpretation.strength;
    const momentumStrength = Math.min(Math.abs(momentumPercent) / 5.0, 1.0);
    const volumeStrength = Math.min((volumeAnalysis.volumeRatio - 1.0) / 0.5, 1.0);
    const trendStrength = Math.min(trendStrength / 2.0, 1.0);

    confidence = Math.round((
      macdStrength * 0.4 +
      momentumStrength * 0.3 +
      volumeStrength * 0.2 +
      trendStrength * 0.1
    ) * 100);

    reason = `Strong bearish momentum: MACD ${macdInterpretation.condition}, ${momentumPercent.toFixed(1)}% momentum, ${(volumeAnalysis.volumeRatio * 100).toFixed(0)}% volume`;
  }

  // NO CLEAR MOMENTUM
  else {
    confidence = 0;

    const issues = [];
    if (macdInterpretation.signal === 'neutral') issues.push('MACD neutral');
    if (Math.abs(momentumPercent) < minMomentum) issues.push(`Low momentum (${momentumPercent.toFixed(1)}%)`);
    if (volumeAnalysis.volumeRatio < minVolumeRatio) issues.push(`Low volume (${(volumeAnalysis.volumeRatio * 100).toFixed(0)}%)`);

    reason = `No strong momentum: ${issues.join(', ')}`;
  }

  return {
    signal,
    confidence,
    reason,
    strategy: 'momentum',

    // Price levels
    currentPrice,
    ema20: currentEMA20,
    ema50: currentEMA50,

    // Indicators
    indicators: {
      macd: {
        value: currentMACD.macd,
        signal: currentMACD.signal,
        histogram: currentMACD.histogram,
        interpretation: macdInterpretation
      },
      momentum: {
        value: momentumValue,
        percent: momentumPercent.toFixed(2),
        strong: Math.abs(momentumPercent) > minMomentum
      },
      volume: {
        current: volumeAnalysis.currentVolume,
        average: volumeAnalysis.avgVolume,
        ratio: volumeAnalysis.volumeRatio,
        strong: volumeAnalysis.aboveAverage
      },
      trend: {
        ema20: currentEMA20,
        ema50: currentEMA50,
        strength: trendStrength.toFixed(2),
        direction: currentEMA20 > currentEMA50 ? 'up' : 'down'
      }
    },

    // Metrics
    momentumPercent: momentumPercent.toFixed(2),
    trendStrength: trendStrength.toFixed(2),
    volumeRatio: volumeAnalysis.volumeRatio.toFixed(2),

    timestamp: Date.now()
  };
}

/**
 * Check if should exit momentum position
 * @param {Object} position - Current position
 * @param {Array} candles - Recent candles
 * @returns {Object} Exit recommendation
 */
export function checkMomentumExit(position, candles) {
  if (candles.length < 50) {
    return {
      shouldExit: false,
      exitReason: null
    };
  }

  const closes = candles.map(c => c.close);

  // Calculate MACD for reversal detection
  const macdResult = macd(closes, 12, 26, 9);
  const currentHistogram = macdResult.histogram[macdResult.histogram.length - 1];
  const prevHistogram = macdResult.histogram[macdResult.histogram.length - 2];

  // Check for MACD reversal
  let shouldExit = false;
  let exitReason = null;

  if (position.side === 'buy') {
    // Exit long if MACD crosses below signal
    if (currentHistogram < 0 && prevHistogram >= 0) {
      shouldExit = true;
      exitReason = 'momentum-reversal-bearish';
    }
  } else if (position.side === 'sell') {
    // Exit short if MACD crosses above signal
    if (currentHistogram > 0 && prevHistogram <= 0) {
      shouldExit = true;
      exitReason = 'momentum-reversal-bullish';
    }
  }

  // Check volume - exit if volume dries up
  const volumeAnalysis = analyzeVolume(candles, 20);
  if (!volumeAnalysis.aboveAverage && !shouldExit) {
    // Don't exit immediately, but reduce confidence
    return {
      shouldExit: false,
      exitReason: null,
      warning: 'Volume declining - consider tightening stop'
    };
  }

  return {
    shouldExit,
    exitReason,
    macdHistogram: currentHistogram,
    volumeRatio: volumeAnalysis.volumeRatio
  };
}

/**
 * Validate if market conditions are suitable for momentum trading
 * @param {Array} candles - Array of candles
 * @returns {Object} Suitability assessment
 */
export function isSuitableForMomentum(candles) {
  if (candles.length < 100) {
    return {
      suitable: false,
      reason: 'Insufficient data',
      confidence: 0
    };
  }

  const closes = candles.map(c => c.close);

  // Calculate trend strength (EMA separation)
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const currentEMA20 = ema20[ema20.length - 1];
  const currentEMA50 = ema50[ema50.length - 1];
  const emaSeparation = Math.abs((currentEMA20 - currentEMA50) / currentEMA50) * 100;

  // Calculate price momentum
  const currentMomentum = momentum(closes, 14);
  const momentumValue = currentMomentum[currentMomentum.length - 1];
  const momentumPercent = Math.abs(momentumValue / closes[closes.length - 15] * 100);

  // Calculate volatility
  const returns = [];
  for (let i = 1; i < Math.min(closes.length, 50); i++) {
    returns.push((closes[closes.length - i] - closes[closes.length - i - 1]) / closes[closes.length - i - 1]);
  }
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance) * 100;

  // Momentum works best when:
  // 1. Strong trend (EMA separation > 1%)
  // 2. High momentum (> 1%)
  // 3. Moderate to high volatility (> 1%)
  const trendScore = emaSeparation >= 1.0 ? 1.0 : emaSeparation / 1.0;
  const momentumScore = momentumPercent >= 1.0 ? 1.0 : momentumPercent / 1.0;
  const volatilityScore = volatility >= 1.0 ? 1.0 : volatility / 1.0;

  const suitabilityScore = (trendScore * 0.4 + momentumScore * 0.4 + volatilityScore * 0.2) * 100;
  const suitable = suitabilityScore >= 60;

  return {
    suitable,
    confidence: Math.round(suitabilityScore),
    reason: suitable
      ? `Strong trending market: ${emaSeparation.toFixed(2)}% trend, ${momentumPercent.toFixed(2)}% momentum`
      : `Weak trend: ${emaSeparation.toFixed(2)}% trend, ${momentumPercent.toFixed(2)}% momentum`,
    metrics: {
      emaSeparation: emaSeparation.toFixed(2),
      momentum: momentumPercent.toFixed(2),
      volatility: volatility.toFixed(2),
      trendScore,
      momentumScore,
      volatilityScore
    }
  };
}

export default {
  MOMENTUM_CONFIG,
  analyzeMomentum,
  checkMomentumExit,
  isSuitableForMomentum
};

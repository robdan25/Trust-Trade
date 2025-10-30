/**
 * Signal Composer
 * Combines multiple technical indicators into a single trading signal
 * Uses weighted voting system for better accuracy
 */

import {
  rsi,
  macd,
  bollingerBands,
  analyzeVolume,
  interpretRSI,
  interpretMACD,
  interpretBollingerBands
} from './indicators-advanced.mjs';
import { lastSmaSignal } from './indicators.mjs';

/**
 * Compose comprehensive trading signal from multiple indicators
 * @param {Array} candles - Array of candle objects
 * @param {Object} config - Configuration options
 * @returns {Object} Composite signal with confidence score
 */
export function composeSignal(candles, config = {}) {
  const {
    useSMA = true,
    useRSI = true,
    useMACD = true,
    useBollingerBands = true,
    useVolume = true,
    rsiPeriod = 14,
    macdFast = 12,
    macdSlow = 26,
    macdSignal = 9,
    bbPeriod = 20,
    bbStdDev = 2
  } = config;

  if (candles.length < 100) {
    return {
      signal: 'hold',
      confidence: 0,
      reason: 'Insufficient data for analysis',
      indicators: {}
    };
  }

  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];

  const signals = [];
  const indicators = {};

  // 1. SMA Crossover (Weight: 1.0)
  if (useSMA) {
    const smaResult = lastSmaSignal(closes, 12, 26);
    indicators.sma = {
      signal: smaResult.signal,
      crossoverIndex: smaResult.lastIdx,
      description: `SMA ${smaResult.signal.toUpperCase()}`
    };

    if (smaResult.signal === 'buy') {
      signals.push({ signal: 'buy', weight: 1.0, source: 'SMA' });
    } else if (smaResult.signal === 'sell') {
      signals.push({ signal: 'sell', weight: 1.0, source: 'SMA' });
    }
  }

  // 2. RSI (Weight: 0.9)
  if (useRSI) {
    const rsiValues = rsi(closes, rsiPeriod);
    const currentRSI = rsiValues[rsiValues.length - 1];
    const rsiInterpretation = interpretRSI(currentRSI);

    indicators.rsi = {
      value: currentRSI,
      signal: rsiInterpretation.signal,
      condition: rsiInterpretation.condition,
      description: rsiInterpretation.description
    };

    if (rsiInterpretation.signal !== 'neutral') {
      signals.push({
        signal: rsiInterpretation.signal,
        weight: 0.9 * rsiInterpretation.strength,
        source: 'RSI'
      });
    }
  }

  // 3. MACD (Weight: 1.0)
  if (useMACD) {
    const macdResult = macd(closes, macdFast, macdSlow, macdSignal);
    const currentMACD = {
      macd: macdResult.macd[macdResult.macd.length - 1],
      signal: macdResult.signal[macdResult.signal.length - 1],
      histogram: macdResult.histogram[macdResult.histogram.length - 1]
    };
    const prevHistogram = macdResult.histogram[macdResult.histogram.length - 2];
    const macdInterpretation = interpretMACD(currentMACD, prevHistogram);

    indicators.macd = {
      value: currentMACD.macd,
      signalLine: currentMACD.signal,
      histogram: currentMACD.histogram,
      signal: macdInterpretation.signal,
      condition: macdInterpretation.condition,
      description: macdInterpretation.description
    };

    if (macdInterpretation.signal !== 'neutral') {
      signals.push({
        signal: macdInterpretation.signal,
        weight: 1.0 * macdInterpretation.strength,
        source: 'MACD'
      });
    }
  }

  // 4. Bollinger Bands (Weight: 0.8)
  if (useBollingerBands) {
    const bb = bollingerBands(closes, bbPeriod, bbStdDev);
    const currentBB = {
      upper: bb.upper[bb.upper.length - 1],
      middle: bb.middle[bb.middle.length - 1],
      lower: bb.lower[bb.lower.length - 1]
    };
    const bbInterpretation = interpretBollingerBands(currentPrice, currentBB);

    indicators.bollingerBands = {
      upper: currentBB.upper,
      middle: currentBB.middle,
      lower: currentBB.lower,
      signal: bbInterpretation.signal,
      condition: bbInterpretation.condition,
      description: bbInterpretation.description
    };

    if (bbInterpretation.signal !== 'neutral') {
      signals.push({
        signal: bbInterpretation.signal,
        weight: 0.8 * bbInterpretation.strength,
        source: 'BB'
      });
    }
  }

  // 5. Volume Confirmation (Weight: 0.5)
  if (useVolume) {
    const volumeAnalysis = analyzeVolume(candles, 20);

    indicators.volume = {
      current: volumeAnalysis.currentVolume,
      average: volumeAnalysis.avgVolume,
      ratio: volumeAnalysis.volumeRatio,
      increasing: volumeAnalysis.increasing,
      aboveAverage: volumeAnalysis.aboveAverage,
      description: volumeAnalysis.aboveAverage
        ? `Volume ${(volumeAnalysis.volumeRatio * 100).toFixed(0)}% of average - Strong`
        : `Volume ${(volumeAnalysis.volumeRatio * 100).toFixed(0)}% of average - Weak`
    };

    // Volume confirms other signals
    if (volumeAnalysis.aboveAverage) {
      // Boost buy signals if volume is high
      const buySignals = signals.filter(s => s.signal === 'buy');
      if (buySignals.length > 0) {
        signals.push({ signal: 'buy', weight: 0.5, source: 'Volume' });
      }

      // Boost sell signals if volume is high
      const sellSignals = signals.filter(s => s.signal === 'sell');
      if (sellSignals.length > 0) {
        signals.push({ signal: 'sell', weight: 0.5, source: 'Volume' });
      }
    }
  }

  // Calculate weighted vote
  let buyScore = 0;
  let sellScore = 0;

  for (const sig of signals) {
    if (sig.signal === 'buy') {
      buyScore += sig.weight;
    } else if (sig.signal === 'sell') {
      sellScore += sig.weight;
    }
  }

  // Determine final signal
  let finalSignal = 'hold';
  let confidence = 0;

  const totalWeight = buyScore + sellScore;

  if (totalWeight === 0) {
    finalSignal = 'hold';
    confidence = 0;
  } else if (buyScore > sellScore) {
    finalSignal = 'buy';
    confidence = buyScore / totalWeight;
  } else if (sellScore > buyScore) {
    finalSignal = 'sell';
    confidence = sellScore / totalWeight;
  }

  // Build reason string
  const buySignals = signals.filter(s => s.signal === 'buy');
  const sellSignals = signals.filter(s => s.signal === 'sell');

  let reason = '';
  if (finalSignal === 'buy') {
    reason = `${buySignals.length} bullish indicators: ${buySignals.map(s => s.source).join(', ')}`;
  } else if (finalSignal === 'sell') {
    reason = `${sellSignals.length} bearish indicators: ${sellSignals.map(s => s.source).join(', ')}`;
  } else {
    reason = 'Mixed signals, no clear direction';
  }

  return {
    signal: finalSignal,
    confidence: Math.round(confidence * 100),
    buyScore: buyScore.toFixed(2),
    sellScore: sellScore.toFixed(2),
    reason,
    indicators,
    signals: signals.map(s => ({
      source: s.source,
      signal: s.signal,
      weight: s.weight.toFixed(2)
    })),
    price: currentPrice,
    timestamp: Date.now()
  };
}

/**
 * Check if signal is strong enough to trade
 * @param {Object} composedSignal - Signal from composeSignal()
 * @param {number} minConfidence - Minimum confidence threshold (0-100)
 * @returns {boolean} True if signal is strong enough
 */
export function isSignalStrong(composedSignal, minConfidence = 60) {
  return composedSignal.signal !== 'hold' && composedSignal.confidence >= minConfidence;
}

/**
 * Get signal strength description
 * @param {number} confidence - Confidence score (0-100)
 * @returns {string} Strength description
 */
export function getSignalStrength(confidence) {
  if (confidence >= 80) return 'Very Strong';
  if (confidence >= 70) return 'Strong';
  if (confidence >= 60) return 'Moderate';
  if (confidence >= 50) return 'Weak';
  return 'Very Weak';
}

export default {
  composeSignal,
  isSignalStrong,
  getSignalStrength
};

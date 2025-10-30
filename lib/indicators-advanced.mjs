/**
 * Advanced Technical Indicators
 * RSI, MACD, Bollinger Bands, Volume Analysis, ATR
 */

/**
 * Calculate RSI (Relative Strength Index)
 * Measures overbought/oversold conditions
 * @param {Array} closes - Array of closing prices
 * @param {number} period - RSI period (default 14)
 * @returns {Array} RSI values (0-100)
 */
export function rsi(closes, period = 14) {
  const rsiValues = new Array(closes.length).fill(null);

  if (closes.length < period + 1) {
    return rsiValues;
  }

  let gains = 0;
  let losses = 0;

  // Calculate initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // First RSI value
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsiValues[period] = 100 - (100 / (1 + rs));

  // Calculate RSI for remaining periods using smoothed averages
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues[i] = 100 - (100 / (1 + rs));
  }

  return rsiValues;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * Trend-following momentum indicator
 * @param {Array} closes - Array of closing prices
 * @param {number} fastPeriod - Fast EMA period (default 12)
 * @param {number} slowPeriod - Slow EMA period (default 26)
 * @param {number} signalPeriod - Signal line period (default 9)
 * @returns {Object} { macd, signal, histogram }
 */
export function macd(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const emaFast = ema(closes, fastPeriod);
  const emaSlow = ema(closes, slowPeriod);

  // MACD line = Fast EMA - Slow EMA
  const macdLine = closes.map((_, i) => {
    if (emaFast[i] === null || emaSlow[i] === null) return null;
    return emaFast[i] - emaSlow[i];
  });

  // Signal line = EMA of MACD line
  const signalLine = ema(macdLine.map(v => v === null ? 0 : v), signalPeriod);

  // Histogram = MACD - Signal
  const histogram = macdLine.map((m, i) => {
    if (m === null || signalLine[i] === null) return null;
    return m - signalLine[i];
  });

  return {
    macd: macdLine,
    signal: signalLine,
    histogram
  };
}

/**
 * Calculate EMA (Exponential Moving Average)
 * Helper function for MACD
 * @param {Array} values - Array of values
 * @param {number} period - EMA period
 * @returns {Array} EMA values
 */
export function ema(values, period) {
  const emaValues = new Array(values.length).fill(null);
  const multiplier = 2 / (period + 1);

  // Start with SMA for first value
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  emaValues[period - 1] = sum / period;

  // Calculate EMA for remaining values
  for (let i = period; i < values.length; i++) {
    emaValues[i] = (values[i] - emaValues[i - 1]) * multiplier + emaValues[i - 1];
  }

  return emaValues;
}

/**
 * Calculate Bollinger Bands
 * Volatility indicator showing overbought/oversold
 * @param {Array} closes - Array of closing prices
 * @param {number} period - Period for moving average (default 20)
 * @param {number} stdDev - Standard deviations (default 2)
 * @returns {Object} { upper, middle, lower }
 */
export function bollingerBands(closes, period = 20, stdDev = 2) {
  const middle = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    const sd = Math.sqrt(variance);

    upper[i] = mean + (sd * stdDev);
    lower[i] = mean - (sd * stdDev);
  }

  return { upper, middle, lower };
}

/**
 * Calculate ATR (Average True Range)
 * Volatility indicator for stop-loss placement
 * @param {Array} candles - Array of candle objects {h, l, c}
 * @param {number} period - ATR period (default 14)
 * @returns {Array} ATR values
 */
export function atr(candles, period = 14) {
  const atrValues = new Array(candles.length).fill(null);
  const trueRanges = [];

  // Calculate True Range for each candle
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].h;
    const low = candles[i].l;
    const prevClose = candles[i - 1].c;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  // Calculate initial ATR (SMA of true ranges)
  let sum = 0;
  for (let i = 0; i < period && i < trueRanges.length; i++) {
    sum += trueRanges[i];
  }
  atrValues[period] = sum / period;

  // Calculate smoothed ATR
  for (let i = period + 1; i < candles.length; i++) {
    atrValues[i] = (atrValues[i - 1] * (period - 1) + trueRanges[i - 1]) / period;
  }

  return atrValues;
}

/**
 * Simple Moving Average (from existing indicators.mjs)
 * @param {Array} values - Array of values
 * @param {number} n - Period
 * @returns {Array} SMA values
 */
function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/**
 * Analyze volume for confirmation
 * @param {Array} candles - Array of candle objects with volume
 * @param {number} period - Period for average volume (default 20)
 * @returns {Object} Volume analysis
 */
export function analyzeVolume(candles, period = 20) {
  if (candles.length < period) {
    return {
      currentVolume: candles[candles.length - 1]?.v || 0,
      avgVolume: 0,
      volumeRatio: 0,
      increasing: false
    };
  }

  const volumes = candles.map(c => c.v || 0);
  const currentVolume = volumes[volumes.length - 1];

  // Calculate average volume
  const recentVolumes = volumes.slice(-period);
  const avgVolume = recentVolumes.reduce((sum, v) => sum + v, 0) / period;

  // Volume ratio (current vs average)
  const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 0;

  // Is volume increasing?
  const lastThreeVolumes = volumes.slice(-3);
  const increasing = lastThreeVolumes.length === 3 &&
                    lastThreeVolumes[2] > lastThreeVolumes[1] &&
                    lastThreeVolumes[1] > lastThreeVolumes[0];

  return {
    currentVolume,
    avgVolume,
    volumeRatio,
    increasing,
    aboveAverage: volumeRatio > 1.2 // 20% above average
  };
}

/**
 * Get RSI signal interpretation
 * @param {number} rsiValue - Current RSI value
 * @returns {Object} Signal interpretation
 */
export function interpretRSI(rsiValue) {
  if (rsiValue === null) {
    return { signal: 'neutral', strength: 0, condition: 'calculating' };
  }

  if (rsiValue > 70) {
    return {
      signal: 'sell',
      strength: Math.min((rsiValue - 70) / 30, 1),
      condition: 'overbought',
      description: `RSI at ${rsiValue.toFixed(1)} - Overbought`
    };
  } else if (rsiValue < 30) {
    return {
      signal: 'buy',
      strength: Math.min((30 - rsiValue) / 30, 1),
      condition: 'oversold',
      description: `RSI at ${rsiValue.toFixed(1)} - Oversold`
    };
  } else if (rsiValue > 60) {
    return {
      signal: 'sell',
      strength: 0.3,
      condition: 'strong',
      description: `RSI at ${rsiValue.toFixed(1)} - Bullish but strong`
    };
  } else if (rsiValue < 40) {
    return {
      signal: 'buy',
      strength: 0.3,
      condition: 'weak',
      description: `RSI at ${rsiValue.toFixed(1)} - Bearish but weak`
    };
  }

  return {
    signal: 'neutral',
    strength: 0,
    condition: 'neutral',
    description: `RSI at ${rsiValue.toFixed(1)} - Neutral`
  };
}

/**
 * Get MACD signal interpretation
 * @param {Object} macdData - MACD values at current index
 * @param {number} prevHistogram - Previous histogram value
 * @returns {Object} Signal interpretation
 */
export function interpretMACD(macdData, prevHistogram) {
  const { macd: macdValue, signal: signalValue, histogram: histValue } = macdData;

  if (macdValue === null || signalValue === null || histValue === null) {
    return { signal: 'neutral', strength: 0, condition: 'calculating' };
  }

  // Bullish crossover: MACD crosses above signal
  if (histValue > 0 && prevHistogram <= 0) {
    return {
      signal: 'buy',
      strength: 0.8,
      condition: 'bullish_crossover',
      description: 'MACD crossed above signal - Bullish'
    };
  }

  // Bearish crossover: MACD crosses below signal
  if (histValue < 0 && prevHistogram >= 0) {
    return {
      signal: 'sell',
      strength: 0.8,
      condition: 'bearish_crossover',
      description: 'MACD crossed below signal - Bearish'
    };
  }

  // MACD above signal (bullish)
  if (histValue > 0) {
    return {
      signal: 'buy',
      strength: Math.min(Math.abs(histValue) / 100, 0.5),
      condition: 'bullish',
      description: 'MACD above signal - Bullish momentum'
    };
  }

  // MACD below signal (bearish)
  if (histValue < 0) {
    return {
      signal: 'sell',
      strength: Math.min(Math.abs(histValue) / 100, 0.5),
      condition: 'bearish',
      description: 'MACD below signal - Bearish momentum'
    };
  }

  return {
    signal: 'neutral',
    strength: 0,
    condition: 'neutral',
    description: 'MACD neutral'
  };
}

/**
 * Get Bollinger Bands signal interpretation
 * @param {number} currentPrice - Current price
 * @param {Object} bbData - Bollinger Bands values
 * @returns {Object} Signal interpretation
 */
export function interpretBollingerBands(currentPrice, bbData) {
  const { upper, middle, lower } = bbData;

  if (upper === null || middle === null || lower === null) {
    return { signal: 'neutral', strength: 0, condition: 'calculating' };
  }

  const bandwidth = upper - lower;
  const percentB = (currentPrice - lower) / bandwidth;

  // Price at or below lower band - oversold
  if (percentB <= 0.1) {
    return {
      signal: 'buy',
      strength: 0.7,
      condition: 'oversold',
      description: 'Price at lower Bollinger Band - Oversold'
    };
  }

  // Price at or above upper band - overbought
  if (percentB >= 0.9) {
    return {
      signal: 'sell',
      strength: 0.7,
      condition: 'overbought',
      description: 'Price at upper Bollinger Band - Overbought'
    };
  }

  // Price near middle
  if (percentB >= 0.4 && percentB <= 0.6) {
    return {
      signal: 'neutral',
      strength: 0,
      condition: 'neutral',
      description: 'Price at middle Bollinger Band'
    };
  }

  return {
    signal: percentB > 0.5 ? 'sell' : 'buy',
    strength: 0.3,
    condition: 'normal',
    description: `Price at ${(percentB * 100).toFixed(0)}% of Bollinger Bands`
  };
}

export default {
  rsi,
  macd,
  ema,
  bollingerBands,
  atr,
  analyzeVolume,
  interpretRSI,
  interpretMACD,
  interpretBollingerBands
};

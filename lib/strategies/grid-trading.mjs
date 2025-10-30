/**
 * Grid Trading Strategy
 *
 * Philosophy: "Profit from price oscillations in any direction"
 * Best for: Sideways/ranging markets with predictable volatility
 *
 * How it works:
 * - Places buy orders below current price at intervals
 * - Places sell orders above current price at intervals
 * - Profits from price bouncing between grid levels
 * - No prediction needed - profits from volatility itself
 *
 * Entry Signals:
 * - Price hits buy grid level → BUY
 * - Price hits sell grid level → SELL
 *
 * Exit Signals:
 * - Price moves to next grid level (take profit)
 * - Grid bounds exceeded (stop loss)
 */

import { atr } from '../indicators-advanced.mjs';
import { sma } from '../indicators.mjs';

/**
 * Grid Trading Strategy Configuration
 */
export const GRID_CONFIG = {
  name: 'Grid Trading',
  description: 'Places buy/sell orders at price intervals to profit from volatility',

  // Grid settings
  gridLevels: 10,          // Number of price levels above and below
  gridSpacing: 0.5,        // % spacing between levels
  useATRForSpacing: true,  // Use ATR instead of fixed %

  // Position management
  maxPositions: 5,         // Max simultaneous grid positions
  positionSizePercent: 20, // % of capital per grid level

  // Risk management
  stopLossPercent: 5.0,    // Exit if price breaks grid bounds
  takeProfitPercent: 1.0,  // Profit at next grid level

  // Signal requirements
  minConfidence: 50, // Lower threshold - grid doesn't predict direction

  // Market conditions
  bestInRanging: true,
  bestInTrending: false,
  requiredVolatility: { min: 0.3, max: 2.0 } // Works in low-moderate volatility
};

/**
 * Calculate grid levels based on current price and volatility
 * @param {number} currentPrice - Current market price
 * @param {Array} candles - Array of candle objects
 * @param {Object} config - Grid configuration
 * @returns {Object} Grid structure
 */
export function calculateGridLevels(currentPrice, candles, config = {}) {
  const {
    gridLevels = GRID_CONFIG.gridLevels,
    gridSpacing = GRID_CONFIG.gridSpacing,
    useATRForSpacing = GRID_CONFIG.useATRForSpacing
  } = config;

  let spacing = gridSpacing;

  // Use ATR for dynamic grid spacing
  if (useATRForSpacing && candles.length >= 20) {
    const atrValues = atr(candles, 14);
    const currentATR = atrValues[atrValues.length - 1];
    spacing = (currentATR / currentPrice) * 100; // Convert ATR to percentage
  }

  const buyLevels = [];
  const sellLevels = [];

  // Create buy levels below current price
  for (let i = 1; i <= gridLevels; i++) {
    const price = currentPrice * (1 - (spacing * i) / 100);
    buyLevels.push({
      level: i,
      price: price,
      type: 'buy',
      filled: false,
      orderId: null
    });
  }

  // Create sell levels above current price
  for (let i = 1; i <= gridLevels; i++) {
    const price = currentPrice * (1 + (spacing * i) / 100);
    sellLevels.push({
      level: i,
      price: price,
      type: 'sell',
      filled: false,
      orderId: null
    });
  }

  const gridRange = {
    lower: buyLevels[buyLevels.length - 1].price,
    upper: sellLevels[sellLevels.length - 1].price,
    center: currentPrice,
    spacing: spacing.toFixed(2)
  };

  return {
    buyLevels,
    sellLevels,
    gridRange,
    totalLevels: gridLevels * 2,
    spacing: spacing.toFixed(2)
  };
}

/**
 * Analyze market for grid trading opportunities
 * @param {Array} candles - Array of candle objects
 * @param {Object} config - Strategy configuration
 * @param {Object} activeGrid - Currently active grid (if any)
 * @returns {Object} Grid trading signal
 */
export function analyzeGridTrading(candles, config = {}, activeGrid = null) {
  if (candles.length < 50) {
    return {
      signal: 'hold',
      confidence: 0,
      reason: 'Insufficient data for grid trading',
      strategy: 'grid-trading'
    };
  }

  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];

  // If no active grid, create one
  if (!activeGrid) {
    const grid = calculateGridLevels(currentPrice, candles, config);

    return {
      signal: 'setup',
      confidence: 70, // Always confident to setup grid in suitable conditions
      reason: `Grid setup: ${grid.totalLevels} levels, ${grid.spacing}% spacing`,
      strategy: 'grid-trading',
      grid,
      currentPrice,
      timestamp: Date.now()
    };
  }

  // Check if price hit any grid level
  const { buyLevels, sellLevels, gridRange } = activeGrid;

  let signal = 'hold';
  let confidence = 0;
  let reason = '';
  let triggeredLevel = null;

  // Check buy levels
  for (const level of buyLevels) {
    if (!level.filled && currentPrice <= level.price) {
      signal = 'buy';
      confidence = 70;
      reason = `Price hit buy grid level ${level.level} at $${level.price.toFixed(2)}`;
      triggeredLevel = level;
      break;
    }
  }

  // Check sell levels
  if (signal === 'hold') {
    for (const level of sellLevels) {
      if (!level.filled && currentPrice >= level.price) {
        signal = 'sell';
        confidence = 70;
        reason = `Price hit sell grid level ${level.level} at $${level.price.toFixed(2)}`;
        triggeredLevel = level;
        break;
      }
    }
  }

  // Check if price broke grid bounds (stop loss condition)
  const breakoutUp = currentPrice > gridRange.upper * 1.05; // 5% above upper bound
  const breakoutDown = currentPrice < gridRange.lower * 0.95; // 5% below lower bound

  if (breakoutUp || breakoutDown) {
    return {
      signal: 'exit-all',
      confidence: 90,
      reason: breakoutUp
        ? `Price broke above grid (${currentPrice.toFixed(2)} > ${gridRange.upper.toFixed(2)})`
        : `Price broke below grid (${currentPrice.toFixed(2)} < ${gridRange.lower.toFixed(2)})`,
      strategy: 'grid-trading',
      breakout: true,
      direction: breakoutUp ? 'up' : 'down',
      currentPrice,
      gridRange,
      timestamp: Date.now()
    };
  }

  // Calculate grid statistics
  const filledBuyLevels = buyLevels.filter(l => l.filled).length;
  const filledSellLevels = sellLevels.filter(l => l.filled).length;
  const totalFilled = filledBuyLevels + filledSellLevels;
  const gridUtilization = (totalFilled / (buyLevels.length + sellLevels.length)) * 100;

  return {
    signal,
    confidence,
    reason,
    strategy: 'grid-trading',
    grid: activeGrid,
    triggeredLevel,
    currentPrice,
    gridRange,
    statistics: {
      filledBuyLevels,
      filledSellLevels,
      totalFilled,
      gridUtilization: gridUtilization.toFixed(1)
    },
    timestamp: Date.now()
  };
}

/**
 * Check if should close a grid position
 * @param {Object} position - Grid position
 * @param {number} currentPrice - Current market price
 * @param {Object} grid - Active grid
 * @returns {Object} Exit recommendation
 */
export function checkGridExit(position, currentPrice, grid) {
  const { buyLevels, sellLevels, gridRange } = grid;

  let shouldExit = false;
  let exitReason = null;
  let targetLevel = null;

  // For buy positions, close when price reaches next sell level
  if (position.side === 'buy') {
    for (const level of sellLevels) {
      if (currentPrice >= level.price) {
        shouldExit = true;
        exitReason = 'grid-take-profit';
        targetLevel = level;
        break;
      }
    }
  }

  // For sell positions, close when price reaches next buy level
  if (position.side === 'sell') {
    for (const level of buyLevels) {
      if (currentPrice <= level.price) {
        shouldExit = true;
        exitReason = 'grid-take-profit';
        targetLevel = level;
        break;
      }
    }
  }

  // Check for grid bounds breakout
  if (currentPrice > gridRange.upper * 1.05 || currentPrice < gridRange.lower * 0.95) {
    shouldExit = true;
    exitReason = 'grid-bounds-exceeded';
  }

  const profitPercent = position.side === 'buy'
    ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
    : ((position.entryPrice - currentPrice) / position.entryPrice) * 100;

  return {
    shouldExit,
    exitReason,
    targetLevel,
    profitPercent: profitPercent.toFixed(2),
    currentPrice
  };
}

/**
 * Validate if market conditions are suitable for grid trading
 * @param {Array} candles - Array of candles
 * @returns {Object} Suitability assessment
 */
export function isSuitableForGridTrading(candles) {
  if (candles.length < 100) {
    return {
      suitable: false,
      reason: 'Insufficient data',
      confidence: 0
    };
  }

  const closes = candles.map(c => c.close);

  // Calculate volatility
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance) * 100;

  // Check if price is ranging (oscillating around mean)
  const sma50 = sma(closes, 50);
  const currentSMA = sma50[sma50.length - 1];

  let touchCount = 0;
  let maxDeviation = 0;

  for (let i = closes.length - 50; i < closes.length; i++) {
    if (sma50[i] !== null) {
      const deviation = Math.abs((closes[i] - sma50[i]) / sma50[i]) * 100;
      maxDeviation = Math.max(maxDeviation, deviation);

      // Count price crosses of SMA
      if (i > 0 && sma50[i - 1] !== null) {
        const prevAbove = closes[i - 1] > sma50[i - 1];
        const currAbove = closes[i] > sma50[i];
        if (prevAbove !== currAbove) touchCount++;
      }
    }
  }

  // Grid trading works best when:
  // 1. Low to moderate volatility (0.3% - 2.0%)
  // 2. Price oscillates around mean (multiple SMA crosses)
  // 3. Price stays within bounds (max deviation < 5%)
  const volatilityScore = volatility >= 0.3 && volatility <= 2.0 ? 1.0 : 0.5;
  const rangingScore = touchCount >= 5 ? 1.0 : touchCount / 5; // At least 5 crosses
  const boundsScore = maxDeviation <= 5.0 ? 1.0 : 0.5;

  const suitabilityScore = (volatilityScore * 0.4 + rangingScore * 0.4 + boundsScore * 0.2) * 100;
  const suitable = suitabilityScore >= 60;

  return {
    suitable,
    confidence: Math.round(suitabilityScore),
    reason: suitable
      ? `Good ranging market: ${volatility.toFixed(2)}% volatility, ${touchCount} price oscillations`
      : `Not ideal: ${volatility.toFixed(2)}% volatility, ${touchCount} oscillations, ${maxDeviation.toFixed(1)}% max deviation`,
    metrics: {
      volatility: volatility.toFixed(2),
      oscillations: touchCount,
      maxDeviation: maxDeviation.toFixed(2),
      volatilityScore,
      rangingScore,
      boundsScore
    }
  };
}

export default {
  GRID_CONFIG,
  calculateGridLevels,
  analyzeGridTrading,
  checkGridExit,
  isSuitableForGridTrading
};

/**
 * Advanced Risk Management Module
 *
 * Features:
 * - Circuit breakers (halt trading after consecutive losses)
 * - Portfolio-level risk limits
 * - VaR (Value at Risk) calculations
 * - Drawdown monitoring
 * - Kelly Criterion position sizing
 */

import { getAllTrades } from './database.mjs';

// Circuit breaker state
let circuitBreakerState = {
  isTripped: false,
  tripTime: null,
  consecutiveLosses: 0,
  cooldownPeriod: 60 * 60 * 1000, // 1 hour default
  maxConsecutiveLosses: 3 // Trip after 3 consecutive losses
};

// Portfolio risk limits
let portfolioLimits = {
  maxExposurePerSymbol: 0.25, // 25% of portfolio max per symbol
  maxTotalExposure: 0.75, // 75% of portfolio max in all active trades
  maxDrawdownPercent: 0.20, // 20% max drawdown before halting
  maxDailyLossPercent: 0.10 // 10% max daily loss
};

/**
 * Circuit Breaker: Check if we should halt trading
 */
export function checkCircuitBreaker() {
  // Check if circuit breaker is tripped
  if (circuitBreakerState.isTripped) {
    const now = Date.now();
    const timeSinceTrip = now - circuitBreakerState.tripTime;

    // Check if cooldown period has elapsed
    if (timeSinceTrip >= circuitBreakerState.cooldownPeriod) {
      // Reset circuit breaker
      circuitBreakerState.isTripped = false;
      circuitBreakerState.tripTime = null;
      circuitBreakerState.consecutiveLosses = 0;
      return {
        halted: false,
        reason: 'Circuit breaker reset after cooldown',
        consecutiveLosses: 0
      };
    }

    // Still in cooldown
    const remainingCooldown = circuitBreakerState.cooldownPeriod - timeSinceTrip;
    return {
      halted: true,
      reason: `Circuit breaker tripped: ${circuitBreakerState.consecutiveLosses} consecutive losses`,
      remainingCooldown: Math.ceil(remainingCooldown / 1000 / 60), // minutes
      tripTime: circuitBreakerState.tripTime
    };
  }

  return {
    halted: false,
    consecutiveLosses: circuitBreakerState.consecutiveLosses
  };
}

/**
 * Update circuit breaker after a trade
 */
export function updateCircuitBreaker(tradePnL) {
  if (tradePnL < 0) {
    // Loss - increment counter
    circuitBreakerState.consecutiveLosses++;

    // Check if we should trip
    if (circuitBreakerState.consecutiveLosses >= circuitBreakerState.maxConsecutiveLosses) {
      circuitBreakerState.isTripped = true;
      circuitBreakerState.tripTime = Date.now();
      return {
        tripped: true,
        consecutiveLosses: circuitBreakerState.consecutiveLosses,
        cooldownMinutes: circuitBreakerState.cooldownPeriod / 1000 / 60
      };
    }
  } else if (tradePnL > 0) {
    // Win - reset counter
    circuitBreakerState.consecutiveLosses = 0;
  }

  return {
    tripped: false,
    consecutiveLosses: circuitBreakerState.consecutiveLosses
  };
}

/**
 * Get circuit breaker configuration
 */
export function getCircuitBreakerConfig() {
  return {
    ...circuitBreakerState,
    cooldownMinutes: circuitBreakerState.cooldownPeriod / 1000 / 60
  };
}

/**
 * Update circuit breaker configuration
 */
export function updateCircuitBreakerConfig(config) {
  if (config.maxConsecutiveLosses !== undefined) {
    circuitBreakerState.maxConsecutiveLosses = config.maxConsecutiveLosses;
  }
  if (config.cooldownMinutes !== undefined) {
    circuitBreakerState.cooldownPeriod = config.cooldownMinutes * 60 * 1000;
  }
  return getCircuitBreakerConfig();
}

/**
 * Manually reset circuit breaker
 */
export function resetCircuitBreaker() {
  circuitBreakerState.isTripped = false;
  circuitBreakerState.tripTime = null;
  circuitBreakerState.consecutiveLosses = 0;
  return { ok: true, message: 'Circuit breaker reset' };
}

/**
 * Calculate Value at Risk (VaR)
 * Historical VaR using percentile method
 */
export function calculateVaR(trades, confidence = 0.95, portfolioValue = 10000) {
  if (!trades || trades.length < 10) {
    return {
      dailyVaR: 0,
      weeklyVaR: 0,
      monthlyVaR: 0,
      confidence,
      message: 'Insufficient trade history for VaR calculation (need at least 10 trades)'
    };
  }

  // Get closed trades with P&L
  const closedTrades = trades.filter(t => t.status === 'closed' && t.pnl !== undefined);

  if (closedTrades.length < 10) {
    return {
      dailyVaR: 0,
      weeklyVaR: 0,
      monthlyVaR: 0,
      confidence,
      message: 'Insufficient closed trades for VaR calculation'
    };
  }

  // Calculate returns as percentage of portfolio
  const returns = closedTrades.map(t => (t.pnl / portfolioValue) * 100);

  // Sort returns (ascending, so losses are first)
  const sortedReturns = [...returns].sort((a, b) => a - b);

  // Find the percentile (e.g., 5th percentile for 95% confidence)
  const percentileIndex = Math.floor((1 - confidence) * sortedReturns.length);
  const dailyVaR = Math.abs(sortedReturns[percentileIndex] || 0);

  // Scale to weekly and monthly (simplified: assumes independence)
  const weeklyVaR = dailyVaR * Math.sqrt(7);
  const monthlyVaR = dailyVaR * Math.sqrt(30);

  return {
    dailyVaR: parseFloat(dailyVaR.toFixed(2)),
    weeklyVaR: parseFloat(weeklyVaR.toFixed(2)),
    monthlyVaR: parseFloat(monthlyVaR.toFixed(2)),
    dailyVaRDollar: parseFloat((dailyVaR * portfolioValue / 100).toFixed(2)),
    weeklyVaRDollar: parseFloat((weeklyVaR * portfolioValue / 100).toFixed(2)),
    monthlyVaRDollar: parseFloat((monthlyVaR * portfolioValue / 100).toFixed(2)),
    confidence,
    sampleSize: closedTrades.length,
    interpretation: `There is a ${confidence * 100}% chance that daily losses will not exceed ${dailyVaR.toFixed(2)}%`
  };
}

/**
 * Calculate current portfolio exposure
 */
export function calculatePortfolioExposure(openTrades, portfolioValue) {
  if (!openTrades || openTrades.length === 0) {
    return {
      totalExposure: 0,
      totalExposurePercent: 0,
      exposureBySymbol: {},
      withinLimits: true
    };
  }

  const exposureBySymbol = {};
  let totalExposure = 0;

  for (const trade of openTrades) {
    if (trade.status === 'open') {
      const exposure = trade.amount || 0;
      totalExposure += exposure;

      const symbol = trade.symbol || 'UNKNOWN';
      if (!exposureBySymbol[symbol]) {
        exposureBySymbol[symbol] = {
          exposure: 0,
          exposurePercent: 0,
          trades: 0
        };
      }

      exposureBySymbol[symbol].exposure += exposure;
      exposureBySymbol[symbol].trades++;
    }
  }

  // Calculate percentages
  const totalExposurePercent = portfolioValue > 0 ? (totalExposure / portfolioValue) : 0;

  for (const symbol in exposureBySymbol) {
    exposureBySymbol[symbol].exposurePercent =
      portfolioValue > 0 ? (exposureBySymbol[symbol].exposure / portfolioValue) : 0;
  }

  // Check limits
  const totalExceeded = totalExposurePercent > portfolioLimits.maxTotalExposure;
  const symbolExceeded = Object.values(exposureBySymbol).some(
    e => e.exposurePercent > portfolioLimits.maxExposurePerSymbol
  );

  return {
    totalExposure: parseFloat(totalExposure.toFixed(2)),
    totalExposurePercent: parseFloat((totalExposurePercent * 100).toFixed(2)),
    exposureBySymbol,
    withinLimits: !totalExceeded && !symbolExceeded,
    totalExceeded,
    symbolExceeded,
    limits: portfolioLimits
  };
}

/**
 * Check if a new trade would exceed portfolio limits
 */
export function validatePortfolioLimits(symbol, amount, openTrades, portfolioValue) {
  const currentExposure = calculatePortfolioExposure(openTrades, portfolioValue);

  // Calculate what exposure would be with new trade
  const newTotalExposure = currentExposure.totalExposure + amount;
  const newTotalPercent = (newTotalExposure / portfolioValue);

  const currentSymbolExposure = currentExposure.exposureBySymbol[symbol]?.exposure || 0;
  const newSymbolExposure = currentSymbolExposure + amount;
  const newSymbolPercent = (newSymbolExposure / portfolioValue);

  // Check limits
  if (newTotalPercent > portfolioLimits.maxTotalExposure) {
    return {
      ok: false,
      reason: `Would exceed max total exposure (${(newTotalPercent * 100).toFixed(1)}% > ${(portfolioLimits.maxTotalExposure * 100)}%)`,
      currentExposure: (currentExposure.totalExposurePercent).toFixed(1),
      limit: (portfolioLimits.maxTotalExposure * 100).toFixed(0)
    };
  }

  if (newSymbolPercent > portfolioLimits.maxExposurePerSymbol) {
    return {
      ok: false,
      reason: `Would exceed max exposure for ${symbol} (${(newSymbolPercent * 100).toFixed(1)}% > ${(portfolioLimits.maxExposurePerSymbol * 100)}%)`,
      currentExposure: ((currentSymbolExposure / portfolioValue) * 100).toFixed(1),
      limit: (portfolioLimits.maxExposurePerSymbol * 100).toFixed(0)
    };
  }

  return { ok: true };
}

/**
 * Calculate Kelly Criterion position size
 */
export function calculateKellyPositionSize(winRate, avgWin, avgLoss, portfolioValue, kellyFraction = 0.25) {
  // Kelly Formula: f = (p * b - q) / b
  // where p = win probability, q = loss probability, b = win/loss ratio

  if (winRate === 0 || avgWin === 0 || avgLoss === 0) {
    return {
      kellyPercent: 0,
      positionSize: 0,
      message: 'Insufficient data for Kelly calculation'
    };
  }

  const p = winRate / 100; // Convert to decimal
  const q = 1 - p;
  const b = avgWin / Math.abs(avgLoss);

  // Full Kelly
  let kellyPercent = (p * b - q) / b;

  // Apply Kelly fraction (usually 0.25 for safety)
  kellyPercent = kellyPercent * kellyFraction;

  // Clamp to reasonable range
  kellyPercent = Math.max(0, Math.min(kellyPercent, 0.5)); // Max 50% of portfolio

  const positionSize = portfolioValue * kellyPercent;

  return {
    kellyPercent: parseFloat((kellyPercent * 100).toFixed(2)),
    positionSize: parseFloat(positionSize.toFixed(2)),
    winRate: parseFloat(winRate.toFixed(2)),
    avgWin: parseFloat(avgWin.toFixed(2)),
    avgLoss: parseFloat(Math.abs(avgLoss).toFixed(2)),
    winLossRatio: parseFloat(b.toFixed(2)),
    kellyFraction,
    recommendation: positionSize > 0
      ? `Optimal position size: $${positionSize.toFixed(2)} (${(kellyPercent * 100).toFixed(1)}% of portfolio)`
      : 'Current strategy not profitable - avoid trading'
  };
}

/**
 * Calculate current drawdown from peak
 */
export async function calculateCurrentDrawdown(portfolioValue, initialCapital = 10000) {
  const trades = await getAllTrades();

  if (!trades || trades.length === 0) {
    return {
      currentDrawdown: 0,
      currentDrawdownPercent: 0,
      peak: initialCapital,
      currentValue: portfolioValue
    };
  }

  // Find peak portfolio value
  let peak = initialCapital;
  let currentValue = initialCapital;

  const closedTrades = trades
    .filter(t => t.status === 'closed' && t.timestamp)
    .sort((a, b) => a.timestamp - b.timestamp);

  for (const trade of closedTrades) {
    currentValue += (trade.pnl || 0);
    if (currentValue > peak) {
      peak = currentValue;
    }
  }

  const drawdown = peak - currentValue;
  const drawdownPercent = peak > 0 ? (drawdown / peak) * 100 : 0;

  return {
    currentDrawdown: parseFloat(drawdown.toFixed(2)),
    currentDrawdownPercent: parseFloat(drawdownPercent.toFixed(2)),
    peak: parseFloat(peak.toFixed(2)),
    currentValue: parseFloat(currentValue.toFixed(2)),
    isAtPeak: drawdown === 0
  };
}

/**
 * Get portfolio risk limits configuration
 */
export function getPortfolioLimits() {
  return { ...portfolioLimits };
}

/**
 * Update portfolio risk limits
 */
export function updatePortfolioLimits(newLimits) {
  if (newLimits.maxExposurePerSymbol !== undefined) {
    portfolioLimits.maxExposurePerSymbol = newLimits.maxExposurePerSymbol;
  }
  if (newLimits.maxTotalExposure !== undefined) {
    portfolioLimits.maxTotalExposure = newLimits.maxTotalExposure;
  }
  if (newLimits.maxDrawdownPercent !== undefined) {
    portfolioLimits.maxDrawdownPercent = newLimits.maxDrawdownPercent;
  }
  if (newLimits.maxDailyLossPercent !== undefined) {
    portfolioLimits.maxDailyLossPercent = newLimits.maxDailyLossPercent;
  }
  return getPortfolioLimits();
}

/**
 * Get comprehensive risk summary
 */
export async function getRiskSummary(openTrades = [], portfolioValue = 10000) {
  const trades = await getAllTrades();

  // Calculate metrics
  const circuitBreaker = checkCircuitBreaker();
  const var95 = calculateVaR(trades, 0.95, portfolioValue);
  const var99 = calculateVaR(trades, 0.99, portfolioValue);
  const exposure = calculatePortfolioExposure(openTrades, portfolioValue);
  const drawdown = await calculateCurrentDrawdown(portfolioValue);

  // Calculate win rate and avg win/loss for Kelly
  const closedTrades = trades.filter(t => t.status === 'closed' && t.pnl !== undefined);
  const winningTrades = closedTrades.filter(t => t.pnl > 0);
  const losingTrades = closedTrades.filter(t => t.pnl < 0);

  const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;
  const avgWin = winningTrades.length > 0
    ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
    : 0;
  const avgLoss = losingTrades.length > 0
    ? losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length
    : 0;

  const kelly = calculateKellyPositionSize(winRate, avgWin, avgLoss, portfolioValue);

  // Risk alerts
  const alerts = [];

  if (circuitBreaker.halted) {
    alerts.push({
      severity: 'critical',
      message: circuitBreaker.reason,
      action: 'Trading halted until cooldown expires'
    });
  }

  if (drawdown.currentDrawdownPercent > portfolioLimits.maxDrawdownPercent * 100) {
    alerts.push({
      severity: 'critical',
      message: `Drawdown ${drawdown.currentDrawdownPercent.toFixed(1)}% exceeds limit ${(portfolioLimits.maxDrawdownPercent * 100).toFixed(0)}%`,
      action: 'Consider halting trading'
    });
  }

  if (exposure.totalExceeded) {
    alerts.push({
      severity: 'warning',
      message: `Total exposure ${exposure.totalExposurePercent.toFixed(1)}% exceeds limit ${(portfolioLimits.maxTotalExposure * 100).toFixed(0)}%`,
      action: 'Reduce open positions'
    });
  }

  if (circuitBreaker.consecutiveLosses >= 2 && !circuitBreaker.halted) {
    alerts.push({
      severity: 'warning',
      message: `${circuitBreaker.consecutiveLosses} consecutive losses`,
      action: 'Review strategy before continuing'
    });
  }

  return {
    circuitBreaker,
    valueAtRisk: {
      var95,
      var99
    },
    exposure,
    drawdown,
    kellyPositionSize: kelly,
    limits: portfolioLimits,
    alerts,
    overallRiskLevel: alerts.some(a => a.severity === 'critical') ? 'HIGH'
      : alerts.some(a => a.severity === 'warning') ? 'MEDIUM'
      : 'LOW'
  };
}

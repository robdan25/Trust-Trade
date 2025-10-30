import { getTradingLimits, updateTradingLimits } from './authdb.mjs';
import { getOpenTrades } from './database.mjs';
import { createLogger } from './logger.mjs';

const logger = createLogger('RISK_MANAGER');

/**
 * Check if a trade violates user's trading limits
 */
export function validateTradeAgainstLimits(userId, tradeAmount, openTrades = []) {
  const limits = getTradingLimits(userId);

  if (!limits) {
    return { ok: false, reason: 'No trading limits configured' };
  }

  // Check 1: Trade size limit
  if (tradeAmount > limits.max_trade_size) {
    return {
      ok: false,
      reason: `Trade size ($${tradeAmount}) exceeds limit ($${limits.max_trade_size})`,
      limitExceeded: 'max_trade_size'
    };
  }

  // Check 2: Daily trade count (simplified check on open trades)
  const tradesCountToday = openTrades.filter(t => {
    const tradeDate = new Date(t.timestamp).toDateString();
    const today = new Date().toDateString();
    return tradeDate === today;
  }).length;

  if (tradesCountToday >= limits.max_daily_trades) {
    return {
      ok: false,
      reason: `Daily trade limit (${limits.max_daily_trades}) reached`,
      limitExceeded: 'max_daily_trades'
    };
  }

  // Check 3: Daily loss limit
  const dailyLoss = calculateDailyLoss(openTrades);
  if (dailyLoss < limits.max_daily_loss) {
    return {
      ok: false,
      reason: `Daily loss (${dailyLoss.toFixed(2)}) exceeds limit (${limits.max_daily_loss.toFixed(2)})`,
      limitExceeded: 'max_daily_loss',
      currentLoss: dailyLoss
    };
  }

  logger.info('Trade validated against limits', {
    userId,
    tradeAmount,
    limits: {
      max_trade_size: limits.max_trade_size,
      max_daily_trades: limits.max_daily_trades,
      max_daily_loss: limits.max_daily_loss
    }
  });

  return { ok: true };
}

/**
 * Calculate cumulative daily P&L
 */
export function calculateDailyLoss(trades = []) {
  const today = new Date().toDateString();

  return trades
    .filter(t => new Date(t.timestamp).toDateString() === today && t.status === 'closed')
    .reduce((sum, t) => sum + (t.pnl || 0), 0);
}

/**
 * Check if position size is reasonable based on account
 */
export function validatePositionSize(portfolioValue, tradeAmount, maxRiskPercent = 2) {
  const riskAmount = (maxRiskPercent / 100) * portfolioValue;

  if (tradeAmount > riskAmount) {
    return {
      ok: false,
      reason: `Trade size ($${tradeAmount}) exceeds ${maxRiskPercent}% of portfolio ($${riskAmount.toFixed(2)})`,
      maxAllowed: riskAmount
    };
  }

  return { ok: true, riskPercent: (tradeAmount / portfolioValue) * 100 };
}

/**
 * Check if circuit breaker should stop trading
 * Prevents cascade of losses
 */
export function shouldTriggerCircuitBreaker(dailyLoss, dailyMaxLoss, tradesInSession) {
  // Stop if lost more than allowed
  if (dailyLoss <= dailyMaxLoss) {
    return { triggered: false };
  }

  // Stop if made too many trades without profit
  if (tradesInSession > 10) {
    return {
      triggered: true,
      reason: 'Too many trades in session without recovery',
      tradesInSession
    };
  }

  return {
    triggered: true,
    reason: `Daily loss limit breached: ${dailyLoss.toFixed(2)} vs ${dailyMaxLoss.toFixed(2)}`,
    currentLoss: dailyLoss,
    limit: dailyMaxLoss
  };
}

/**
 * Update user's trading limits
 */
export function updateUserLimits(userId, newLimits) {
  try {
    updateTradingLimits(userId, newLimits);

    logger.info('Trading limits updated', {
      userId,
      limits: newLimits
    });

    return { ok: true };
  } catch (e) {
    logger.error('Failed to update trading limits', { userId, error: e.message });
    return { ok: false, error: e.message };
  }
}

/**
 * Get user's current risk metrics
 */
export function getUserRiskMetrics(userId) {
  const limits = getTradingLimits(userId);
  const openTrades = getOpenTrades(userId);
  const dailyLoss = calculateDailyLoss(openTrades);

  return {
    limits,
    metrics: {
      openTradesCount: openTrades.length,
      dailyLossAmount: dailyLoss,
      dailyLossPercentOfLimit: ((dailyLoss / limits.max_daily_loss) * 100).toFixed(1),
      remainingDayTrades: Math.max(0, limits.max_daily_trades - openTrades.length)
    }
  };
}

export default {
  validateTradeAgainstLimits,
  calculateDailyLoss,
  validatePositionSize,
  shouldTriggerCircuitBreaker,
  updateUserLimits,
  getUserRiskMetrics
};

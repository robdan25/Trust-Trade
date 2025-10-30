/**
 * Advanced Risk Management System
 * Handles stop-loss, take-profit, trailing stops, and dynamic position sizing
 */

/**
 * Calculate stop-loss price based on entry and risk percentage
 * @param {string} side - 'buy' or 'sell'
 * @param {number} entryPrice - Entry price
 * @param {number} stopLossPercent - Stop loss percentage (e.g., 2 for 2%)
 * @returns {number} Stop loss price
 */
export function calculateStopLoss(side, entryPrice, stopLossPercent) {
  if (side === 'buy') {
    // For long positions, stop-loss is below entry
    return entryPrice * (1 - stopLossPercent / 100);
  } else {
    // For short positions, stop-loss is above entry
    return entryPrice * (1 + stopLossPercent / 100);
  }
}

/**
 * Calculate take-profit price based on entry and target percentage
 * @param {string} side - 'buy' or 'sell'
 * @param {number} entryPrice - Entry price
 * @param {number} takeProfitPercent - Take profit percentage (e.g., 5 for 5%)
 * @returns {number} Take profit price
 */
export function calculateTakeProfit(side, entryPrice, takeProfitPercent) {
  if (side === 'buy') {
    // For long positions, take-profit is above entry
    return entryPrice * (1 + takeProfitPercent / 100);
  } else {
    // For short positions, take-profit is below entry
    return entryPrice * (1 - takeProfitPercent / 100);
  }
}

/**
 * Update trailing stop price as position moves in profit
 * @param {string} side - 'buy' or 'sell'
 * @param {number} currentPrice - Current market price
 * @param {number} entryPrice - Entry price
 * @param {number} currentStopLoss - Current stop-loss price
 * @param {number} trailingPercent - Trailing stop percentage (e.g., 1.5 for 1.5%)
 * @returns {object} { newStopLoss, trailingActivated }
 */
export function updateTrailingStop(side, currentPrice, entryPrice, currentStopLoss, trailingPercent) {
  if (side === 'buy') {
    // For long positions
    const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;

    // Only activate trailing stop if we're in profit
    if (profitPercent > 0) {
      const trailingStopPrice = currentPrice * (1 - trailingPercent / 100);

      // Only move stop-loss UP, never down
      if (trailingStopPrice > currentStopLoss) {
        return {
          newStopLoss: trailingStopPrice,
          trailingActivated: true,
          profitLocked: ((trailingStopPrice - entryPrice) / entryPrice) * 100
        };
      }
    }
  } else {
    // For short positions
    const profitPercent = ((entryPrice - currentPrice) / entryPrice) * 100;

    if (profitPercent > 0) {
      const trailingStopPrice = currentPrice * (1 + trailingPercent / 100);

      // Only move stop-loss DOWN, never up
      if (trailingStopPrice < currentStopLoss) {
        return {
          newStopLoss: trailingStopPrice,
          trailingActivated: true,
          profitLocked: ((entryPrice - trailingStopPrice) / entryPrice) * 100
        };
      }
    }
  }

  return {
    newStopLoss: currentStopLoss,
    trailingActivated: false,
    profitLocked: 0
  };
}

/**
 * Check if stop-loss has been hit
 * @param {string} side - 'buy' or 'sell'
 * @param {number} currentPrice - Current market price
 * @param {number} stopLossPrice - Stop-loss price
 * @returns {boolean} True if stop-loss hit
 */
export function isStopLossHit(side, currentPrice, stopLossPrice) {
  if (side === 'buy') {
    return currentPrice <= stopLossPrice;
  } else {
    return currentPrice >= stopLossPrice;
  }
}

/**
 * Check if take-profit has been hit
 * @param {string} side - 'buy' or 'sell'
 * @param {number} currentPrice - Current market price
 * @param {number} takeProfitPrice - Take-profit price
 * @returns {boolean} True if take-profit hit
 */
export function isTakeProfitHit(side, currentPrice, takeProfitPrice) {
  if (side === 'buy') {
    return currentPrice >= takeProfitPrice;
  } else {
    return currentPrice <= takeProfitPrice;
  }
}

/**
 * Calculate optimal position size based on risk percentage of portfolio
 * Kelly Criterion inspired - risk only X% of portfolio per trade
 * @param {number} portfolioValue - Total portfolio value in USD
 * @param {number} entryPrice - Entry price
 * @param {number} stopLossPrice - Stop-loss price
 * @param {number} riskPercentOfPortfolio - Max % of portfolio to risk (e.g., 2 for 2%)
 * @returns {object} { positionSize, notional, sharesQuantity }
 */
export function calculateRiskBasedPositionSize(portfolioValue, entryPrice, stopLossPrice, riskPercentOfPortfolio = 2) {
  // Maximum dollar amount we're willing to lose on this trade
  const maxRiskDollar = portfolioValue * (riskPercentOfPortfolio / 100);

  // Price difference between entry and stop-loss
  const riskPerShare = Math.abs(entryPrice - stopLossPrice);

  // How many shares can we buy given our risk tolerance?
  const sharesQuantity = maxRiskDollar / riskPerShare;

  // Total position size in dollars
  const notional = sharesQuantity * entryPrice;

  // Don't let position exceed 25% of portfolio (diversification limit)
  const maxPositionSize = portfolioValue * 0.25;

  if (notional > maxPositionSize) {
    const adjustedShares = maxPositionSize / entryPrice;
    return {
      positionSize: maxPositionSize,
      notional: maxPositionSize,
      sharesQuantity: adjustedShares,
      riskDollar: adjustedShares * riskPerShare,
      riskPercent: (adjustedShares * riskPerShare / portfolioValue) * 100,
      capped: true,
      reason: 'Position capped at 25% of portfolio for diversification'
    };
  }

  return {
    positionSize: notional,
    notional,
    sharesQuantity,
    riskDollar: maxRiskDollar,
    riskPercent: riskPercentOfPortfolio,
    capped: false
  };
}

/**
 * Calculate multiple take-profit levels for scaling out of position
 * @param {string} side - 'buy' or 'sell'
 * @param {number} entryPrice - Entry price
 * @param {number} targetPercent - Overall profit target (e.g., 10 for 10%)
 * @returns {Array} Array of take-profit levels with percentages
 */
export function calculateMultipleTakeProfits(side, entryPrice, targetPercent) {
  const levels = [
    { percent: 25, target: targetPercent * 0.5 },  // First TP: 25% of position at 50% of target
    { percent: 25, target: targetPercent * 0.75 }, // Second TP: 25% of position at 75% of target
    { percent: 25, target: targetPercent },        // Third TP: 25% of position at 100% of target
    { percent: 25, target: targetPercent * 1.5 }   // Final TP: 25% of position at 150% of target
  ];

  return levels.map(level => ({
    positionPercent: level.percent,
    profitTarget: level.target,
    price: calculateTakeProfit(side, entryPrice, level.target)
  }));
}

/**
 * Validate risk parameters before placing trade
 * @param {object} params - Risk parameters
 * @returns {object} { valid, errors }
 */
export function validateRiskParameters(params) {
  const errors = [];

  if (!params.stopLossPercent || params.stopLossPercent <= 0 || params.stopLossPercent > 50) {
    errors.push('Stop-loss percent must be between 0 and 50');
  }

  if (!params.takeProfitPercent || params.takeProfitPercent <= 0) {
    errors.push('Take-profit percent must be positive');
  }

  if (params.stopLossPercent && params.takeProfitPercent) {
    const riskRewardRatio = params.takeProfitPercent / params.stopLossPercent;
    if (riskRewardRatio < 1.5) {
      errors.push(`Risk/reward ratio ${riskRewardRatio.toFixed(2)} is too low (minimum 1.5:1)`);
    }
  }

  if (params.trailingStopPercent && (params.trailingStopPercent <= 0 || params.trailingStopPercent > params.stopLossPercent)) {
    errors.push('Trailing stop percent must be positive and less than stop-loss percent');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Default risk configuration - conservative settings
 */
export const DEFAULT_RISK_CONFIG = {
  stopLossPercent: 2.0,        // Stop out at 2% loss
  takeProfitPercent: 5.0,      // Take profit at 5% gain (2.5:1 risk/reward)
  trailingStopPercent: 1.5,    // Trail by 1.5% once in profit
  riskPercentOfPortfolio: 2.0, // Risk max 2% of portfolio per trade
  useTrailingStop: true,       // Enable trailing stops
  useMultipleTakeProfits: true // Use scaled exit strategy
};

export default {
  calculateStopLoss,
  calculateTakeProfit,
  updateTrailingStop,
  isStopLossHit,
  isTakeProfitHit,
  calculateRiskBasedPositionSize,
  calculateMultipleTakeProfits,
  validateRiskParameters,
  DEFAULT_RISK_CONFIG
};

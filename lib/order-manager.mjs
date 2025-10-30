/**
 * Order Manager
 * Tracks active positions with stop-loss, take-profit, and trailing stops
 * Monitors prices and executes exit orders when triggered
 */

import {
  isStopLossHit,
  isTakeProfitHit,
  updateTrailingStop,
  calculateStopLoss,
  calculateTakeProfit,
  calculateMultipleTakeProfits
} from './risk-advanced.mjs';

// In-memory storage for active positions
// In production, this would be in the database
const activePositions = new Map();

/**
 * Create a new position with risk management
 * @param {object} trade - Trade details
 * @param {object} riskConfig - Risk configuration
 * @returns {object} Position object
 */
export function createPosition(trade, riskConfig) {
  const position = {
    id: trade.id,
    symbol: trade.symbol,
    side: trade.side,
    entryPrice: trade.price,
    quantity: trade.quantity,
    notional: trade.notional,
    entryTime: Date.now(),

    // Risk management
    stopLossPrice: calculateStopLoss(trade.side, trade.price, riskConfig.stopLossPercent),
    stopLossPercent: riskConfig.stopLossPercent,

    takeProfitPrice: calculateTakeProfit(trade.side, trade.price, riskConfig.takeProfitPercent),
    takeProfitPercent: riskConfig.takeProfitPercent,

    trailingStopEnabled: riskConfig.useTrailingStop,
    trailingStopPercent: riskConfig.trailingStopPercent,
    trailingActivated: false,

    // Multiple take-profit levels
    multipleTakeProfits: riskConfig.useMultipleTakeProfits
      ? calculateMultipleTakeProfits(trade.side, trade.price, riskConfig.takeProfitPercent)
      : [],
    takeProfitsHit: [],

    // Tracking
    highestPrice: trade.price,
    lowestPrice: trade.price,
    currentPrice: trade.price,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,

    status: 'open',
    exitReason: null,
    exitPrice: null,
    exitTime: null
  };

  activePositions.set(trade.id, position);
  console.log(`✅ Position opened: ${trade.side.toUpperCase()} ${trade.quantity} ${trade.symbol} @ $${trade.price}`);
  console.log(`   Stop-Loss: $${position.stopLossPrice.toFixed(2)} (-${riskConfig.stopLossPercent}%)`);
  console.log(`   Take-Profit: $${position.takeProfitPrice.toFixed(2)} (+${riskConfig.takeProfitPercent}%)`);

  return position;
}

/**
 * Update position with current market price
 * Checks for stop-loss and take-profit triggers
 * @param {string} positionId - Position ID
 * @param {number} currentPrice - Current market price
 * @returns {object} { position, triggered, action }
 */
export function updatePosition(positionId, currentPrice) {
  const position = activePositions.get(positionId);
  if (!position) {
    return { position: null, triggered: false };
  }

  // Update current price
  position.currentPrice = currentPrice;

  // Update high/low watermarks
  position.highestPrice = Math.max(position.highestPrice, currentPrice);
  position.lowestPrice = Math.min(position.lowestPrice, currentPrice);

  // Calculate unrealized P&L
  if (position.side === 'buy') {
    position.unrealizedPnl = (currentPrice - position.entryPrice) * position.quantity;
    position.unrealizedPnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
  } else {
    position.unrealizedPnl = (position.entryPrice - currentPrice) * position.quantity;
    position.unrealizedPnlPercent = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
  }

  // Check for trailing stop update
  if (position.trailingStopEnabled && position.unrealizedPnlPercent > 0) {
    const trailingUpdate = updateTrailingStop(
      position.side,
      currentPrice,
      position.entryPrice,
      position.stopLossPrice,
      position.trailingStopPercent
    );

    if (trailingUpdate.trailingActivated) {
      console.log(`📈 Trailing stop activated for ${position.symbol}:`);
      console.log(`   New stop-loss: $${trailingUpdate.newStopLoss.toFixed(2)}`);
      console.log(`   Profit locked: +${trailingUpdate.profitLocked.toFixed(2)}%`);

      position.stopLossPrice = trailingUpdate.newStopLoss;
      position.trailingActivated = true;
    }
  }

  // Check for stop-loss hit
  if (isStopLossHit(position.side, currentPrice, position.stopLossPrice)) {
    console.log(`🛑 STOP-LOSS HIT for ${position.symbol}!`);
    console.log(`   Entry: $${position.entryPrice.toFixed(2)}`);
    console.log(`   Exit: $${currentPrice.toFixed(2)}`);
    console.log(`   Loss: ${position.unrealizedPnlPercent.toFixed(2)}%`);

    return {
      position,
      triggered: true,
      action: 'stop-loss',
      exitPrice: currentPrice,
      pnl: position.unrealizedPnl,
      pnlPercent: position.unrealizedPnlPercent
    };
  }

  // Check for take-profit hit
  if (isTakeProfitHit(position.side, currentPrice, position.takeProfitPrice)) {
    console.log(`🎯 TAKE-PROFIT HIT for ${position.symbol}!`);
    console.log(`   Entry: $${position.entryPrice.toFixed(2)}`);
    console.log(`   Exit: $${currentPrice.toFixed(2)}`);
    console.log(`   Profit: +${position.unrealizedPnlPercent.toFixed(2)}%`);

    return {
      position,
      triggered: true,
      action: 'take-profit',
      exitPrice: currentPrice,
      pnl: position.unrealizedPnl,
      pnlPercent: position.unrealizedPnlPercent
    };
  }

  // Check multiple take-profit levels
  if (position.multipleTakeProfits.length > 0) {
    for (const [index, tp] of position.multipleTakeProfits.entries()) {
      // Skip if already hit
      if (position.takeProfitsHit.includes(index)) continue;

      if (isTakeProfitHit(position.side, currentPrice, tp.price)) {
        console.log(`🎯 Take-Profit Level ${index + 1} HIT for ${position.symbol}!`);
        console.log(`   Closing ${tp.positionPercent}% of position at +${tp.profitTarget.toFixed(2)}%`);

        position.takeProfitsHit.push(index);

        return {
          position,
          triggered: true,
          action: 'partial-take-profit',
          level: index + 1,
          percentToClose: tp.positionPercent,
          exitPrice: currentPrice,
          pnl: position.unrealizedPnl * (tp.positionPercent / 100),
          pnlPercent: position.unrealizedPnlPercent
        };
      }
    }
  }

  return {
    position,
    triggered: false
  };
}

/**
 * Close a position
 * @param {string} positionId - Position ID
 * @param {number} exitPrice - Exit price
 * @param {string} reason - Exit reason
 * @returns {object} Closed position
 */
export function closePosition(positionId, exitPrice, reason) {
  const position = activePositions.get(positionId);
  if (!position) {
    return null;
  }

  position.status = 'closed';
  position.exitPrice = exitPrice;
  position.exitTime = Date.now();
  position.exitReason = reason;

  // Calculate final P&L
  if (position.side === 'buy') {
    position.realizedPnl = (exitPrice - position.entryPrice) * position.quantity;
    position.realizedPnlPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
  } else {
    position.realizedPnl = (position.entryPrice - exitPrice) * position.quantity;
    position.realizedPnlPercent = ((position.entryPrice - exitPrice) / position.entryPrice) * 100;
  }

  activePositions.delete(positionId);

  console.log(`❌ Position closed: ${position.symbol}`);
  console.log(`   Reason: ${reason}`);
  console.log(`   P&L: $${position.realizedPnl.toFixed(2)} (${position.realizedPnlPercent.toFixed(2)}%)`);
  console.log(`   Duration: ${((position.exitTime - position.entryTime) / 1000 / 60).toFixed(1)} minutes`);

  return position;
}

/**
 * Get all active positions
 * @returns {Array} Array of active positions
 */
export function getActivePositions() {
  return Array.from(activePositions.values());
}

/**
 * Get specific position
 * @param {string} positionId - Position ID
 * @returns {object} Position or null
 */
export function getPosition(positionId) {
  return activePositions.get(positionId) || null;
}

/**
 * Check all positions for exits
 * @param {number} currentPrice - Current market price for symbol
 * @param {string} symbol - Symbol to check
 * @returns {Array} Array of triggered exits
 */
export function checkAllPositions(symbol, currentPrice) {
  const triggers = [];

  for (const position of activePositions.values()) {
    if (position.symbol === symbol && position.status === 'open') {
      const result = updatePosition(position.id, currentPrice);
      if (result.triggered) {
        triggers.push(result);
      }
    }
  }

  return triggers;
}

/**
 * Get position summary for symbol
 * @param {string} symbol - Symbol
 * @returns {object} Summary statistics
 */
export function getPositionSummary(symbol) {
  const positions = Array.from(activePositions.values()).filter(p => p.symbol === symbol);

  if (positions.length === 0) {
    return {
      hasPosition: false,
      totalQuantity: 0,
      totalNotional: 0,
      avgEntryPrice: 0,
      unrealizedPnl: 0,
      unrealizedPnlPercent: 0
    };
  }

  const totalQuantity = positions.reduce((sum, p) => sum + p.quantity, 0);
  const totalNotional = positions.reduce((sum, p) => sum + p.notional, 0);
  const unrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);

  return {
    hasPosition: true,
    positionCount: positions.length,
    totalQuantity,
    totalNotional,
    avgEntryPrice: totalNotional / totalQuantity,
    unrealizedPnl,
    unrealizedPnlPercent: (unrealizedPnl / totalNotional) * 100,
    positions
  };
}

export default {
  createPosition,
  updatePosition,
  closePosition,
  getActivePositions,
  getPosition,
  checkAllPositions,
  getPositionSummary
};

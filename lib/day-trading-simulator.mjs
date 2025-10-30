/**
 * Day Trading Simulator
 *
 * Simulates day trading strategy on recent candle data
 * Shows exactly what $100 would become in a day
 */

import { analyzeDayTrading, checkDayTradeExit, checkDayTradingLimits, DAY_TRADING_CONFIG } from './strategies/day-trading.mjs';

/**
 * Simulate day trading on candle data
 * @param {Array} candles - Historical candles (ideally full day of 1-min candles)
 * @param {number} startingCapital - Starting capital (e.g., 100 CAD)
 * @param {Object} config - Simulation config
 * @returns {Object} Simulation results
 */
export function simulateDayTrading(candles, startingCapital = 100, config = {}) {
  const {
    sizePct = 0.95, // Use 95% of capital per trade
    feePercent = 0.1, // 0.1% trading fees (Kraken taker)
    slippagePercent = 0.05 // 0.05% slippage
  } = config;

  if (candles.length < 100) {
    return {
      ok: false,
      error: 'Need at least 100 candles for simulation'
    };
  }

  let capital = startingCapital;
  let currentPosition = null;
  const trades = [];
  const equity = [capital]; // Track equity over time

  // Simulate through candles
  for (let i = 100; i < candles.length; i++) {
    const window = candles.slice(i - 100, i);
    const currentCandle = candles[i];
    const currentPrice = currentCandle.c;

    // Check if we have an open position
    if (currentPosition) {
      // Check for exit conditions
      const exitCheck = checkDayTradeExit(
        currentPosition,
        currentPrice,
        currentPosition.entryTime
      );

      if (exitCheck.shouldExit) {
        // Close position
        const positionSize = currentPosition.quantity;
        const entryPrice = currentPosition.entryPrice;
        const exitPrice = currentPrice;

        // Calculate P&L with fees and slippage
        const exitValue = positionSize * exitPrice;
        const exitFees = exitValue * (feePercent / 100);
        const exitSlippage = exitValue * (slippagePercent / 100);
        const netExitValue = exitValue - exitFees - exitSlippage;

        const pnl = netExitValue - currentPosition.investedCapital;
        const pnlPercent = (pnl / currentPosition.investedCapital) * 100;

        // Update capital
        capital += pnl;

        // Record trade
        trades.push({
          entryTime: currentPosition.entryTime,
          exitTime: currentCandle.t,
          side: currentPosition.side,
          entryPrice,
          exitPrice,
          quantity: positionSize,
          investedCapital: currentPosition.investedCapital,
          pnl,
          pnlPercent,
          exitReason: exitCheck.exitReason,
          holdTime: exitCheck.holdTime,
          fees: currentPosition.entryFees + exitFees,
          slippage: currentPosition.entrySlippage + exitSlippage
        });

        currentPosition = null;
        equity.push(capital);

        // Check daily limits
        const todaysTrades = trades;
        const limits = checkDayTradingLimits(todaysTrades);
        if (!limits.canTrade) {
          console.log(`\n⚠️  Daily limit reached: ${limits.reason}`);
          break;
        }
      }
    }

    // Look for entry if no position
    if (!currentPosition) {
      const signal = analyzeDayTrading(window);

      // Enter if strong signal
      if (signal.signal !== 'hold' && signal.confidence >= DAY_TRADING_CONFIG.minConfidence) {
        const positionSizeUSD = capital * (sizePct / 100);

        // Calculate entry with fees and slippage
        const entryFees = positionSizeUSD * (feePercent / 100);
        const entrySlippage = positionSizeUSD * (slippagePercent / 100);
        const investedCapital = positionSizeUSD + entryFees + entrySlippage;

        // Check if we have enough capital
        if (investedCapital <= capital) {
          const quantity = positionSizeUSD / currentPrice;

          // Calculate stop loss and take profit
          const stopLossPrice = signal.signal === 'buy'
            ? currentPrice * (1 - DAY_TRADING_CONFIG.stopLossPercent / 100)
            : currentPrice * (1 + DAY_TRADING_CONFIG.stopLossPercent / 100);

          const takeProfitPrice = signal.signal === 'buy'
            ? currentPrice * (1 + DAY_TRADING_CONFIG.takeProfitPercent / 100)
            : currentPrice * (1 - DAY_TRADING_CONFIG.takeProfitPercent / 100);

          currentPosition = {
            side: signal.signal,
            entryPrice: currentPrice,
            entryTime: currentCandle.t,
            quantity,
            investedCapital,
            stopLossPrice,
            takeProfitPrice,
            entryFees,
            entrySlippage,
            entryType: signal.entryType,
            confidence: signal.confidence
          };

          // Deduct capital
          capital -= investedCapital;
        }
      }
    }
  }

  // Close any open position at end of simulation
  if (currentPosition) {
    const lastCandle = candles[candles.length - 1];
    const exitPrice = lastCandle.c;
    const positionSize = currentPosition.quantity;

    const exitValue = positionSize * exitPrice;
    const exitFees = exitValue * (feePercent / 100);
    const exitSlippage = exitValue * (slippagePercent / 100);
    const netExitValue = exitValue - exitFees - exitSlippage;

    const pnl = netExitValue - currentPosition.investedCapital;
    const pnlPercent = (pnl / currentPosition.investedCapital) * 100;

    capital += pnl;

    trades.push({
      entryTime: currentPosition.entryTime,
      exitTime: lastCandle.t,
      side: currentPosition.side,
      entryPrice: currentPosition.entryPrice,
      exitPrice,
      quantity: positionSize,
      investedCapital: currentPosition.investedCapital,
      pnl,
      pnlPercent,
      exitReason: 'end-of-simulation',
      holdTime: (lastCandle.t - currentPosition.entryTime) / 1000,
      fees: currentPosition.entryFees + exitFees,
      slippage: currentPosition.entrySlippage + exitSlippage
    });

    equity.push(capital);
  }

  // Calculate statistics
  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl <= 0);

  const totalPnl = capital - startingCapital;
  const totalPnlPercent = (totalPnl / startingCapital) * 100;

  const avgWin = winningTrades.length > 0
    ? winningTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / winningTrades.length
    : 0;

  const avgLoss = losingTrades.length > 0
    ? losingTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / losingTrades.length
    : 0;

  const winRate = trades.length > 0
    ? (winningTrades.length / trades.length) * 100
    : 0;

  const totalFees = trades.reduce((sum, t) => sum + t.fees, 0);
  const totalSlippage = trades.reduce((sum, t) => sum + t.slippage, 0);

  const avgHoldTime = trades.length > 0
    ? trades.reduce((sum, t) => sum + t.holdTime, 0) / trades.length
    : 0;

  // Find max drawdown
  let maxDrawdown = 0;
  let peak = equity[0];
  for (const value of equity) {
    if (value > peak) peak = value;
    const drawdown = ((peak - value) / peak) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return {
    ok: true,

    // Capital
    startingCapital,
    endingCapital: capital,
    totalPnl,
    totalPnlPercent,

    // Trades
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate,

    // Performance
    avgWin,
    avgLoss,
    avgHoldTime: Math.round(avgHoldTime),
    avgHoldTimeMinutes: (avgHoldTime / 60).toFixed(1),

    // Costs
    totalFees,
    totalSlippage,
    totalCosts: totalFees + totalSlippage,

    // Risk
    maxDrawdown,

    // Details
    trades,
    equity,

    // Per Trade Breakdown
    bestTrade: trades.reduce((best, t) => t.pnl > best.pnl ? t : best, trades[0] || { pnl: 0 }),
    worstTrade: trades.reduce((worst, t) => t.pnl < worst.pnl ? t : worst, trades[0] || { pnl: 0 }),

    // Entry Types
    entryTypes: {
      momentumBreakout: trades.filter(t => t.entryType === 'momentum-breakout').length,
      rsiBounce: trades.filter(t => t.entryType === 'rsi-bounce').length,
      emaCross: trades.filter(t => t.entryType === 'ema-cross').length
    }
  };
}

/**
 * Generate readable simulation report
 * @param {Object} results - Simulation results
 * @returns {string} Formatted report
 */
export function generateSimulationReport(results) {
  if (!results.ok) {
    return `❌ Simulation failed: ${results.error}`;
  }

  const profit = results.totalPnl >= 0;

  return `
╔═══════════════════════════════════════════════════════════╗
║           DAY TRADING SIMULATION REPORT                   ║
╚═══════════════════════════════════════════════════════════╝

💰 CAPITAL
   Starting: $${results.startingCapital.toFixed(2)} CAD
   Ending:   $${results.endingCapital.toFixed(2)} CAD
   ${profit ? '📈' : '📉'} P&L:      ${profit ? '+' : ''}$${results.totalPnl.toFixed(2)} (${profit ? '+' : ''}${results.totalPnlPercent.toFixed(2)}%)

📊 TRADE STATISTICS
   Total Trades:    ${results.totalTrades}
   Winning Trades:  ${results.winningTrades} ✅
   Losing Trades:   ${results.losingTrades} ❌
   Win Rate:        ${results.winRate.toFixed(1)}%

📈 PERFORMANCE
   Average Win:     +${results.avgWin.toFixed(2)}%
   Average Loss:    ${results.avgLoss.toFixed(2)}%
   Avg Hold Time:   ${results.avgHoldTimeMinutes} minutes
   Max Drawdown:    -${results.maxDrawdown.toFixed(2)}%

💸 COSTS
   Trading Fees:    $${results.totalFees.toFixed(2)}
   Slippage:        $${results.totalSlippage.toFixed(2)}
   Total Costs:     $${results.totalCosts.toFixed(2)}

🎯 BEST/WORST TRADES
   Best:  ${results.bestTrade.pnl >= 0 ? '+' : ''}$${results.bestTrade.pnl.toFixed(2)} (${results.bestTrade.pnlPercent >= 0 ? '+' : ''}${results.bestTrade.pnlPercent.toFixed(2)}%)
   Worst: ${results.worstTrade.pnl >= 0 ? '+' : ''}$${results.worstTrade.pnl.toFixed(2)} (${results.worstTrade.pnlPercent >= 0 ? '+' : ''}${results.worstTrade.pnlPercent.toFixed(2)}%)

📝 ENTRY BREAKDOWN
   Momentum Breakouts: ${results.entryTypes.momentumBreakout}
   RSI Bounces:        ${results.entryTypes.rsiBounce}
   EMA Crosses:        ${results.entryTypes.emaCross}

═══════════════════════════════════════════════════════════
${profit ? '✅ PROFITABLE SIMULATION!' : '❌ LOSING SIMULATION'}
${profit ? `Your $100 would become $${results.endingCapital.toFixed(2)}!` : `You would lose $${Math.abs(results.totalPnl).toFixed(2)}`}
═══════════════════════════════════════════════════════════
  `;
}

export default {
  simulateDayTrading,
  generateSimulationReport
};

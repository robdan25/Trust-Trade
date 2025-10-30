/**
 * Performance Analytics Module
 *
 * Calculates trading performance metrics:
 * - Total P&L, Win Rate, Sharpe Ratio
 * - Drawdown analysis
 * - Strategy performance comparison
 * - Risk-adjusted returns
 */

import { getAllTrades } from './database.mjs';

/**
 * Calculate comprehensive performance metrics
 */
export function calculatePerformanceMetrics(trades, initialCapital = 10000) {
  if (!trades || trades.length === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalPnL: 0,
      totalPnLPercent: 0,
      avgWin: 0,
      avgLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      avgHoldTime: 0,
      totalFees: 0,
      netProfit: 0,
      roi: 0
    };
  }

  // Separate winning and losing trades
  const closedTrades = trades.filter(t => t.status === 'closed' && t.pnl !== undefined);
  const winningTrades = closedTrades.filter(t => t.pnl > 0);
  const losingTrades = closedTrades.filter(t => t.pnl < 0);

  // Basic metrics
  const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const totalFees = closedTrades.reduce((sum, t) => sum + (t.fee || 0), 0);
  const netProfit = totalPnL - totalFees;

  const avgWin = winningTrades.length > 0
    ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
    : 0;

  const avgLoss = losingTrades.length > 0
    ? losingTrades.reduce((sum, t) => sum + Math.abs(t.pnl), 0) / losingTrades.length
    : 0;

  const largestWin = winningTrades.length > 0
    ? Math.max(...winningTrades.map(t => t.pnl))
    : 0;

  const largestLoss = losingTrades.length > 0
    ? Math.min(...losingTrades.map(t => t.pnl))
    : 0;

  // Win rate
  const winRate = closedTrades.length > 0
    ? (winningTrades.length / closedTrades.length) * 100
    : 0;

  // Profit factor (total wins / total losses)
  const totalWins = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

  // Average hold time (in seconds)
  const tradesWithTime = closedTrades.filter(t => t.entry_time && t.exit_time);
  const avgHoldTime = tradesWithTime.length > 0
    ? tradesWithTime.reduce((sum, t) => sum + (t.exit_time - t.entry_time), 0) / tradesWithTime.length
    : 0;

  // Drawdown calculation
  const { maxDrawdown, maxDrawdownPercent } = calculateDrawdown(closedTrades, initialCapital);

  // Sharpe Ratio (simplified - assumes daily returns)
  const sharpeRatio = calculateSharpeRatio(closedTrades);

  // ROI
  const roi = initialCapital > 0 ? (netProfit / initialCapital) * 100 : 0;

  return {
    totalTrades: closedTrades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: parseFloat(winRate.toFixed(2)),
    totalPnL: parseFloat(totalPnL.toFixed(2)),
    totalPnLPercent: parseFloat(((totalPnL / initialCapital) * 100).toFixed(2)),
    avgWin: parseFloat(avgWin.toFixed(2)),
    avgLoss: parseFloat(avgLoss.toFixed(2)),
    largestWin: parseFloat(largestWin.toFixed(2)),
    largestLoss: parseFloat(largestLoss.toFixed(2)),
    profitFactor: parseFloat(profitFactor.toFixed(2)),
    sharpeRatio: parseFloat(sharpeRatio.toFixed(2)),
    maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
    maxDrawdownPercent: parseFloat(maxDrawdownPercent.toFixed(2)),
    avgHoldTime: Math.round(avgHoldTime),
    avgHoldTimeFormatted: formatDuration(avgHoldTime),
    totalFees: parseFloat(totalFees.toFixed(2)),
    netProfit: parseFloat(netProfit.toFixed(2)),
    roi: parseFloat(roi.toFixed(2))
  };
}

/**
 * Calculate maximum drawdown
 */
function calculateDrawdown(trades, initialCapital) {
  if (trades.length === 0) {
    return { maxDrawdown: 0, maxDrawdownPercent: 0 };
  }

  let peak = initialCapital;
  let maxDrawdown = 0;
  let currentCapital = initialCapital;

  // Sort trades by timestamp
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  for (const trade of sortedTrades) {
    currentCapital += (trade.pnl || 0);

    if (currentCapital > peak) {
      peak = currentCapital;
    }

    const drawdown = peak - currentCapital;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  const maxDrawdownPercent = peak > 0 ? (maxDrawdown / peak) * 100 : 0;

  return {
    maxDrawdown,
    maxDrawdownPercent
  };
}

/**
 * Calculate Sharpe Ratio
 * Simplified calculation: (average return - risk-free rate) / std deviation of returns
 */
function calculateSharpeRatio(trades) {
  if (trades.length < 2) return 0;

  const returns = trades.map(t => t.pnl || 0);
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

  // Calculate standard deviation
  const squaredDiffs = returns.map(r => Math.pow(r - avgReturn, 2));
  const variance = squaredDiffs.reduce((sum, sd) => sum + sd, 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  // Assume risk-free rate of 0 for simplicity
  const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

  return sharpeRatio;
}

/**
 * Calculate performance by strategy
 */
export function calculatePerformanceByStrategy(trades, initialCapital = 10000) {
  const tradesByStrategy = {};

  // Group trades by strategy
  for (const trade of trades) {
    const strategy = trade.strategy || 'unknown';
    if (!tradesByStrategy[strategy]) {
      tradesByStrategy[strategy] = [];
    }
    tradesByStrategy[strategy].push(trade);
  }

  // Calculate metrics for each strategy
  const strategyPerformance = {};
  for (const [strategy, strategyTrades] of Object.entries(tradesByStrategy)) {
    strategyPerformance[strategy] = calculatePerformanceMetrics(strategyTrades, initialCapital);
  }

  return strategyPerformance;
}

/**
 * Calculate performance by symbol
 */
export function calculatePerformanceBySymbol(trades, initialCapital = 10000) {
  const tradesBySymbol = {};

  // Group trades by symbol
  for (const trade of trades) {
    const symbol = trade.symbol || 'UNKNOWN';
    if (!tradesBySymbol[symbol]) {
      tradesBySymbol[symbol] = [];
    }
    tradesBySymbol[symbol].push(trade);
  }

  // Calculate metrics for each symbol
  const symbolPerformance = {};
  for (const [symbol, symbolTrades] of Object.entries(tradesBySymbol)) {
    symbolPerformance[symbol] = calculatePerformanceMetrics(symbolTrades, initialCapital);
  }

  return symbolPerformance;
}

/**
 * Calculate equity curve (cumulative P&L over time)
 */
export function calculateEquityCurve(trades, initialCapital = 10000) {
  if (trades.length === 0) {
    return [{ timestamp: Date.now(), capital: initialCapital, pnl: 0 }];
  }

  const sortedTrades = [...trades]
    .filter(t => t.status === 'closed' && t.timestamp)
    .sort((a, b) => a.timestamp - b.timestamp);

  const equityCurve = [{
    timestamp: sortedTrades[0]?.timestamp || Date.now(),
    capital: initialCapital,
    pnl: 0
  }];

  let currentCapital = initialCapital;

  for (const trade of sortedTrades) {
    currentCapital += (trade.pnl || 0);
    equityCurve.push({
      timestamp: trade.timestamp,
      capital: currentCapital,
      pnl: currentCapital - initialCapital,
      trade: {
        id: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        pnl: trade.pnl
      }
    });
  }

  return equityCurve;
}

/**
 * Calculate daily performance
 */
export function calculateDailyPerformance(trades, initialCapital = 10000) {
  if (trades.length === 0) return [];

  const dailyStats = {};

  for (const trade of trades) {
    if (trade.status !== 'closed' || !trade.timestamp) continue;

    const date = new Date(trade.timestamp).toISOString().split('T')[0];

    if (!dailyStats[date]) {
      dailyStats[date] = {
        date,
        trades: [],
        pnl: 0,
        fees: 0,
        wins: 0,
        losses: 0
      };
    }

    dailyStats[date].trades.push(trade);
    dailyStats[date].pnl += (trade.pnl || 0);
    dailyStats[date].fees += (trade.fee || 0);

    if (trade.pnl > 0) {
      dailyStats[date].wins++;
    } else if (trade.pnl < 0) {
      dailyStats[date].losses++;
    }
  }

  // Convert to array and calculate cumulative
  let cumulative = initialCapital;
  const dailyPerformance = Object.values(dailyStats)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(day => {
      cumulative += day.pnl;
      return {
        ...day,
        totalTrades: day.wins + day.losses,
        winRate: day.trades.length > 0 ? (day.wins / day.trades.length) * 100 : 0,
        netPnl: day.pnl - day.fees,
        cumulativeCapital: cumulative
      };
    });

  return dailyPerformance;
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Get complete analytics summary
 */
export async function getAnalyticsSummary(options = {}) {
  const {
    startDate = null,
    endDate = null,
    symbol = null,
    strategy = null,
    initialCapital = 10000
  } = options;

  // Get trades from database
  let trades = await getAllTrades();

  // Filter by date range
  if (startDate) {
    trades = trades.filter(t => t.timestamp >= startDate);
  }
  if (endDate) {
    trades = trades.filter(t => t.timestamp <= endDate);
  }

  // Filter by symbol
  if (symbol) {
    trades = trades.filter(t => t.symbol === symbol);
  }

  // Filter by strategy
  if (strategy) {
    trades = trades.filter(t => t.strategy === strategy);
  }

  // Calculate all metrics
  const overallMetrics = calculatePerformanceMetrics(trades, initialCapital);
  const strategyMetrics = calculatePerformanceByStrategy(trades, initialCapital);
  const symbolMetrics = calculatePerformanceBySymbol(trades, initialCapital);
  const equityCurve = calculateEquityCurve(trades, initialCapital);
  const dailyPerformance = calculateDailyPerformance(trades, initialCapital);

  return {
    overall: overallMetrics,
    byStrategy: strategyMetrics,
    bySymbol: symbolMetrics,
    equityCurve,
    dailyPerformance,
    filters: { startDate, endDate, symbol, strategy },
    generatedAt: Date.now()
  };
}

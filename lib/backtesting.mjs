/**
 * Backtesting Engine
 *
 * Features:
 * - Historical data backtesting
 * - Multiple strategy support
 * - Realistic trade simulation with slippage and fees
 * - Detailed performance metrics
 * - Trade-by-trade analysis
 * - Equity curve generation
 */

import { getCandles } from '../adapters/kraken.mjs';
import { lastSmaSignal, momentum, assessProfitOpportunity } from './indicators.mjs';
import { calculatePerformanceMetrics, calculateEquityCurve } from './analytics.mjs';

/**
 * Backtest a strategy against historical data
 */
export async function runBacktest(config) {
  const {
    symbol = 'BTCUSD',
    strategy = 'momentum',
    startDate = Date.now() - (90 * 24 * 60 * 60 * 1000), // 90 days ago
    endDate = Date.now(),
    initialCapital = 10000,
    positionSize = 1000, // $ per trade
    feeRate = 0.0026, // 0.26% Kraken taker fee
    slippage = 0.001, // 0.1% slippage
    interval = '1h'
  } = config;

  // Validate inputs
  if (positionSize > initialCapital) {
    throw new Error('Position size cannot exceed initial capital');
  }

  // Fetch historical data
  console.log(`Fetching historical data for ${symbol} (${interval})...`);
  const candles = await getCandles(symbol, interval, Math.floor((endDate - startDate) / (60 * 60 * 1000)));

  if (!candles || candles.length < 50) {
    throw new Error('Insufficient historical data for backtesting (need at least 50 candles)');
  }

  console.log(`Loaded ${candles.length} candles for backtesting`);

  // Initialize backtest state
  const trades = [];
  let capital = initialCapital;
  let position = null; // { side, entry_price, amount, quantity, entry_time, entry_index }
  const equityCurve = [{ time: candles[0].time, capital, trades: 0 }];

  // Extract close prices for indicator calculations
  const closes = candles.map(c => c.close);

  // Run strategy on each candle
  for (let i = 50; i < candles.length; i++) {
    const candle = candles[i];
    const closesUpToNow = closes.slice(0, i + 1);

    // Get strategy signal
    const signal = getStrategySignal(strategy, closesUpToNow, candles.slice(0, i + 1));

    // Execute trades based on signal
    if (signal === 'buy' && !position && capital >= positionSize) {
      // Open long position
      const entryPrice = candle.close * (1 + slippage); // Slippage on entry
      const quantity = positionSize / entryPrice;
      const fee = positionSize * feeRate;

      position = {
        side: 'buy',
        entry_price: entryPrice,
        amount: positionSize,
        quantity,
        entry_time: candle.time,
        entry_index: i,
        fee
      };

      capital -= (positionSize + fee);

      console.log(`[${new Date(candle.time).toISOString()}] BUY ${quantity.toFixed(6)} @ $${entryPrice.toFixed(2)} | Capital: $${capital.toFixed(2)}`);

    } else if (signal === 'sell' && position && position.side === 'buy') {
      // Close long position
      const exitPrice = candle.close * (1 - slippage); // Slippage on exit
      const exitValue = position.quantity * exitPrice;
      const fee = exitValue * feeRate;
      const pnl = exitValue - position.amount - position.fee - fee;

      capital += exitValue - fee;

      const trade = {
        id: trades.length + 1,
        symbol,
        strategy,
        side: position.side,
        entry_price: position.entry_price,
        exit_price: exitPrice,
        quantity: position.quantity,
        amount: position.amount,
        entry_time: position.entry_time,
        exit_time: candle.time,
        duration: candle.time - position.entry_time,
        pnl,
        pnl_percent: (pnl / position.amount) * 100,
        fee: position.fee + fee,
        status: 'closed'
      };

      trades.push(trade);
      position = null;

      console.log(`[${new Date(candle.time).toISOString()}] SELL @ $${exitPrice.toFixed(2)} | P&L: $${pnl.toFixed(2)} (${trade.pnl_percent.toFixed(2)}%) | Capital: $${capital.toFixed(2)}`);

      // Record equity curve point
      equityCurve.push({
        time: candle.time,
        capital,
        trades: trades.length,
        lastPnl: pnl
      });
    }
  }

  // Close any open position at the end
  if (position) {
    const lastCandle = candles[candles.length - 1];
    const exitPrice = lastCandle.close * (1 - slippage);
    const exitValue = position.quantity * exitPrice;
    const fee = exitValue * feeRate;
    const pnl = exitValue - position.amount - position.fee - fee;

    capital += exitValue - fee;

    const trade = {
      id: trades.length + 1,
      symbol,
      strategy,
      side: position.side,
      entry_price: position.entry_price,
      exit_price: exitPrice,
      quantity: position.quantity,
      amount: position.amount,
      entry_time: position.entry_time,
      exit_time: lastCandle.time,
      duration: lastCandle.time - position.entry_time,
      pnl,
      pnl_percent: (pnl / position.amount) * 100,
      fee: position.fee + fee,
      status: 'closed',
      note: 'Force closed at end of backtest'
    };

    trades.push(trade);

    console.log(`[END] Force closing position @ $${exitPrice.toFixed(2)} | P&L: $${pnl.toFixed(2)}`);
  }

  // Calculate performance metrics
  const metrics = calculatePerformanceMetrics(trades, initialCapital);

  // Add backtest-specific metrics
  const totalDays = (endDate - startDate) / (1000 * 60 * 60 * 24);
  const tradesPerDay = trades.length / totalDays;
  const finalCapital = capital;
  const totalReturn = finalCapital - initialCapital;
  const totalReturnPercent = (totalReturn / initialCapital) * 100;
  const annualizedReturn = (Math.pow(finalCapital / initialCapital, 365 / totalDays) - 1) * 100;

  return {
    config: {
      symbol,
      strategy,
      startDate,
      endDate,
      initialCapital,
      positionSize,
      feeRate,
      slippage,
      interval
    },
    summary: {
      totalTrades: trades.length,
      totalDays: Math.round(totalDays),
      tradesPerDay: parseFloat(tradesPerDay.toFixed(2)),
      initialCapital,
      finalCapital: parseFloat(finalCapital.toFixed(2)),
      totalReturn: parseFloat(totalReturn.toFixed(2)),
      totalReturnPercent: parseFloat(totalReturnPercent.toFixed(2)),
      annualizedReturn: parseFloat(annualizedReturn.toFixed(2)),
      candlesProcessed: candles.length
    },
    metrics,
    trades,
    equityCurve,
    generatedAt: Date.now()
  };
}

/**
 * Get signal from strategy
 */
function getStrategySignal(strategy, closes, candles) {
  switch (strategy) {
    case 'momentum':
      return getMomentumSignal(closes);

    case 'sma-crossover':
      return getSmaCrossoverSignal(closes);

    case 'mean-reversion':
      return getMeanReversionSignal(closes);

    case 'multi-indicator':
      return getMultiIndicatorSignal(closes, candles);

    case 'multi-indicator-conservative':
      return getMultiIndicatorSignal(closes, candles, {
        momentumThreshold: 1.5,
        smaDiffThreshold: 0.5,
        pricePositionPercent: 0.02
      });

    case 'multi-indicator-optimized':
      return getMultiIndicatorSignal(closes, candles, {
        momentumThreshold: 0.8,
        smaDiffThreshold: 0.25,
        pricePositionPercent: 0.05
      });

    default:
      return 'hold';
  }
}

/**
 * Momentum strategy: Buy when momentum > 0.5%, sell when < -0.5%
 * (Relaxed from 2%/-1% to generate more realistic signals)
 */
function getMomentumSignal(closes) {
  if (closes.length < 20) return 'hold';

  const mom = momentum(closes, 14);
  const lastMom = mom[mom.length - 1];

  if (lastMom === null) return 'hold';

  if (lastMom > 0.5) return 'buy';
  if (lastMom < -0.5) return 'sell';

  return 'hold';
}

/**
 * SMA Crossover: Buy when fast SMA crosses above slow, sell when crosses below
 */
function getSmaCrossoverSignal(closes) {
  if (closes.length < 50) return 'hold';

  const { signal } = lastSmaSignal(closes, 12, 26);
  return signal;
}

/**
 * Mean Reversion: Buy when price is 2+ std devs below SMA, sell when above SMA
 */
function getMeanReversionSignal(closes) {
  if (closes.length < 50) return 'hold';

  const period = 20;
  const lastIndex = closes.length - 1;

  // Calculate SMA
  const smaValues = closes.slice(lastIndex - period + 1, lastIndex + 1);
  const sma = smaValues.reduce((sum, val) => sum + val, 0) / period;

  // Calculate standard deviation
  const squaredDiffs = smaValues.map(val => Math.pow(val - sma, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / period;
  const stdDev = Math.sqrt(variance);

  const currentPrice = closes[lastIndex];
  const zScore = (currentPrice - sma) / stdDev;

  // Buy when price is 2 std devs below SMA (oversold)
  if (zScore < -2.0) return 'buy';

  // Sell when price is back above SMA (mean reversion complete)
  if (currentPrice > sma && zScore > 0) return 'sell';

  return 'hold';
}

/**
 * Multi-Indicator: Combines SMA, Momentum, and Profit Assessment
 */
function getMultiIndicatorSignal(closes, candles, thresholds = {}) {
  if (closes.length < 50) return 'hold';

  // Get signals from multiple indicators
  const smaSignal = getSmaCrossoverSignal(closes);
  const momentumSignal = getMomentumSignal(closes);

  // Assess profit opportunity with configurable thresholds
  const assessment = assessProfitOpportunity(closes, 12, 26, thresholds);

  // Buy only if:
  // 1. SMA crossover is bullish OR momentum is strong
  // 2. AND there's a profit opportunity
  if ((smaSignal === 'buy' || momentumSignal === 'buy') && assessment.profitOpportunity) {
    return 'buy';
  }

  // Sell if either indicator says sell
  if (smaSignal === 'sell' || momentumSignal === 'sell') {
    return 'sell';
  }

  return 'hold';
}

/**
 * Compare multiple strategies
 */
export async function compareStrategies(config) {
  const strategies = ['momentum', 'sma-crossover', 'mean-reversion', 'multi-indicator', 'multi-indicator-conservative', 'multi-indicator-optimized'];

  console.log(`Running backtest comparison for ${strategies.length} strategies...`);

  const results = [];

  for (const strategy of strategies) {
    try {
      console.log(`\n--- Testing ${strategy} ---`);
      const result = await runBacktest({ ...config, strategy });
      results.push({
        strategy,
        metrics: result.summary,
        performance: result.metrics
      });
    } catch (error) {
      console.error(`Failed to backtest ${strategy}:`, error.message);
      results.push({
        strategy,
        error: error.message
      });
    }
  }

  // Sort by total return
  results.sort((a, b) => {
    const returnA = a.metrics?.totalReturnPercent || -Infinity;
    const returnB = b.metrics?.totalReturnPercent || -Infinity;
    return returnB - returnA;
  });

  return {
    comparison: results,
    config,
    generatedAt: Date.now()
  };
}

/**
 * Quick backtest with default settings
 */
export async function quickBacktest(symbol = 'BTCUSD', strategy = 'momentum') {
  return await runBacktest({
    symbol,
    strategy,
    startDate: Date.now() - (30 * 24 * 60 * 60 * 1000), // 30 days
    initialCapital: 10000,
    positionSize: 1000,
    interval: '1h'
  });
}

/**
 * Get available strategies
 */
export function getAvailableStrategies() {
  return [
    {
      id: 'momentum',
      name: 'Momentum',
      description: 'Buys when momentum is positive (>0.5%), sells on weakness (<-0.5%)'
    },
    {
      id: 'sma-crossover',
      name: 'SMA Crossover',
      description: 'Buys when fast SMA (12) crosses above slow SMA (26)'
    },
    {
      id: 'mean-reversion',
      name: 'Mean Reversion',
      description: 'Buys when price is oversold (2 std devs below SMA), sells at mean'
    },
    {
      id: 'multi-indicator',
      name: 'Multi-Indicator',
      description: 'Combines SMA, momentum, and profit opportunity assessment'
    },
    {
      id: 'multi-indicator-conservative',
      name: 'Multi-Indicator (Conservative)',
      description: 'Conservative thresholds: 1.5% momentum, 0.5% SMA diff, 2% price position'
    },
    {
      id: 'multi-indicator-optimized',
      name: 'Multi-Indicator (Optimized)',
      description: 'Optimized thresholds: 0.8% momentum, 0.25% SMA diff, 5% price position'
    }
  ];
}

/**
 * Validate backtest configuration
 */
export function validateBacktestConfig(config) {
  const errors = [];

  if (!config.symbol) {
    errors.push('Symbol is required');
  }

  if (!config.strategy) {
    errors.push('Strategy is required');
  }

  if (config.positionSize > config.initialCapital) {
    errors.push('Position size cannot exceed initial capital');
  }

  if (config.startDate >= config.endDate) {
    errors.push('Start date must be before end date');
  }

  const maxBacktestDays = 365;
  const days = (config.endDate - config.startDate) / (1000 * 60 * 60 * 24);
  if (days > maxBacktestDays) {
    errors.push(`Backtest period cannot exceed ${maxBacktestDays} days`);
  }

  if (config.feeRate < 0 || config.feeRate > 0.01) {
    errors.push('Fee rate must be between 0% and 1%');
  }

  if (config.slippage < 0 || config.slippage > 0.05) {
    errors.push('Slippage must be between 0% and 5%');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

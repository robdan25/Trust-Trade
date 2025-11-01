import { v4 as uuidv4 } from 'uuid';
import { lastSmaSignal, assessProfitOpportunity } from './indicators.mjs';
import { preTradeChecks, positionSizeUSD } from './risk.mjs';
import { explainWithClaude } from './claude.mjs';
import { getCandles as krakenCandles, getCurrentPrice as krakenGetPrice } from '../adapters/kraken.mjs';
import {
  saveTrade,
  saveSignal,
  setAutomationState,
  getAutomationState,
  getOpenTrades,
  updatePortfolio,
  getLatestSignal,
  closeTrade
} from './database.mjs';
import fetch from 'node-fetch';
import { DEFAULT_RISK_CONFIG, calculateStopLoss, calculateTakeProfit } from './risk-advanced.mjs';
import { createPosition, checkAllPositions, closePosition, getActivePositions } from './order-manager.mjs';
import { composeSignal, isSignalStrong, getSignalStrength } from './signal-composer.mjs';
import { analyzeWithOptimalStrategy, getStrategyStatus } from './strategy-manager.mjs';
import { getRegimeSummary } from './market-regime.mjs';

// Automation state
let automationActive = false;
let automationIntervals = new Map();
let positionMonitorInterval = null;
let useCdnPrices = false;
let tradingMode = 'paper'; // 'paper' or 'live' - default to paper for safety
let riskConfig = { ...DEFAULT_RISK_CONFIG }; // Risk management configuration

// Price cache for CDN mode
const priceCache = new Map();
const CACHE_TTL = 60000; // 1 minute

export function setAutomationActive(active) {
  automationActive = active;
  setAutomationState('automation_active', active);
}

export function isAutomationActive() {
  return automationActive;
}

export function setCdnPricesEnabled(enabled) {
  useCdnPrices = enabled;
  setAutomationState('use_cdn_prices', enabled);
}

export function isCdnPricesEnabled() {
  return useCdnPrices;
}

export function setTradingMode(mode) {
  if (mode !== 'paper' && mode !== 'live') {
    throw new Error('Trading mode must be "paper" or "live"');
  }
  tradingMode = mode;
  setAutomationState('trading_mode', mode);
  console.log(`🔧 Trading mode changed to: ${mode.toUpperCase()}`);
}

export function getTradingMode() {
  return tradingMode;
}

// Get current price with CDN option
async function getCurrentPrice(symbol) {
  // If using CDN prices and cached, return cached
  if (useCdnPrices) {
    const cached = priceCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.price;
    }
  }

  try {
    const price = await krakenGetPrice(symbol);

    // Cache the price
    priceCache.set(symbol, { price, timestamp: Date.now() });

    return price;
  } catch (e) {
    console.error(`Failed to fetch price for ${symbol} from Kraken:`, e.message);
    // Return cached if available
    const cached = priceCache.get(symbol);
    return cached ? cached.price : null;
  }
}

// Analyze and generate signal with adaptive strategy selection
export async function analyzeAndSignal(symbol, interval = '5m', config = {}) {
  const {
    shortPeriod = 12,
    longPeriod = 26,
    useAi = false,
    useAdvancedIndicators = true,
    useAdaptiveStrategy = true,  // NEW: Enable Phase 3 adaptive strategies
    // Phase 1 Quick Fix: Relaxed thresholds
    momentumThreshold = 0.6,      // Down from 0.8% (optimized) and 1.5% (conservative)
    smaDiffThreshold = 0.2,       // Down from 0.25% (optimized) and 0.5% (conservative)
    pricePositionPercent = 0.05   // 5% price position wiggle room
  } = config;

  try {
    // Fetch candles from Kraken
    const candles = await krakenCandles({ symbol, interval, limit: 500 });

    if (!candles || candles.length === 0) {
      throw new Error(`No candles for ${symbol}`);
    }

    const closes = candles.map(c => c.close);
    const price = closes[closes.length - 1];
    let signal, confidence, indicators, reason, strategy, regime;

    // Phase 3: Use adaptive strategy selection based on market regime
    if (useAdaptiveStrategy) {
      const adaptiveSignal = analyzeWithOptimalStrategy(candles, config);

      signal = adaptiveSignal.signal;
      confidence = adaptiveSignal.confidence;
      indicators = adaptiveSignal.indicators;
      reason = adaptiveSignal.reason;
      strategy = adaptiveSignal.strategyUsed;
      regime = adaptiveSignal.regime;
    }
    // Phase 2: Use multi-indicator analysis
    else if (useAdvancedIndicators) {
      const compositeSignal = composeSignal(candles, {
        useSMA: true,
        useRSI: true,
        useMACD: true,
        useBollingerBands: true,
        useVolume: true,
        rsiPeriod: 14,
        macdFast: 12,
        macdSlow: 26,
        macdSignal: 9,
        bbPeriod: 20,
        bbStdDev: 2
      });

      signal = compositeSignal.signal;
      confidence = compositeSignal.confidence;
      indicators = compositeSignal.indicators;
      reason = compositeSignal.reason;
      strategy = 'multi-indicator';
      regime = null;
    }
    // Phase 1: Fallback to simple SMA
    else {
      const smaResult = lastSmaSignal(closes, shortPeriod, longPeriod);
      signal = smaResult.signal;
      confidence = null;
      indicators = null;
      reason = `SMA ${signal.toUpperCase()}`;
      strategy = 'sma';
      regime = null;
    }

    // Get AI explanation if enabled
    let explain = null;
    if (useAi) {
      explain = await explainWithClaude({
        symbol,
        interval,
        signal,
        context: { price, confidence, reason, strategy, regime }
      });
    }

    // Save signal to database
    const signalRecord = {
      id: uuidv4(),
      symbol,
      interval,
      signal,
      price,
      shortPeriod,
      longPeriod,
      timestamp: Date.now(),
      confidence: confidence || explain?.confidence,
      riskNote: reason || explain?.risk
    };
    saveSignal(signalRecord);

    return {
      id: signalRecord.id,
      symbol,
      interval,
      signal,
      price,
      confidence,
      indicators,
      reason,
      strategy,
      regime,
      shortPeriod,
      longPeriod,
      explain,
      timestamp: Date.now()
    };
  } catch (e) {
    console.error(`Error analyzing ${symbol}:`, e.message);
    return { symbol, signal: 'hold', error: String(e) };
  }
}

// Execute trade
export async function executeTrade(symbol, side, balanceUsd = 10000, config = {}) {
  const { sizePct = 0.75, mode = 'paper', riskMode = 'balanced' } = config;

  try {
    // Get current price
    const price = await getCurrentPrice(symbol);
    if (!price) {
      throw new Error(`Cannot get price for ${symbol}`);
    }

    // Pre-trade checks
    const check = preTradeChecks({ balanceUSD: balanceUsd, price, minNotional: 10 });
    if (!check.ok) {
      return { ok: false, error: check.reason };
    }

    // Calculate position size
    const notional = balanceUsd * sizePct;
    const quantity = notional / price;

    // Calculate stop-loss and take-profit prices
    const stopLossPrice = calculateStopLoss(side, price, riskConfig.stopLossPercent);
    const takeProfitPrice = calculateTakeProfit(side, price, riskConfig.takeProfitPercent);

    // Create trade record with risk management
    const trade = {
      id: uuidv4(),
      symbol,
      side,
      price,
      quantity,
      notional,
      mode,
      status: 'open',
      timestamp: Date.now(),
      stopLossPrice,
      takeProfitPrice,
      trailingStopEnabled: riskConfig.useTrailingStop,
      highestPrice: price,
      lowestPrice: price
    };

    // Save trade to database
    saveTrade(trade);

    // Create position in order manager for monitoring
    createPosition(trade, riskConfig);

    // Update portfolio
    if (side === 'buy') {
      updatePortfolio(symbol, quantity, price, price);
    } else if (side === 'sell') {
      updatePortfolio(symbol, -quantity, price, price);
    }

    return {
      ok: true,
      trade,
      message: `${side.toUpperCase()} order executed`
    };
  } catch (e) {
    console.error(`Trade execution error:`, e.message);
    return { ok: false, error: String(e) };
  }
}

// Automated trading loop
export function startAutomation(config = {}) {
  const {
    symbols = ['BTCUSDT'],
    interval = '5m',         // Phase 1: Changed from 1m to 5m
    checkInterval = 30000,   // Phase 1: 30 seconds check interval
    autoTrade = true,
    balancePerSymbol = 10000,
    sizePct = 0.75,
    // Phase 1: Relaxed thresholds (CRITICAL - must be defined here!)
    momentumThreshold = 0.6,      // Down from 1.5%
    smaDiffThreshold = 0.2,       // Down from 0.5%
    pricePositionPercent = 0.05,  // 5% price position
    shortPeriod = 12,
    longPeriod = 26
  } = config;

  if (automationActive) {
    return { ok: false, error: 'Automation already running' };
  }

  automationActive = true;
  setAutomationState('automation_active', true);
  setAutomationState('automation_config', config);

  console.log(`Starting automation for symbols: ${symbols.join(', ')}`);

  // Create automation loop for each symbol
  symbols.forEach(symbol => {
    const intervalId = setInterval(async () => {
      try {
        // Fetch candles for analysis
        const candles = await krakenCandles({ symbol, interval, limit: 500 });

        if (!candles || candles.length === 0) {
          console.error(`No candles for ${symbol}`);
          return;
        }

        const closes = candles.map(c => c.close);
        const currentPrice = closes[closes.length - 1];

        // Generate signal with Phase 1 (Simple SMA + Relaxed Thresholds)
        const signalResult = await analyzeAndSignal(symbol, interval, {
          useAi: false, // Disable AI to speed up analysis
          useAdvancedIndicators: false, // Phase 1: Disable multi-indicator
          useAdaptiveStrategy: false, // Phase 1: Disable adaptive strategies
          momentumThreshold,  // Pass relaxed thresholds
          smaDiffThreshold,
          pricePositionPercent
        });

        if (signalResult.error) {
          console.error(`Signal error for ${symbol}:`, signalResult.error);
          return;
        }

        // Assess profit opportunity with Phase 1 relaxed thresholds
        const profitAnalysis = assessProfitOpportunity(closes, shortPeriod, longPeriod, {
          momentumThreshold,
          smaDiffThreshold,
          pricePositionPercent
        });

        // Log signal with detailed indicator and regime data
        console.log(`\n[${new Date().toISOString()}] ${symbol}: ${signalResult.signal.toUpperCase()} @ $${currentPrice}`);

        // Show market regime if available
        if (signalResult.regime) {
          const regimeSummary = getRegimeSummary(signalResult.regime);
          console.log(`  ${regimeSummary}`);
          console.log(`  🎯 Using Strategy: ${signalResult.strategy}`);
        }

        if (signalResult.confidence !== null) {
          console.log(`  📊 Signal Strength: ${getSignalStrength(signalResult.confidence)} (${signalResult.confidence}%)`);
          console.log(`  📈 ${signalResult.reason}`);

          // Show individual indicator signals
          if (signalResult.indicators) {
            const ind = signalResult.indicators;
            if (ind.rsi) {
              console.log(`     RSI: ${ind.rsi.value.toFixed(1)} - ${ind.rsi.description}`);
            }
            if (ind.macd) {
              console.log(`     MACD: ${ind.macd.description}`);
            }
            if (ind.bollingerBands) {
              console.log(`     BB: ${ind.bollingerBands.description}`);
            }
            if (ind.volume) {
              console.log(`     Volume: ${ind.volume.description}`);
            }
          }
        }

        console.log(`  Profit Opportunity: ${profitAnalysis.profitOpportunity ? 'YES' : 'NO'}`);
        if (profitAnalysis.profitOpportunity) {
          console.log(`  ${profitAnalysis.reason}`);
          console.log(`  Expected Profit: ${profitAnalysis.expectedProfit}%`);
          console.log(`  Risk/Reward: ${profitAnalysis.riskReward}`);
          console.log(`  Momentum: ${profitAnalysis.momentum}%`);
        } else {
          console.log(`  Momentum: ${profitAnalysis.momentum}%, SMA Diff: ${profitAnalysis.smaDiff}%`);
        }

        // Auto-trade based on signal strength (Phase 1: profit opportunity requirement REMOVED)
        const minConfidence = 60; // Minimum 60% confidence required (only for Phase 2/3)
        // Phase 1: Simple SMA has no confidence score, so treat any non-hold signal as strong
        const signalStrong = signalResult.confidence === null
          ? (signalResult.signal !== 'hold')
          : (signalResult.confidence >= minConfidence);

        if (autoTrade && signalStrong && signalResult.signal !== 'hold') {
          const lastSignal = getLatestSignal(symbol);

          // Minimum risk/reward ratio threshold
          const minRiskReward = 1.5; // Require at least 1.5:1 risk/reward

          if (parseFloat(profitAnalysis.riskReward) < minRiskReward) {
            console.log(`  ⚠️  Risk/Reward too low (${profitAnalysis.riskReward} < ${minRiskReward}), skipping trade`);
            return;
          }

          // Avoid double-trading on same signal
          if (!lastSignal || lastSignal.signal !== signalResult.signal) {
            const side = signalResult.signal === 'buy' ? 'buy' : 'sell';

            console.log(`  💰 STRONG SIGNAL + PROFITABLE OPPORTUNITY - Executing ${side.toUpperCase()}`);
            console.log(`     Confidence: ${signalResult.confidence}%, Expected Profit: ${profitAnalysis.expectedProfit}%`);

            const tradeResult = await executeTrade(symbol, side, balancePerSymbol, {
              sizePct,
              mode: tradingMode // Use configured trading mode (paper or live)
            });

            if (tradeResult.ok) {
              console.log(`  ✓ Trade executed: ${side.toUpperCase()} ${symbol} @ $${currentPrice}`);
              console.log(`  📊 Stop-Loss: $${tradeResult.trade.stopLossPrice.toFixed(2)}, Take-Profit: $${tradeResult.trade.takeProfitPrice.toFixed(2)}`);
            } else {
              console.error(`  ✗ Trade failed: ${tradeResult.error}`);
            }
          } else {
            console.log(`  ⚠️  Already have ${lastSignal.signal} signal, avoiding duplicate trade`);
          }
        } else if (autoTrade && !signalStrong) {
          console.log(`  ⏸️  Signal confidence too low (${signalResult.confidence || 0}% < ${minConfidence}%), waiting...`);
        }
        // Phase 1: Removed profit opportunity check - now trading on signal strength alone
      } catch (e) {
        console.error(`Automation error for ${symbol}:`, e.message);
      }
    }, checkInterval);

    automationIntervals.set(symbol, intervalId);
  });

  // Start position monitoring loop (checks every 5 seconds for stop-loss/take-profit)
  positionMonitorInterval = setInterval(async () => {
    try {
      const activePositions = getActivePositions();

      if (activePositions.length === 0) {
        return; // No positions to monitor
      }

      // Check each active position
      for (const position of activePositions) {
        try {
          // Get current price for this symbol
          const currentPrice = await getCurrentPrice(position.symbol);

          if (!currentPrice) {
            console.error(`Cannot get price for ${position.symbol}`);
            continue;
          }

          // Check for stop-loss or take-profit triggers
          const triggers = checkAllPositions(position.symbol, currentPrice);

          // Execute exits for triggered positions
          for (const trigger of triggers) {
            if (trigger.triggered) {
              console.log(`\n🚨 EXIT TRIGGERED for ${position.symbol}!`);
              console.log(`   Action: ${trigger.action.toUpperCase()}`);
              console.log(`   Exit Price: $${trigger.exitPrice.toFixed(2)}`);
              console.log(`   P&L: ${trigger.pnl >= 0 ? '+' : ''}$${trigger.pnl.toFixed(2)} (${trigger.pnlPercent.toFixed(2)}%)\n`);

              // Close position in order manager
              const closedPosition = closePosition(
                trigger.position.id,
                trigger.exitPrice,
                trigger.action
              );

              // Update database
              await closeTrade(
                trigger.position.id,
                trigger.exitPrice,
                closedPosition.realizedPnl,
                closedPosition.realizedPnlPercent,
                trigger.action
              );

              // Update portfolio
              await updatePortfolio(
                position.symbol,
                -position.quantity, // Remove from portfolio
                position.entryPrice,
                trigger.exitPrice
              );
            }
          }
        } catch (posError) {
          console.error(`Error monitoring position ${position.id}:`, posError.message);
        }
      }
    } catch (e) {
      console.error('Position monitor error:', e.message);
    }
  }, 5000); // Check every 5 seconds

  return {
    ok: true,
    message: `Automation started for ${symbols.length} symbol(s) with risk management`,
    symbols,
    checkInterval,
    riskManagement: {
      stopLossPercent: riskConfig.stopLossPercent,
      takeProfitPercent: riskConfig.takeProfitPercent,
      trailingStopEnabled: riskConfig.useTrailingStop
    }
  };
}

// Stop automation
export function stopAutomation() {
  if (!automationActive) {
    return { ok: false, error: 'Automation not running' };
  }

  // Stop all symbol automation intervals
  automationIntervals.forEach((intervalId, symbol) => {
    clearInterval(intervalId);
    console.log(`Stopped automation for ${symbol}`);
  });

  // Stop position monitoring
  if (positionMonitorInterval) {
    clearInterval(positionMonitorInterval);
    positionMonitorInterval = null;
    console.log('Stopped position monitoring');
  }

  automationIntervals.clear();
  automationActive = false;
  setAutomationState('automation_active', false);

  return { ok: true, message: 'Automation stopped (including position monitoring)' };
}

// Get automation status
export function getAutomationStatus() {
  const config = getAutomationState('automation_config') || {};
  return {
    active: automationActive,
    useCdnPrices,
    config,
    symbols: Array.from(automationIntervals.keys())
  };
}

// Restart automation with new config
export function restartAutomation(newConfig) {
  if (automationActive) {
    stopAutomation();
  }
  return startAutomation(newConfig);
}

export default {
  setAutomationActive,
  isAutomationActive,
  setCdnPricesEnabled,
  isCdnPricesEnabled,
  analyzeAndSignal,
  executeTrade,
  startAutomation,
  stopAutomation,
  getAutomationStatus,
  restartAutomation
};

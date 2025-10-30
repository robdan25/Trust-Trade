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
  getLatestSignal
} from './database.mjs';
import fetch from 'node-fetch';

// Automation state
let automationActive = false;
let automationIntervals = new Map();
let useCdnPrices = false;

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

// Analyze and generate signal
export async function analyzeAndSignal(symbol, interval = '1m', config = {}) {
  const {
    shortPeriod = 12,
    longPeriod = 26,
    useAi = false
  } = config;

  try {
    // Fetch candles from Kraken
    const candles = await krakenCandles({ symbol, interval, limit: 500 });

    if (!candles || candles.length === 0) {
      throw new Error(`No candles for ${symbol}`);
    }

    // Generate signal
    const closes = candles.map(c => c.c);
    const { signal, lastIdx } = lastSmaSignal(closes, shortPeriod, longPeriod);
    const price = closes[closes.length - 1];

    // Get AI explanation if enabled
    let explain = null;
    if (useAi) {
      explain = await explainWithClaude({
        symbol,
        interval,
        signal,
        context: { lastIdx, price }
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
      confidence: explain?.confidence,
      riskNote: explain?.risk
    };
    saveSignal(signalRecord);

    return {
      id: signalRecord.id,
      symbol,
      interval,
      signal,
      price,
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

    // Create trade record
    const trade = {
      id: uuidv4(),
      symbol,
      side,
      price,
      quantity,
      notional,
      mode,
      status: 'open',
      timestamp: Date.now()
    };

    // Save trade
    saveTrade(trade);

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
    interval = '1m',
    checkInterval = 60000, // 1 minute
    autoTrade = true,
    balancePerSymbol = 10000,
    sizePct = 0.75
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

        const closes = candles.map(c => c.c);
        const currentPrice = closes[closes.length - 1];

        // Generate signal
        const signalResult = await analyzeAndSignal(symbol, interval, {
          useAi: false // Disable AI to speed up analysis
        });

        if (signalResult.error) {
          console.error(`Signal error for ${symbol}:`, signalResult.error);
          return;
        }

        // Assess profit opportunity
        const profitAnalysis = assessProfitOpportunity(closes);

        console.log(`[${new Date().toISOString()}] ${symbol}: ${signalResult.signal.toUpperCase()} @ $${currentPrice}`);
        console.log(`  Profit Opportunity: ${profitAnalysis.profitOpportunity ? 'YES' : 'NO'}`);
        if (profitAnalysis.profitOpportunity) {
          console.log(`  ${profitAnalysis.reason}`);
          console.log(`  Expected Profit: ${profitAnalysis.expectedProfit}%`);
          console.log(`  Risk/Reward: ${profitAnalysis.riskReward}`);
          console.log(`  Momentum: ${profitAnalysis.momentum}%`);
        } else {
          console.log(`  Momentum: ${profitAnalysis.momentum}%, SMA Diff: ${profitAnalysis.smaDiff}%`);
        }

        // Auto-trade ONLY if there's a profit opportunity
        if (autoTrade && profitAnalysis.profitOpportunity && signalResult.signal !== 'hold') {
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

            console.log(`  💰 PROFITABLE TRADE DETECTED - Executing ${side.toUpperCase()}`);

            const tradeResult = await executeTrade(symbol, side, balancePerSymbol, {
              sizePct,
              mode: 'paper' // Use paper mode by default for safety
            });

            if (tradeResult.ok) {
              console.log(`  ✓ Trade executed: ${side.toUpperCase()} ${symbol} @ $${currentPrice}`);
              console.log(`  📊 Expected profit: ${profitAnalysis.expectedProfit}%`);
            } else {
              console.error(`  ✗ Trade failed: ${tradeResult.error}`);
            }
          } else {
            console.log(`  ⚠️  Already have ${lastSignal.signal} signal, avoiding duplicate trade`);
          }
        } else if (autoTrade && !profitAnalysis.profitOpportunity) {
          console.log(`  ⏸️  No profitable opportunity detected, waiting...`);
        }
      } catch (e) {
        console.error(`Automation error for ${symbol}:`, e.message);
      }
    }, checkInterval);

    automationIntervals.set(symbol, intervalId);
  });

  return {
    ok: true,
    message: `Automation started for ${symbols.length} symbol(s)`,
    symbols,
    checkInterval
  };
}

// Stop automation
export function stopAutomation() {
  if (!automationActive) {
    return { ok: false, error: 'Automation not running' };
  }

  automationIntervals.forEach((intervalId, symbol) => {
    clearInterval(intervalId);
    console.log(`Stopped automation for ${symbol}`);
  });

  automationIntervals.clear();
  automationActive = false;
  setAutomationState('automation_active', false);

  return { ok: true, message: 'Automation stopped' };
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

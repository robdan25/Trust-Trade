/**
 * Strategy Manager
 *
 * Orchestrates multiple trading strategies and automatically switches
 * between them based on market regime detection
 *
 * Workflow:
 * 1. Detect current market regime
 * 2. Select optimal strategy for regime
 * 3. Generate trading signals using selected strategy
 * 4. Monitor for regime changes
 * 5. Switch strategies when regime changes
 */

import { detectMarketRegime, detectRegimeChange, getRegimeSummary, MARKET_REGIMES } from './market-regime.mjs';
import { analyzeMeanReversion, isSuitableForMeanReversion, MEAN_REVERSION_CONFIG } from './strategies/mean-reversion.mjs';
import { analyzeMomentum, isSuitableForMomentum, MOMENTUM_CONFIG } from './strategies/momentum.mjs';
import { analyzeGridTrading, isSuitableForGridTrading, GRID_CONFIG } from './strategies/grid-trading.mjs';
import { analyzeDayTrading, isSuitableForDayTrading, DAY_TRADING_CONFIG } from './strategies/day-trading.mjs';
import { composeSignal } from './signal-composer.mjs';

/**
 * Strategy Manager State
 */
let currentStrategy = 'multi-indicator'; // Default to Phase 2 multi-indicator
let currentRegime = null;
let lastRegimeCheck = 0;
const REGIME_CHECK_INTERVAL = 300000; // Check regime every 5 minutes

/**
 * Strategy Manager Configuration
 */
export const STRATEGY_MANAGER_CONFIG = {
  // Auto-switching
  autoSwitch: true,
  regimeCheckInterval: 300000, // 5 minutes

  // Strategy preferences
  defaultStrategy: 'multi-indicator',
  allowedStrategies: ['multi-indicator', 'mean-reversion', 'momentum', 'grid-trading', 'day-trading'],

  // Confidence thresholds
  minRegimeConfidence: 60,   // Minimum confidence to trust regime detection
  minStrategyConfidence: 55, // Minimum confidence for strategy signals

  // Override settings
  forceStrategy: null // Set to strategy name to disable auto-switching
};

/**
 * Analyze market and generate signal using optimal strategy
 * @param {Array} candles - Array of candle objects
 * @param {Object} config - Configuration options
 * @returns {Object} Trading signal with strategy metadata
 */
export function analyzeWithOptimalStrategy(candles, config = {}) {
  const {
    autoSwitch = STRATEGY_MANAGER_CONFIG.autoSwitch,
    forceStrategy = STRATEGY_MANAGER_CONFIG.forceStrategy
  } = config;

  if (candles.length < 100) {
    return {
      signal: 'hold',
      confidence: 0,
      reason: 'Insufficient data for strategy analysis',
      strategy: 'none',
      regime: null
    };
  }

  // Check if we should update regime detection
  const now = Date.now();
  const shouldCheckRegime = !currentRegime || (now - lastRegimeCheck) > REGIME_CHECK_INTERVAL;

  if (shouldCheckRegime) {
    const newRegime = detectMarketRegime(candles);

    // Detect regime change
    if (currentRegime) {
      const change = detectRegimeChange(currentRegime, newRegime);
      if (change.changed) {
        console.log(`\n🔄 MARKET REGIME CHANGE DETECTED:`);
        console.log(`   ${change.message}`);
        if (change.shouldSwitchStrategy) {
          console.log(`   Switching strategy: ${change.fromStrategy} → ${change.toStrategy}\n`);
        }
      }
    }

    currentRegime = newRegime;
    lastRegimeCheck = now;
  }

  // Determine which strategy to use
  let selectedStrategy;

  if (forceStrategy) {
    // Manual override
    selectedStrategy = forceStrategy;
  } else if (!autoSwitch) {
    // Auto-switching disabled, use default
    selectedStrategy = STRATEGY_MANAGER_CONFIG.defaultStrategy;
  } else if (currentRegime.confidence < STRATEGY_MANAGER_CONFIG.minRegimeConfidence) {
    // Low confidence in regime, use safe default
    selectedStrategy = 'multi-indicator';
  } else {
    // Use regime-recommended strategy
    selectedStrategy = currentRegime.recommendedStrategy;
  }

  // Generate signal using selected strategy
  let signalResult;

  switch (selectedStrategy) {
    case 'mean-reversion':
      signalResult = analyzeMeanReversion(candles, config);
      break;

    case 'momentum':
      signalResult = analyzeMomentum(candles, config);
      break;

    case 'grid-trading':
      signalResult = analyzeGridTrading(candles, config);
      break;

    case 'day-trading':
      signalResult = analyzeDayTrading(candles, config);
      break;

    case 'multi-indicator':
    default:
      // Fallback to Phase 2 multi-indicator approach
      signalResult = composeSignal(candles, {
        useSMA: true,
        useRSI: true,
        useMACD: true,
        useBollingerBands: true,
        useVolume: true
      });
      signalResult.strategy = 'multi-indicator';
      break;
  }

  // Enhance signal with regime context
  const enhancedSignal = {
    ...signalResult,
    regime: currentRegime,
    strategyUsed: selectedStrategy,
    regimeConfidence: currentRegime.confidence,
    autoSwitched: autoSwitch && selectedStrategy === currentRegime.recommendedStrategy
  };

  return enhancedSignal;
}

/**
 * Get current strategy and regime status
 * @returns {Object} Status information
 */
export function getStrategyStatus() {
  return {
    currentStrategy,
    currentRegime: currentRegime ? {
      type: currentRegime.regime,
      confidence: currentRegime.confidence,
      recommended: currentRegime.recommendedStrategy,
      reason: currentRegime.reason
    } : null,
    lastRegimeCheck,
    config: STRATEGY_MANAGER_CONFIG
  };
}

/**
 * Manually set strategy (disables auto-switching)
 * @param {string} strategy - Strategy name
 * @returns {Object} Result
 */
export function setStrategy(strategy) {
  const allowed = STRATEGY_MANAGER_CONFIG.allowedStrategies;

  if (!allowed.includes(strategy)) {
    return {
      ok: false,
      error: `Invalid strategy. Allowed: ${allowed.join(', ')}`
    };
  }

  currentStrategy = strategy;
  STRATEGY_MANAGER_CONFIG.forceStrategy = strategy;

  return {
    ok: true,
    message: `Strategy set to ${strategy} (auto-switching disabled)`,
    strategy
  };
}

/**
 * Enable auto-switching based on regime
 * @returns {Object} Result
 */
export function enableAutoSwitch() {
  STRATEGY_MANAGER_CONFIG.forceStrategy = null;
  STRATEGY_MANAGER_CONFIG.autoSwitch = true;

  return {
    ok: true,
    message: 'Auto-switching enabled - strategy will adapt to market regime'
  };
}

/**
 * Get strategy recommendation without generating signal
 * @param {Array} candles - Array of candles
 * @returns {Object} Strategy recommendation
 */
export function getStrategyRecommendation(candles) {
  if (candles.length < 100) {
    return {
      recommended: 'multi-indicator',
      confidence: 0,
      reason: 'Insufficient data'
    };
  }

  const regime = detectMarketRegime(candles);

  // Check suitability of each strategy
  const meanReversionSuit = isSuitableForMeanReversion(candles);
  const momentumSuit = isSuitableForMomentum(candles);
  const gridSuit = isSuitableForGridTrading(candles);
  const dayTradingSuit = isSuitableForDayTrading(candles);

  const strategies = [
    {
      name: 'mean-reversion',
      confidence: meanReversionSuit.confidence,
      suitable: meanReversionSuit.suitable,
      reason: meanReversionSuit.reason
    },
    {
      name: 'momentum',
      confidence: momentumSuit.confidence,
      suitable: momentumSuit.suitable,
      reason: momentumSuit.reason
    },
    {
      name: 'grid-trading',
      confidence: gridSuit.confidence,
      suitable: gridSuit.suitable,
      reason: gridSuit.reason
    },
    {
      name: 'day-trading',
      confidence: dayTradingSuit.confidence,
      suitable: dayTradingSuit.suitable,
      reason: dayTradingSuit.reason
    }
  ];

  // Sort by confidence
  strategies.sort((a, b) => b.confidence - a.confidence);

  return {
    regime: {
      type: regime.regime,
      confidence: regime.confidence,
      recommended: regime.recommendedStrategy
    },
    strategies,
    bestStrategy: strategies[0],
    regimeRecommended: regime.recommendedStrategy
  };
}

/**
 * Compare strategy performance (for backtesting)
 * @param {Array} candles - Historical candles
 * @param {string} strategyName - Strategy to analyze
 * @returns {Object} Strategy signals over time
 */
export function analyzeStrategyHistory(candles, strategyName) {
  if (candles.length < 200) {
    return {
      ok: false,
      error: 'Need at least 200 candles for historical analysis'
    };
  }

  const signals = [];
  const windowSize = 100;

  // Slide through history generating signals
  for (let i = windowSize; i < candles.length; i += 10) { // Check every 10 candles
    const window = candles.slice(i - windowSize, i);

    let signal;
    switch (strategyName) {
      case 'mean-reversion':
        signal = analyzeMeanReversion(window);
        break;
      case 'momentum':
        signal = analyzeMomentum(window);
        break;
      case 'grid-trading':
        signal = analyzeGridTrading(window);
        break;
      case 'multi-indicator':
        signal = composeSignal(window, {
          useSMA: true,
          useRSI: true,
          useMACD: true,
          useBollingerBands: true,
          useVolume: true
        });
        break;
      default:
        continue;
    }

    if (signal.signal !== 'hold') {
      signals.push({
        timestamp: candles[i].t,
        price: candles[i].c,
        signal: signal.signal,
        confidence: signal.confidence,
        reason: signal.reason
      });
    }
  }

  // Calculate statistics
  const buySignals = signals.filter(s => s.signal === 'buy').length;
  const sellSignals = signals.filter(s => s.signal === 'sell').length;
  const avgConfidence = signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length;

  return {
    ok: true,
    strategy: strategyName,
    totalSignals: signals.length,
    buySignals,
    sellSignals,
    avgConfidence: avgConfidence.toFixed(1),
    signals: signals.slice(-20) // Return last 20 signals
  };
}

/**
 * Get detailed strategy info
 * @param {string} strategyName - Strategy name
 * @returns {Object} Strategy configuration and description
 */
export function getStrategyInfo(strategyName) {
  const configs = {
    'mean-reversion': MEAN_REVERSION_CONFIG,
    'momentum': MOMENTUM_CONFIG,
    'grid-trading': GRID_CONFIG,
    'day-trading': DAY_TRADING_CONFIG,
    'multi-indicator': {
      name: 'Multi-Indicator',
      description: 'Combines RSI, MACD, Bollinger Bands, SMA, and Volume with weighted voting'
    }
  };

  const config = configs[strategyName];

  if (!config) {
    return {
      ok: false,
      error: `Unknown strategy: ${strategyName}`
    };
  }

  return {
    ok: true,
    strategy: strategyName,
    ...config
  };
}

export default {
  analyzeWithOptimalStrategy,
  getStrategyStatus,
  setStrategy,
  enableAutoSwitch,
  getStrategyRecommendation,
  analyzeStrategyHistory,
  getStrategyInfo,
  STRATEGY_MANAGER_CONFIG
};

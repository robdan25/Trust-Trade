import dotenv from "dotenv";
dotenv.config();
console.log("DEBUG: KRAKEN_API_KEY exists:", !!process.env.KRAKEN_API_KEY);
console.log("DEBUG: KRAKEN_API_SECRET exists:", !!process.env.KRAKEN_API_SECRET);
import express from "express";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { z } from "zod";
import path from "path";
import { fileURLToPath } from "url";
import { getCandles as krakenCandles, placeOrder as krakenPlace, getCurrentPrice, getAccountBalance } from "./adapters/kraken.mjs";
import { lastSmaSignal } from "./lib/indicators.mjs";
import { positionSizeUSD, preTradeChecks } from "./lib/risk.mjs";
import { explainWithClaude } from "./lib/claude.mjs";
import { initDatabase, getAllTrades, getPortfolio, getPortfolioValue } from "./lib/database.mjs";
import {
  startAutomation,
  stopAutomation,
  getAutomationStatus,
  analyzeAndSignal,
  setCdnPricesEnabled,
  isCdnPricesEnabled,
  restartAutomation,
  getTradingMode,
  setTradingMode
} from "./lib/automation.mjs";
import { getAnalyticsSummary } from "./lib/analytics.mjs";
import {
  getRiskSummary,
  getCircuitBreakerConfig,
  updateCircuitBreakerConfig,
  resetCircuitBreaker,
  getPortfolioLimits,
  updatePortfolioLimits,
  checkCircuitBreaker,
  updateCircuitBreaker
} from "./lib/advanced-risk.mjs";
import {
  runBacktest,
  compareStrategies,
  quickBacktest,
  getAvailableStrategies,
  validateBacktestConfig
} from "./lib/backtesting.mjs";
import {
  sendNotification,
  getAllNotifications,
  getUnreadNotifications,
  markAsRead,
  markAllAsRead,
  clearAllNotifications,
  getNotificationPreferences,
  updateNotificationPreferences,
  sendTestNotification,
  sendDailySummary,
  getNotificationTypes
} from "./lib/notifications.mjs";
import { verifyWorldID } from "./lib/worldcoin.mjs";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

// Trust proxy (required for Render behind reverse proxy)
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: "256kb" }));
app.use(morgan(process.env.NODE_ENV==="production" ? "combined" : "dev"));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
initDatabase();

// Auto-restart automation if it was running before server restart
async function autoRestartAutomation() {
  try {
    const { getAutomationState } = await import('./lib/database.mjs');
    const wasActive = await getAutomationState('automation_active');
    const config = await getAutomationState('automation_config');

    if (wasActive && config) {
      console.log('🔄 Auto-restarting automation from previous session...');
      console.log(`   Symbols: ${config.symbols?.join(', ') || 'BTCUSDT'}`);
      console.log(`   Interval: ${config.interval || '1m'}`);

      // Wait 5 seconds for everything to initialize
      setTimeout(() => {
        const result = startAutomation(config);
        if (result.ok) {
          console.log('✅ Automation auto-restarted successfully!');
          console.log('   Your bot is now running 24/7 on Render');
          console.log('   Close your laptop - it will keep trading!\n');
        } else {
          console.error('❌ Failed to auto-restart automation:', result.error);
        }
      }, 5000);
    } else {
      console.log('ℹ️  Automation was not active before restart. Waiting for manual start.');
    }
  } catch (err) {
    console.error('Error checking automation state:', err.message);
  }
}

// Call auto-restart after database initializes
autoRestartAutomation();

// Simple file logger for audit trail
function audit(event, data){
  try {
    if (!fs.existsSync("./logs")) {
      fs.mkdirSync("./logs", { recursive: true });
    }
    fs.appendFileSync("./logs/audit.log", JSON.stringify({ts:Date.now(), event, ...data})+"\n");
  } catch (e) {
    console.warn("Failed to write audit log:", e.message);
  }
}

const limiter = rateLimit({ windowMs: 30_000, max: 60 });
app.use(limiter);

app.get("/health", (_req, res) => res.json({
  ok:true,
  env: process.env.NODE_ENV || "dev",
  version: "v2.1",
  automation: getAutomationStatus(),
  cdnPrices: isCdnPricesEnabled()
}));

// --- Schema ---
const SignalsReq = z.object({
  symbol: z.string().default("BTCUSD"),
  interval: z.enum(["1m","5m","15m","1h"]).default("1m"),
  short: z.number().int().min(2).max(200).default(12),
  long: z.number().int().min(3).max(400).default(26),
  features: z.array(z.enum(["sma","rsi","news"])).default(["sma"])
});

app.post("/signals", async (req, res) => {
  const parse = SignalsReq.safeParse(req.body || {});
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { symbol, interval, short, long } = parse.data;

  try {
    // Fetch candles from Kraken
    const candles = await krakenCandles({ symbol, interval, limit: 500 });

    const closes = candles.map(c => c.c);
    const { signal, a, b, lastIdx } = lastSmaSignal(closes, short, long);

    const explain = await explainWithClaude({
      symbol, interval, signal,
      context: { lastIdx, price: closes.at(-1) }
    });

    const payload = {
      symbol, interval, price: closes.at(-1),
      signal, short, long,
      crossingIndex: lastIdx,
      explain: explain || undefined,
      candles: candles
    };
    audit("signal", payload);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// --- EXECUTION (mock → live) ---
const ExecReq = z.object({
  symbol: z.string(),
  side: z.enum(["buy","sell"]),
  size_pct: z.number().min(0.01).max(1.0).default(0.75),
  mode: z.enum(["paper","live"]).default("paper"),
  balance_usd: z.number().positive().default(10000)
});

app.post("/execute", async (req, res) => {
  const p = ExecReq.safeParse(req.body || {});
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });

  const { symbol, side, size_pct, mode, balance_usd } = p.data;

  // calculate notional
  // fetch a quick price from Kraken
  try {
    const price = await getCurrentPrice(symbol);
    const check = preTradeChecks({ balanceUSD: balance_usd, price, minNotional: 10 });
    if (!check.ok) return res.status(422).json({ error: check.reason });

    const notional = balance_usd * size_pct; // Quote amount
    const auditBase = { symbol, side, price, notional, mode };

    if (mode==="paper"){
      audit("paper_order", auditBase);
      return res.json({ status:"accepted", mode, simulated:true, price, notional, quantity: notional/price });
    }

    // LIVE: requires KRAKEN keys
    try {
      const order = await krakenPlace({ symbol, side, quoteOrderQty: notional });
      audit("live_order", { ...auditBase, orderId: order.ordertxid?.[0] });
      res.json({ status:"accepted", mode, order });
    } catch (e) {
      audit("live_order_failed", { ...auditBase, error: String(e?.message || e) });
      res.status(502).json({ error: "exchange_error", detail: String(e?.message || e) });
    }
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// --- Webhook placeholder for exchange events (fills audit log) ---
app.post("/webhook/exchange", (req, res) => {
  // TODO: verify signature per exchange doc BEFORE trusting payload.
  audit("exchange_webhook", { body: req.body });
  res.json({ ok: true });
});

// --- AUTOMATION ENDPOINTS ---
const AutomationStartReq = z.object({
  symbols: z.array(z.string()).default(["BTCUSD"]),
  interval: z.enum(["1m","5m","15m","1h"]).default("1m"),
  checkInterval: z.number().int().positive().default(60000),
  autoTrade: z.boolean().default(true),
  balancePerSymbol: z.number().positive().default(28),
  sizePct: z.number().min(0.01).max(1).default(1.0)
});

app.post("/automation/start", (req, res) => {
  const parse = AutomationStartReq.safeParse(req.body || {});
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  const result = startAutomation(parse.data);
  audit("automation_started", parse.data);
  res.json(result);
});

app.post("/automation/stop", (req, res) => {
  const result = stopAutomation();
  audit("automation_stopped", {});
  res.json(result);
});

app.get("/automation/status", (req, res) => {
  res.json(getAutomationStatus());
});

app.post("/automation/restart", (req, res) => {
  const parse = AutomationStartReq.safeParse(req.body || {});
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  const result = restartAutomation(parse.data);
  audit("automation_restarted", parse.data);
  res.json(result);
});

// CDN Prices toggle
app.post("/automation/cdn-prices", (req, res) => {
  const { enabled } = req.body || {};
  setCdnPricesEnabled(enabled === true);
  audit("cdn_prices_toggled", { enabled });
  res.json({ ok: true, cdnPrices: isCdnPricesEnabled() });
});

// Trading Mode (Paper vs Live)
app.get("/automation/mode", (req, res) => {
  res.json({ ok: true, mode: getTradingMode() });
});

app.post("/automation/mode", (req, res) => {
  try {
    const { mode } = req.body || {};

    if (!mode || (mode !== 'paper' && mode !== 'live')) {
      return res.status(400).json({
        ok: false,
        error: 'Trading mode must be "paper" or "live"'
      });
    }

    setTradingMode(mode);
    audit("trading_mode_changed", { mode });

    res.json({
      ok: true,
      mode: getTradingMode(),
      message: `Trading mode set to ${mode.toUpperCase()}`
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Portfolio & Dashboard
app.get("/portfolio", async (req, res) => {
  try {
    // Try to fetch from Kraken first if API keys are configured
    console.log("DEBUG /portfolio: KEY exists:", !!process.env.KRAKEN_API_KEY, "SECRET exists:", !!process.env.KRAKEN_API_SECRET);
    if (process.env.KRAKEN_API_KEY && process.env.KRAKEN_API_SECRET) {
      const krakenResult = await getAccountBalance();
      console.log("DEBUG: Kraken result:", JSON.stringify(krakenResult));
      if (krakenResult.ok && krakenResult.balances) {
        audit("portfolio_fetched", { source: "kraken", assetCount: krakenResult.balances.length });
        res.json({
          source: "kraken",
          positions: krakenResult.balances,
          raw: krakenResult.raw,
          message: "Real-time balance from Kraken"
        });
        return;
      }
    }

    // Fall back to local database if Kraken is not available
    const portfolio = getPortfolio();
    const value = getPortfolioValue();
    res.json({
      source: "local",
      positions: portfolio,
      totalValue: value.totalValue,
      totalPnl: value.totalPnl,
      totalPnlPct: value.totalValue > 0 ? (value.totalPnl / value.totalValue) * 100 : 0,
      message: "Portfolio from local database (no API keys configured)"
    });
  } catch (e) {
    console.error("Portfolio fetch error:", e);
    // Fall back to local database on error
    const portfolio = getPortfolio();
    const value = getPortfolioValue();
    res.json({
      source: "local",
      positions: portfolio,
      totalValue: value.totalValue,
      totalPnl: value.totalPnl,
      totalPnlPct: value.totalValue > 0 ? (value.totalPnl / value.totalValue) * 100 : 0,
      error: e.message
    });
  }
});

app.get("/trades", (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 100;
  const trades = getAllTrades(limit);
  res.json({ trades, count: trades.length });
});

// Performance Analytics
app.get("/analytics", async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      symbol,
      strategy,
      initialCapital
    } = req.query;

    const options = {};
    if (startDate) options.startDate = parseInt(startDate);
    if (endDate) options.endDate = parseInt(endDate);
    if (symbol) options.symbol = symbol;
    if (strategy) options.strategy = strategy;
    if (initialCapital) options.initialCapital = parseFloat(initialCapital);

    const analytics = await getAnalyticsSummary(options);
    audit("analytics_fetched", { filters: options });
    res.json({ ok: true, ...analytics });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Risk Management - Get comprehensive risk summary
app.get("/risk/summary", async (req, res) => {
  try {
    const portfolioValue = req.query.portfolioValue
      ? parseFloat(req.query.portfolioValue)
      : await getPortfolioValue();

    const openTrades = getAllTrades().filter(t => t.status === 'open');

    const riskSummary = await getRiskSummary(openTrades, portfolioValue);
    audit("risk_summary_fetched", { portfolioValue });
    res.json({ ok: true, ...riskSummary });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Circuit Breaker - Get configuration
app.get("/risk/circuit-breaker", (req, res) => {
  try {
    const config = getCircuitBreakerConfig();
    res.json({ ok: true, ...config });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Circuit Breaker - Update configuration
app.post("/risk/circuit-breaker/config", (req, res) => {
  try {
    const { maxConsecutiveLosses, cooldownMinutes } = req.body;
    const config = updateCircuitBreakerConfig({ maxConsecutiveLosses, cooldownMinutes });
    audit("circuit_breaker_config_updated", config);
    res.json({ ok: true, ...config });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Circuit Breaker - Manual reset
app.post("/risk/circuit-breaker/reset", (req, res) => {
  try {
    const result = resetCircuitBreaker();
    audit("circuit_breaker_reset", {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Portfolio Limits - Get configuration
app.get("/risk/limits", (req, res) => {
  try {
    const limits = getPortfolioLimits();
    res.json({ ok: true, limits });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Portfolio Limits - Update configuration
app.post("/risk/limits", (req, res) => {
  try {
    const limits = updatePortfolioLimits(req.body);
    audit("portfolio_limits_updated", limits);
    res.json({ ok: true, limits });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Backtesting - Run backtest
app.post("/backtest/run", async (req, res) => {
  try {
    const config = {
      symbol: req.body.symbol || 'BTCUSD',
      strategy: req.body.strategy || 'momentum',
      startDate: req.body.startDate || Date.now() - (30 * 24 * 60 * 60 * 1000),
      endDate: req.body.endDate || Date.now(),
      initialCapital: req.body.initialCapital || 10000,
      positionSize: req.body.positionSize || 1000,
      feeRate: req.body.feeRate || 0.0026,
      slippage: req.body.slippage || 0.001,
      interval: req.body.interval || '1h'
    };

    // Validate config
    const validation = validateBacktestConfig(config);
    if (!validation.valid) {
      return res.status(400).json({ ok: false, errors: validation.errors });
    }

    const result = await runBacktest(config);
    audit("backtest_run", { strategy: config.strategy, trades: result.summary.totalTrades });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('Backtest error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Backtesting - Compare strategies
app.post("/backtest/compare", async (req, res) => {
  try {
    const config = {
      symbol: req.body.symbol || 'BTCUSD',
      startDate: req.body.startDate || Date.now() - (30 * 24 * 60 * 60 * 1000),
      endDate: req.body.endDate || Date.now(),
      initialCapital: req.body.initialCapital || 10000,
      positionSize: req.body.positionSize || 1000,
      feeRate: req.body.feeRate || 0.0026,
      slippage: req.body.slippage || 0.001,
      interval: req.body.interval || '1h'
    };

    const result = await compareStrategies(config);
    audit("backtest_compare", { strategies: result.comparison.length });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('Strategy comparison error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Backtesting - Quick backtest
app.post("/backtest/quick", async (req, res) => {
  try {
    const { symbol = 'BTCUSD', strategy = 'momentum' } = req.body || {};
    const result = await quickBacktest(symbol, strategy);
    audit("backtest_quick", { symbol, strategy });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('Quick backtest error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Backtesting - Get available strategies
app.get("/backtest/strategies", (req, res) => {
  try {
    const strategies = getAvailableStrategies();
    res.json({ ok: true, strategies });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Notifications - Get all notifications
app.get("/notifications", (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;
    const notifications = getAllNotifications(limit);
    res.json({ ok: true, notifications, count: notifications.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Notifications - Get unread notifications
app.get("/notifications/unread", (req, res) => {
  try {
    const notifications = getUnreadNotifications();
    res.json({ ok: true, notifications, count: notifications.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Notifications - Mark as read
app.post("/notifications/:id/read", (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = markAsRead(id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Notifications - Mark all as read
app.post("/notifications/read-all", (req, res) => {
  try {
    const result = markAllAsRead();
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Notifications - Clear all
app.post("/notifications/clear", (req, res) => {
  try {
    const result = clearAllNotifications();
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Notifications - Get preferences
app.get("/notifications/preferences", (req, res) => {
  try {
    const preferences = getNotificationPreferences();
    res.json({ ok: true, preferences });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Notifications - Update preferences
app.post("/notifications/preferences", (req, res) => {
  try {
    const result = updateNotificationPreferences(req.body);
    audit("notification_preferences_updated", result.preferences);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Notifications - Send test notification
app.post("/notifications/test", async (req, res) => {
  try {
    const result = await sendTestNotification();
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Notifications - Get available types
app.get("/notifications/types", (req, res) => {
  try {
    const types = getNotificationTypes();
    res.json({ ok: true, types });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Manual signal analysis (for automation)
app.post("/automation/analyze", async (req, res) => {
  const { symbol = "BTCUSDT", interval = "1m" } = req.body || {};

  try {
    const result = await analyzeAndSignal(symbol, interval, { useAi: true });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Day Trading Simulation
app.post("/simulation/day-trading", async (req, res) => {
  const { capital = 100, symbol = "BTCUSD", interval = "1m" } = req.body || {};

  try {
    // Import simulator
    const { simulateDayTrading, generateSimulationReport } = await import('./lib/day-trading-simulator.mjs');

    // Fetch full day of 1-minute candles (1440 candles = 24 hours)
    console.log(`📊 Fetching ${symbol} candles for day trading simulation...`);
    const candles = await krakenCandles({ symbol, interval, limit: 1440 });

    if (candles.length < 100) {
      return res.status(400).json({
        ok: false,
        error: `Not enough candles for simulation (got ${candles.length}, need 100+)`
      });
    }

    console.log(`✅ Fetched ${candles.length} candles`);
    console.log(`💰 Simulating with $${capital} CAD starting capital...`);

    // Run simulation
    const results = simulateDayTrading(candles, capital, {
      sizePct: 0.95,      // Use 95% of capital per trade
      feePercent: 0.1,    // Kraken taker fees
      slippagePercent: 0.05 // Realistic slippage
    });

    if (!results.ok) {
      return res.status(400).json(results);
    }

    // Generate readable report
    const report = generateSimulationReport(results);

    console.log(`✅ Simulation complete: ${results.totalTrades} trades, ${results.winRate.toFixed(1)}% win rate`);

    audit("day_trading_simulation", {
      capital,
      symbol,
      totalTrades: results.totalTrades,
      endingCapital: results.endingCapital,
      totalPnl: results.totalPnl
    });

    res.json({
      ok: true,
      results,
      report,
      summary: {
        startingCapital: results.startingCapital,
        endingCapital: results.endingCapital,
        totalPnl: results.totalPnl,
        totalPnlPercent: results.totalPnlPercent,
        totalTrades: results.totalTrades,
        winRate: results.winRate,
        profitable: results.totalPnl >= 0
      }
    });
  } catch (e) {
    console.error("Day trading simulation error:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Force Strategy Selection
app.post("/strategy/force", async (req, res) => {
  const { strategy } = req.body || {};

  try {
    const { setStrategy, enableAutoSwitch, STRATEGY_MANAGER_CONFIG } = await import('./lib/strategy-manager.mjs');

    // If strategy is null or "auto", enable auto-switching
    if (!strategy || strategy === "auto") {
      const result = enableAutoSwitch();
      audit("strategy_auto_enabled", {});
      return res.json(result);
    }

    // Validate strategy
    const allowedStrategies = STRATEGY_MANAGER_CONFIG.allowedStrategies;
    if (!allowedStrategies.includes(strategy)) {
      return res.status(400).json({
        ok: false,
        error: `Invalid strategy. Allowed: ${allowedStrategies.join(', ')}`
      });
    }

    // Force strategy
    const result = setStrategy(strategy);
    audit("strategy_forced", { strategy });

    console.log(`🎯 Strategy manually set to: ${strategy}`);
    console.log(`   Auto-switching disabled`);

    res.json(result);
  } catch (e) {
    console.error("Force strategy error:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Get Strategy Status
app.get("/strategy/status", async (req, res) => {
  try {
    const { getStrategyStatus } = await import('./lib/strategy-manager.mjs');
    const status = getStrategyStatus();
    res.json({ ok: true, ...status });
  } catch (e) {
    console.error("Strategy status error:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Worldcoin verification endpoint
app.post("/verify/worldcoin", async (req, res) => {
  try {
    const result = await verifyWorldID(req.body);
    if (result.ok && result.verified) {
      audit("worldcoin_verified", { user: result.user });
      res.json(result);
    } else {
      res.status(401).json(result);
    }
  } catch (e) {
    console.error("Worldcoin verification error:", e);
    res.status(500).json({ ok: false, verified: false, error: String(e) });
  }
});

// WebSocket endpoint for real-time price updates
const wsClients = new Map(); // Map of symbol -> Set of clients

wss.on('connection', (ws) => {
  let clientSymbol = null;
  let updateInterval = null;

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'subscribe') {
        const { symbol, interval = '1m' } = msg;
        clientSymbol = symbol;

        // Stop previous interval if any
        if (updateInterval) clearInterval(updateInterval);

        // Send initial data
        try {
          const candles = await krakenCandles({ symbol, interval, limit: 500 });
          const closes = candles.map(c => c.c);
          const { signal } = lastSmaSignal(closes, 12, 26);

          ws.send(JSON.stringify({
            type: 'initial',
            symbol,
            interval,
            price: closes.at(-1),
            signal,
            candles
          }));
        } catch (e) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to fetch initial data: ' + e.message
          }));
        }

        // Set up periodic updates (every 10 seconds)
        updateInterval = setInterval(async () => {
          try {
            const candles = await krakenCandles({ symbol, interval, limit: 500 });
            const closes = candles.map(c => c.c);
            const { signal } = lastSmaSignal(closes, 12, 26);

            ws.send(JSON.stringify({
              type: 'update',
              symbol,
              price: closes.at(-1),
              signal,
              candles,
              timestamp: Date.now()
            }));
          } catch (e) {
            console.error('WS update error:', e);
          }
        }, 10000);
      }
    } catch (e) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });

  ws.on('close', () => {
    if (updateInterval) clearInterval(updateInterval);
    console.log('WS client disconnected');
  });
});

// SPA fallback: serve index.html for all unmatched routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 8888;
httpServer.listen(port, () => {
  console.log(`TrustTrade backend listening on :${port}`);
  console.log("WebSocket server ready at ws://localhost:" + port);
  console.log("Automation endpoints available:");
  console.log("  POST   /automation/start        - Start automated trading");
  console.log("  POST   /automation/stop         - Stop automated trading");
  console.log("  GET    /automation/status       - Check automation status");
  console.log("  POST   /automation/cdn-prices   - Toggle CDN prices");
  console.log("  GET    /portfolio               - View portfolio");
  console.log("  GET    /trades                  - View trade history");
  console.log("Strategy & Simulation endpoints:");
  console.log("  POST   /strategy/force          - Force specific strategy");
  console.log("  GET    /strategy/status         - Get current strategy");
  console.log("  POST   /simulation/day-trading  - Simulate day trading with $100 CAD");
});

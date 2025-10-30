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
  restartAutomation
} from "./lib/automation.mjs";
import { verifyWorldID } from "./lib/worldcoin.mjs";
import fs from "fs";

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

app.use(cors());
app.use(express.json({ limit: "256kb" }));
app.use(morgan(process.env.NODE_ENV==="production" ? "combined" : "dev"));

// Initialize database
initDatabase();

// Simple file logger for audit trail
function audit(event, data){
  fs.appendFileSync("./logs/audit.log", JSON.stringify({ts:Date.now(), event, ...data})+"\n");
}

const limiter = rateLimit({ windowMs: 30_000, max: 60 });
app.use(limiter);

app.get("/health", (_req, res) => res.json({
  ok:true,
  env: process.env.NODE_ENV || "dev",
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

const port = process.env.PORT || 8888;
httpServer.listen(port, () => {
  console.log(`TrustTrade backend listening on :${port}`);
  console.log("WebSocket server ready at ws://localhost:" + port);
  console.log("Automation endpoints available:");
  console.log("  POST   /automation/start     - Start automated trading");
  console.log("  POST   /automation/stop      - Stop automated trading");
  console.log("  GET    /automation/status    - Check automation status");
  console.log("  POST   /automation/cdn-prices- Toggle CDN prices");
  console.log("  GET    /portfolio            - View portfolio");
  console.log("  GET    /trades               - View trade history");
});

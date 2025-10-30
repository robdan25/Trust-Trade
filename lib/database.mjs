import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname, '../data');
const dbPath = path.join(dbDir, 'trusttrade.db');

let db = null;

export function initDatabase() {
  // Ensure data directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      notional REAL NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      closed_at INTEGER,
      closed_price REAL,
      pnl REAL,
      pnl_pct REAL
    );

    CREATE TABLE IF NOT EXISTS portfolio (
      symbol TEXT PRIMARY KEY,
      quantity REAL NOT NULL,
      avg_price REAL NOT NULL,
      current_price REAL NOT NULL,
      pnl REAL NOT NULL,
      pnl_pct REAL NOT NULL,
      last_updated INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      interval TEXT NOT NULL,
      signal TEXT NOT NULL,
      price REAL NOT NULL,
      short_period INTEGER NOT NULL,
      long_period INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      confidence REAL,
      risk_note TEXT
    );

    CREATE TABLE IF NOT EXISTS automation_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
    CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
    CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
    CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON signals(timestamp);
  `);

  return db;
}

export function getDatabase() {
  if (!db) {
    initDatabase();
  }
  return db;
}

// Trade operations
export function saveTrade(trade) {
  const stmt = db.prepare(`
    INSERT INTO trades (id, symbol, side, price, quantity, notional, mode, status, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    trade.id,
    trade.symbol,
    trade.side,
    trade.price,
    trade.quantity,
    trade.notional,
    trade.mode,
    trade.status,
    trade.timestamp
  );
}

export function getOpenTrades(symbol) {
  const stmt = db.prepare(`
    SELECT * FROM trades WHERE symbol = ? AND status = 'open' ORDER BY timestamp DESC
  `);
  return stmt.all(symbol);
}

export function getAllTrades(limit = 100) {
  const stmt = db.prepare(`
    SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?
  `);
  return stmt.all(limit);
}

export function closeTrade(tradeId, closePrice, pnl, pnlPct) {
  const stmt = db.prepare(`
    UPDATE trades SET status = 'closed', closed_at = ?, closed_price = ?, pnl = ?, pnl_pct = ?
    WHERE id = ?
  `);
  return stmt.run(Date.now(), closePrice, pnl, pnlPct, tradeId);
}

// Portfolio operations
export function updatePortfolio(symbol, quantity, avgPrice, currentPrice) {
  const pnl = (currentPrice - avgPrice) * quantity;
  const pnlPct = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;

  const stmt = db.prepare(`
    INSERT INTO portfolio (symbol, quantity, avg_price, current_price, pnl, pnl_pct, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      quantity = ?,
      avg_price = ?,
      current_price = ?,
      pnl = ?,
      pnl_pct = ?,
      last_updated = ?
  `);

  return stmt.run(
    symbol, quantity, avgPrice, currentPrice, pnl, pnlPct, Date.now(),
    quantity, avgPrice, currentPrice, pnl, pnlPct, Date.now()
  );
}

export function getPortfolio() {
  const stmt = db.prepare('SELECT * FROM portfolio WHERE quantity > 0');
  return stmt.all();
}

export function getPortfolioValue() {
  const stmt = db.prepare('SELECT SUM(quantity * current_price) as total_value, SUM(pnl) as total_pnl FROM portfolio WHERE quantity > 0');
  const result = stmt.get();
  return {
    totalValue: result?.total_value || 0,
    totalPnl: result?.total_pnl || 0
  };
}

// Signal operations
export function saveSignal(signal) {
  const stmt = db.prepare(`
    INSERT INTO signals (id, symbol, interval, signal, price, short_period, long_period, timestamp, confidence, risk_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return stmt.run(
    signal.id,
    signal.symbol,
    signal.interval,
    signal.signal,
    signal.price,
    signal.shortPeriod,
    signal.longPeriod,
    signal.timestamp,
    signal.confidence || null,
    signal.riskNote || null
  );
}

export function getLatestSignal(symbol) {
  const stmt = db.prepare(`
    SELECT * FROM signals WHERE symbol = ? ORDER BY timestamp DESC LIMIT 1
  `);
  return stmt.get(symbol);
}

// Automation state
export function setAutomationState(key, value) {
  const stmt = db.prepare(`
    INSERT INTO automation_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
  `);

  const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
  return stmt.run(key, valueStr, Date.now(), valueStr, Date.now());
}

export function getAutomationState(key) {
  const stmt = db.prepare('SELECT value FROM automation_state WHERE key = ?');
  const result = stmt.get(key);
  return result ? JSON.parse(result.value) : null;
}

export function getAllAutomationState() {
  const stmt = db.prepare('SELECT key, value FROM automation_state');
  const results = stmt.all();
  return Object.fromEntries(results.map(r => [r.key, JSON.parse(r.value)]));
}

export default {
  initDatabase,
  getDatabase,
  saveTrade,
  getOpenTrades,
  getAllTrades,
  closeTrade,
  updatePortfolio,
  getPortfolio,
  getPortfolioValue,
  saveSignal,
  getLatestSignal,
  setAutomationState,
  getAutomationState,
  getAllAutomationState
};

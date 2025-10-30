import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname, '../data');
const dbPath = path.join(dbDir, 'auth.db');

let db = null;

export function initAuthDB() {
  // Ensure data directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      is_active BOOLEAN DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used INTEGER,
      is_active BOOLEAN DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS trade_confirmations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      confirmation_code TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      amount REAL NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      is_confirmed BOOLEAN DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS trading_limits (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      max_daily_trades INTEGER DEFAULT 100,
      max_trade_size REAL DEFAULT 5000,
      max_daily_loss REAL DEFAULT -1000,
      min_profit_threshold REAL DEFAULT 0.5,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_confirmations_user_id ON trade_confirmations(user_id);
    CREATE INDEX IF NOT EXISTS idx_limits_user_id ON trading_limits(user_id);
  `);
}

// ===== USER MANAGEMENT =====
export function createUser(email, passwordHash) {
  const userId = uuidv4();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO users (id, email, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(userId, email, passwordHash, now, now);

  // Create default trading limits
  createTradingLimits(userId);

  return { id: userId, email };
}

export function findUserByEmail(email) {
  const stmt = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1');
  return stmt.get(email);
}

export function getUserById(userId) {
  const stmt = db.prepare('SELECT id, email, created_at FROM users WHERE id = ? AND is_active = 1');
  return stmt.get(userId);
}

// ===== TRADING LIMITS =====
export function createTradingLimits(userId) {
  const limitId = uuidv4();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO trading_limits (id, user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(limitId, userId, now, now);
}

export function getTradingLimits(userId) {
  const stmt = db.prepare('SELECT * FROM trading_limits WHERE user_id = ?');
  return stmt.get(userId);
}

export function updateTradingLimits(userId, limits) {
  const stmt = db.prepare(`
    UPDATE trading_limits
    SET max_daily_trades = ?, max_trade_size = ?, max_daily_loss = ?, min_profit_threshold = ?, updated_at = ?
    WHERE user_id = ?
  `);

  stmt.run(
    limits.max_daily_trades || 100,
    limits.max_trade_size || 5000,
    limits.max_daily_loss || -1000,
    limits.min_profit_threshold || 0.5,
    Date.now(),
    userId
  );
}

// ===== TRADE CONFIRMATIONS =====
export function createTradeConfirmation(userId, symbol, side, amount, code) {
  const confirmId = uuidv4();
  const now = Date.now();
  const expiresAt = now + (5 * 60 * 1000); // 5 minute expiry

  const stmt = db.prepare(`
    INSERT INTO trade_confirmations (id, user_id, confirmation_code, symbol, side, amount, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(confirmId, userId, code, symbol, side, amount, now, expiresAt);
  return confirmId;
}

export function verifyTradeConfirmation(confirmId, code) {
  const stmt = db.prepare(`
    SELECT * FROM trade_confirmations
    WHERE id = ? AND confirmation_code = ? AND expires_at > ? AND is_confirmed = 0
  `);

  const confirmation = stmt.get(confirmId, code, Date.now());
  if (!confirmation) return null;

  // Mark as confirmed
  const updateStmt = db.prepare('UPDATE trade_confirmations SET is_confirmed = 1 WHERE id = ?');
  updateStmt.run(confirmId);

  return confirmation;
}

// ===== API KEYS =====
export function createApiKey(userId, name, keyHash) {
  const keyId = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO api_keys (id, user_id, key_hash, name, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(keyId, userId, keyHash, name, Date.now());
  return keyId;
}

export function getApiKeysByUser(userId) {
  const stmt = db.prepare(`
    SELECT id, name, created_at, last_used, is_active FROM api_keys
    WHERE user_id = ? AND is_active = 1
  `);

  return stmt.all(userId);
}

export function verifyApiKey(keyHash) {
  const stmt = db.prepare(`
    SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1
  `);

  const key = stmt.get(keyHash);
  if (key) {
    // Update last used
    const updateStmt = db.prepare('UPDATE api_keys SET last_used = ? WHERE id = ?');
    updateStmt.run(Date.now(), key.id);
  }

  return key;
}

export default {
  initAuthDB,
  createUser,
  findUserByEmail,
  getUserById,
  createTradingLimits,
  getTradingLimits,
  updateTradingLimits,
  createTradeConfirmation,
  verifyTradeConfirmation,
  createApiKey,
  getApiKeysByUser,
  verifyApiKey
};

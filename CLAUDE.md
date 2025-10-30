# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

**TrustTrade** is a full-stack AI-powered cryptocurrency trading platform with real-time market analysis, intelligent trade execution, and enterprise-grade security.

**Key Characteristics**:
- Backend: Node.js/Express, real-time WebSocket support
- Frontend: React 19 with Vite, Chart.js for visualization
- Exchange: Kraken API (primary), support for Binance/Coinbase
- Database: SQLite (dev), PostgreSQL (production-ready)
- Security: JWT auth, webhook verification, trading limits, structured logging

---

## Architecture Overview

### Backend Architecture

```
server.mjs (Express entry point)
├── Core Features
│   ├── /signals       → SMA crossover analysis + profit opportunity assessment
│   ├── /execute       → Paper/live trade execution with risk validation
│   ├── /automation/*  → Automated trading with intelligent profit detection
│   ├── /portfolio     → Real-time balance from Kraken or local DB
│   ├── /trades        → Trade history and P&L tracking
│   └── /webhook/*     → Exchange webhook handling (HMAC verified)
│
├── Technical Architecture
│   ├── WebSocket Server (ws)
│   │   └── Real-time price updates with HTTP fallback
│   ├── Rate Limiting (express-rate-limit)
│   │   └── 60 requests / 30 seconds per IP
│   └── Database Layer
│       ├── trusttrade.db        (trades, portfolio, signals)
│       └── auth.db              (users, API keys, trading limits)
│
└── Security Layer (Phase 1 Complete)
    ├── auth.mjs / authdb.mjs    (JWT tokens, bcrypt passwords)
    ├── webhook-security.mjs     (HMAC-SHA256 verification)
    ├── risk-manager.mjs         (Daily loss limits, position caps)
    ├── logger.mjs               (Structured logging to files)
    └── Database with WAL mode   (concurrent write safety)
```

### Core Data Flow

1. **Signal Generation**: Fetch 500 candles → Calculate SMA(12,26) + momentum → Detect crossover
2. **Profit Assessment**: Momentum + SMA + price positioning → Expected profit % → Risk/reward ratio
3. **Trade Validation**: Check user limits (daily loss, position size, count) → Execute or reject
4. **Execution**: Paper mode (simulation) or Live mode (real orders via Kraken)
5. **Portfolio Update**: Track open/closed positions, calculate P&L

### Frontend Architecture

```
App.jsx (React 19)
├── Dashboard Tab
│   └── Real-time chart with coin selector buttons
├── Signals Tab
│   ├── SMA signal generation
│   ├── Profit opportunity display
│   └── AI explanation (optional)
├── Automation Tab
│   ├── Start/stop automation
│   ├── Configure trading limits
│   └── Monitor trading activity
├── Portfolio Tab
│   └── Balance and P&L display
└── Trade History Tab
    └── Past trades and audit trail

Supporting Components:
├── PriceChart.jsx               (Chart.js wrapper)
├── NavIcons.jsx                 (SVG line-based icons)
├── WorldcoinButton.jsx          (ID Kit integration)
└── WorldcoinContext.jsx         (Global state)
```

### Key Technology Decisions

1. **SQLite with WAL Mode** (Development):
   - Simplifies local development
   - `db.pragma('journal_mode = WAL')` allows concurrent writes
   - Plan: Migrate to PostgreSQL for production

2. **WebSocket + HTTP Fallback**:
   - Primary: WebSocket for real-time (<1s latency)
   - Fallback: HTTP polling (every 10-60s configurable)
   - Auto-detection prevents connection issues

3. **SMA-Based Strategy**:
   - Fast SMA (period 12) crosses Slow SMA (period 26)
   - Momentum filter (>1.5% required for trades)
   - Volatility-adjusted position sizing

4. **JWT Authentication**:
   - 7-day token expiry
   - HMAC-SHA256 signature
   - All protected endpoints require `Authorization: Bearer <token>` header

5. **Webhook HMAC Verification**:
   - All Kraken webhooks verified with X-Signature header
   - Timing-safe comparison prevents timing attacks
   - Prevents order tampering/injection attacks

---

## Development Commands

### Backend

```bash
cd trusttrade-backend

# Development with auto-reload
npm run dev
# Runs: node --watch server.mjs
# Restarts on file changes

# Production start
npm start
# Runs: node server.mjs

# Run smoke tests
npm test
# Runs: node tests/smoke.mjs

# Check dependencies for vulnerabilities
npm audit
```

**Environment Setup**:
```bash
# Copy template
cp .env.example .env

# Generate secrets (CRITICAL)
openssl rand -base64 64  # → JWT_SECRET
openssl rand -base64 64  # → WEBHOOK_SECRET

# Edit .env with Kraken API keys
nano .env
```

### Frontend

```bash
cd trusttrade-frontend

# Development with Vite HMR
npm run dev
# Runs: vite
# Starts on http://localhost:5173 with hot reload

# Production build
npm build
# Creates optimized dist/ folder

# Lint with ESLint
npm lint
# Runs: eslint .

# Preview production build
npm preview
```

### Running Full Stack

```bash
# Terminal 1: Backend (from trusttrade-backend/)
npm run dev
# Listens on http://localhost:9999

# Terminal 2: Frontend (from trusttrade-frontend/)
npm run dev
# Listens on http://localhost:5173
# API configured to http://localhost:9999

# Open http://localhost:5173 in browser
```

---

## Code Patterns & Conventions

### Endpoint Pattern (Backend)

All REST endpoints follow this pattern:

```javascript
import { z } from 'zod';
import { authMiddleware } from './lib/auth.mjs';

// 1. Define schema
const TradeSchema = z.object({
  symbol: z.string(),
  side: z.enum(['buy', 'sell']),
  amount: z.number().positive()
});

// 2. Add route with auth
app.post('/api/protected-endpoint', authMiddleware, async (req, res) => {
  // 3. Validate input
  const parsed = TradeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  // 4. Execute business logic
  try {
    const result = await businessLogic(parsed.data);
    logger.info('Operation succeeded', { result });
    res.json({ ok: true, data: result });
  } catch (e) {
    logger.error('Operation failed', { error: e.message });
    res.status(500).json({ ok: false, error: String(e) });
  }
});
```

### Trading Flow Pattern

```javascript
import { validateTradeAgainstLimits } from './lib/risk-manager.mjs';
import { getTradingLimits } from './lib/authdb.mjs';

async function executeTrade(userId, symbol, side, amount) {
  // 1. Check limits
  const userLimits = getTradingLimits(userId);
  const validation = validateTradeAgainstLimits(userId, amount);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  // 2. Get price
  const price = await getCurrentPrice(symbol);

  // 3. Calculate position
  const quantity = amount / price;

  // 4. Log audit trail
  logger.trading('Trade executed', { symbol, side, amount, price });

  // 5. Return result
  return { symbol, side, price, quantity, amount };
}
```

### Indicator Calculation Pattern

Indicators in `indicators.mjs` follow functional pattern:

```javascript
// Pure function - no side effects
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

// Returns structured assessment
export function assessProfitOpportunity(closes) {
  return {
    profitOpportunity: boolean,
    reason: string,
    expectedProfit: string,
    riskReward: string,
    momentum: string,
    volatility: string,
    smaDiff: string
  };
}
```

### Logger Usage Pattern

```javascript
import { createLogger } from './lib/logger.mjs';
const logger = createLogger('MODULE_NAME');

// Different severity levels
logger.error('Critical issue', { error: e.message });          // error.log
logger.warn('Warning', { data });                             // warn.log
logger.info('Normal operation', { data });                    // info.log
logger.debug('Debug info', { data });                         // debug.log

// Specialized loggers
logger.trading('BUY order executed', { symbol, amount });
logger.security('Unauthorized access attempt', { ip });
logger.automation('Automation triggered', { signal });
logger.http('GET /api/endpoint', { status: 200, duration_ms: 45 });
```

---

## Important Files & Their Purposes

### Core Backend Libraries (`lib/`)

| File | Purpose | Key Exports |
|------|---------|------------|
| `auth.mjs` | JWT/password mgmt | `registerUser()`, `loginUser()`, `authMiddleware()` |
| `authdb.mjs` | User database | `createUser()`, `getTradingLimits()`, `createTradeConfirmation()` |
| `automation.mjs` | Trading automation | `startAutomation()`, `analyzeAndSignal()`, `executeTrade()` |
| `indicators.mjs` | Technical analysis | `sma()`, `momentum()`, `assessProfitOpportunity()` |
| `risk-manager.mjs` | Risk limits | `validateTradeAgainstLimits()`, `calculateDailyLoss()` |
| `database.mjs` | Trade database | `saveTrade()`, `getPortfolio()`, `getAllTrades()` |
| `logger.mjs` | Structured logging | `createLogger()`, `logger.info()`, `logger.error()` |
| `webhook-security.mjs` | Webhook verification | `verifyWebhookSignature()`, `webhookVerificationMiddleware()` |
| `risk.mjs` | Legacy risk utils | `preTradeChecks()`, `positionSizeUSD()` |
| `claude.mjs` | Claude AI integration | `explainWithClaude()` |

### Configuration Files

| File | Purpose |
|------|---------|
| `.env` | **KEEP SECRET** - API keys, secrets, DB credentials |
| `.env.example` | Template for developers (safe to commit) |
| `package.json` | Dependencies and npm scripts |

### Documentation

| File | Purpose |
|------|---------|
| `SECURITY.md` | Full security implementation details (500+ lines) |
| `SECURITY_QUICK_START.md` | Quick security setup guide |
| `README.md` | Project overview and features |
| `README_LATEST.md` | Latest updates and changes |

---

## Common Development Tasks

### Adding a New Endpoint

1. **Define schema** using Zod in endpoint handler
2. **Require authMiddleware** for any financial operations
3. **Check input validation** with safeParse()
4. **Log operations** with structured logger
5. **Return JSON** with ok: true/false status
6. **Test with curl** including Authorization header

### Debugging Automation

```bash
# 1. Check logs
tail -f logs/info.log | grep AUTOMATION
tail -f logs/error.log

# 2. Check automation status
curl -H "Authorization: Bearer <token>" \
  http://localhost:9999/automation/status

# 3. Check trading limits
curl -H "Authorization: Bearer <token>" \
  http://localhost:9999/user/limits

# 4. Monitor real-time signals
curl -X POST http://localhost:9999/automation/analyze \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSD","interval":"1m"}'
```

### Testing Signal Logic

```javascript
// In Node REPL
import { lastSmaSignal, assessProfitOpportunity } from './lib/indicators.mjs';

const closes = [100, 101, 102, 103, 104, 105];
const { signal } = lastSmaSignal(closes, 2, 3);
console.log(signal); // 'buy', 'sell', or 'hold'

const assessment = assessProfitOpportunity(closes);
console.log(assessment.profitOpportunity);
console.log(assessment.reason);
```

### Managing Trading Limits

```javascript
import { updateTradingLimits, getTradingLimits } from './lib/authdb.mjs';

// Get current limits
const limits = getTradingLimits(userId);

// Update limits
updateTradingLimits(userId, {
  max_daily_trades: 50,
  max_trade_size: 3000,
  max_daily_loss: -500,
  min_profit_threshold: 1.0
});
```

---

## Critical Security Notes

### Never Commit Secrets

```bash
# WRONG - API keys in git
git add .env
git commit -m "add keys"

# RIGHT - only template
git add .env.example
echo ".env" >> .gitignore
```

### Generating Secrets

```bash
# Generate both required secrets
JWT_SECRET=$(openssl rand -base64 64)
WEBHOOK_SECRET=$(openssl rand -base64 64)

# Add to .env (keep secure)
echo "JWT_SECRET=$JWT_SECRET" >> .env
echo "WEBHOOK_SECRET=$WEBHOOK_SECRET" >> .env
```

### Authentication Usage

```javascript
// Protected endpoints require token
app.post('/api/protected', authMiddleware, (req, res) => {
  // req.user contains { userId, email }
  const userId = req.user.userId;
  // ... continue
});

// Client usage
fetch('http://localhost:9999/api/protected', {
  headers: {
    'Authorization': 'Bearer ' + jwtToken
  }
});
```

### Webhook Signature Verification

```javascript
import { webhookVerificationMiddleware } from './lib/webhook-security.mjs';

// All webhooks must be verified
app.post('/webhook/exchange', webhookVerificationMiddleware, (req, res) => {
  // req.webhook contains { id, verified: true }
  // Safe to process webhook data
});
```

---

## Environment Variables Reference

### Required for Development
```bash
PORT=9999                           # Server port
NODE_ENV=development                # dev/staging/production
LOG_LEVEL=info                      # info/debug/warn/error

JWT_SECRET=<64-char-random>        # Generate with openssl rand -base64 64
WEBHOOK_SECRET=<64-char-random>    # Same as JWT_SECRET
```

### Exchange Integration
```bash
KRAKEN_API_KEY=<your-key>          # Read-only or trading-only keys
KRAKEN_API_SECRET=<your-secret>    # Keep secure
```

### Optional Services
```bash
ANTHROPIC_API_KEY=<claude-key>     # For AI explainability
WORLDCOIN_APP_ID=<wld-app-id>      # For Worldcoin ID verification
```

---

## Troubleshooting Guide

### "Cannot GET /ws" or WebSocket connection fails

**Cause**: Trying to connect to HTTP endpoint with WebSocket protocol

**Fix**:
```javascript
// Wrong
const ws = new WebSocket('http://localhost:9999/ws');

// Right
const ws = new WebSocket('ws://localhost:9999/ws');
```

### "401 Unauthorized" on protected endpoints

**Cause**: Missing or invalid JWT token

**Fix**:
```bash
# 1. Get token from login/register
POST /auth/login
{
  "email": "user@example.com",
  "password": "password"
}
# Response: { "token": "eyJ..." }

# 2. Use in Authorization header
Authorization: Bearer eyJ...
```

### Webhook signature verification fails

**Cause**: WEBHOOK_SECRET mismatch or raw body tampering

**Fix**:
```bash
# 1. Verify WEBHOOK_SECRET matches Kraken config
cat .env | grep WEBHOOK_SECRET

# 2. Ensure raw body is captured (not JSON-parsed)
# webhook-security.mjs handles this automatically
```

### Automation not trading despite BUY signal

**Cause**: Profit opportunity check or trading limits

**Fix**:
```bash
# Check logs
tail -f logs/info.log | grep AUTOMATION

# Typical reasons:
# - Momentum < 1.5% (insufficient signal strength)
# - Risk/Reward < 1.5:1 (insufficient profit potential)
# - Daily loss limit exceeded (circuit breaker triggered)
# - Daily trade count exceeded
```

### Database locked error

**Cause**: Multiple writers without WAL mode

**Fix**: Already fixed with `db.pragma('journal_mode = WAL')`
- Allows concurrent writes
- Enables read during write
- Production: Use PostgreSQL instead

---

## Performance Optimization Notes

### WebSocket vs HTTP Polling

- **WebSocket**: <1s latency, real-time updates, uses persistent connection
- **HTTP Polling**: 10-60s latency (configurable), works through proxies

**Frontend automatically**:
1. Tries WebSocket first
2. On failure, falls back to HTTP polling
3. Logs connection type to console

### SMA Calculation Optimization

Current implementation: O(n) for single SMA, O(n²) worst case for assessment

**For large candle sets (500+)**:
- Already optimized with sliding window
- Consider caching SMA values if calculating frequently

### Database Performance

**SQLite (Development)**:
- WAL mode handles concurrent access
- Indexes on: users(email), api_keys(user_id), trades(symbol)

**PostgreSQL (Production)**:
- Use connection pooling (max 20 connections)
- Add indexes for: user_id, symbol, timestamp ranges

---

## Testing Strategy

### Manual Testing Endpoints

```bash
# 1. Register user
curl -X POST http://localhost:9999/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@local","password":"Test123!!"}'

# 2. Get health
curl http://localhost:9999/health

# 3. Generate signal (no auth required)
curl -X POST http://localhost:9999/signals \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSD","interval":"1m"}'

# 4. Test with auth
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:9999/portfolio
```

### Smoke Tests

```bash
npm test
# Runs: node tests/smoke.mjs
```

---

## Deployment Considerations

### Phase 1 Complete (Security) ✅
- Authentication required
- Webhook signatures verified
- Trading limits enforced
- Audit logging enabled

### Phase 2 Needed (Data)
- Migrate to PostgreSQL
- Implement automated backups
- Add encryption at rest

### Phase 3 Needed (Monitoring)
- Sentry integration
- Metrics/dashboard
- Alert system

### Pre-Production Checklist

- [ ] Generate new JWT_SECRET and WEBHOOK_SECRET
- [ ] Remove all Kraken test keys from version control
- [ ] Enable HTTPS/TLS
- [ ] Configure database backups
- [ ] Set up monitoring
- [ ] Test disaster recovery
- [ ] Security audit completed
- [ ] Rate limits tuned
- [ ] CORS whitelist configured (not wildcard)

---

## Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| express | ^4.19.2 | HTTP server |
| jsonwebtoken | ^9.0.2 | JWT authentication |
| bcryptjs | ^3.0.2 | Password hashing |
| better-sqlite3 | ^12.4.1 | SQLite driver |
| ws | ^8.18.3 | WebSocket server |
| zod | ^3.23.8 | Input validation |
| kraken-api | ^1.0.2 | Kraken exchange |
| express-rate-limit | ^7.4.0 | Rate limiting |
| react | ^19.1.1 | Frontend UI (frontend) |
| vite | ^7.1.7 | Build tool (frontend) |
| chart.js | ^4.5.1 | Price charting (frontend) |

---

## Quick Reference

### Start Development
```bash
# Terminal 1: Backend
cd trusttrade-backend
npm run dev

# Terminal 2: Frontend
cd trusttrade-frontend
npm run dev

# Open http://localhost:5173
```

### Check Health
```bash
curl http://localhost:9999/health
```

### View Logs
```bash
tail -f logs/info.log
tail -f logs/error.log
tail -f logs/warn.log
```

### Generate Signal
```bash
curl -X POST http://localhost:9999/signals \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSD","interval":"1m"}'
```

### Start Automation
```bash
curl -H "Authorization: Bearer <TOKEN>" \
  -X POST http://localhost:9999/automation/start \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": ["BTCUSD"],
    "interval": "1m",
    "autoTrade": true
  }'
```

---

**Last Updated**: October 27, 2025
**Current Status**: Phase 1 (Security) Complete ✅

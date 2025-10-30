# TrustTrade - AI-Powered Crypto Trading Platform

A full-stack crypto trading application featuring SMA crossover signals, Claude AI explainability, and multi-exchange support.

## Project Structure

```
trust-trade/
├── trusttrade-backend/          # Node.js Express server
│   ├── server.mjs               # Main server entry point
│   ├── adapters/                # Exchange integrations
│   │   ├── binance.mjs          # Binance API adapter
│   │   └── coinbase.mjs         # Coinbase API adapter
│   ├── lib/                     # Core libraries
│   │   ├── indicators.mjs       # Technical indicators (SMA)
│   │   ├── risk.mjs             # Risk management utilities
│   │   └── claude.mjs           # Claude AI integration
│   ├── logs/                    # Audit logs
│   ├── tests/                   # Testing
│   │   └── smoke.mjs            # Smoke tests
│   ├── Dockerfile               # Docker containerization
│   ├── package.json
│   └── .env.example
├── trusttrade-frontend/         # React + Vite app
│   ├── src/
│   │   ├── App.jsx              # Main trading UI
│   │   └── App.css              # Styling
│   ├── package.json
│   └── index.html
└── README.md                    # This file
```

## Features

### Backend
- **SMA Crossover Strategy**: 12/26 period moving averages for trend detection
- **Multi-Exchange Support**: Binance and Coinbase price data
- **Claude AI Integration**: Optional explainability for signals (requires API key)
- **Paper & Live Trading Modes**: Safe testing and production execution
- **Risk Management**: Position sizing, pre-trade validation
- **Audit Logging**: Full compliance trail of all operations
- **Rate Limiting**: 60 requests per 30 seconds
- **CORS Support**: Cross-origin requests for frontend

### Frontend
- **Signal Generator**: Real-time SMA crossover signals
- **Trade Executor**: Paper and live order submission
- **Health Monitoring**: Backend connectivity status
- **AI Explanations**: Claude-powered trade insights
- **Documentation**: Built-in API reference
- **Responsive Design**: Mobile-friendly interface

## Quick Start

### Prerequisites
- Node.js 20+ (or 22+)
- npm 10+
- Optional: Docker for containerization
- Optional: Anthropic API key for AI features

### Backend Setup

```bash
cd trusttrade-backend
cp .env.example .env
# Edit .env with your API keys (optional for paper trading)
npm install
npm run dev
```

The backend will start on `http://localhost:8787`

### Frontend Setup

```bash
cd trusttrade-frontend
npm install
npm run dev
```

The frontend will start on `http://localhost:5173`

### Running with Docker

```bash
cd trusttrade-backend
docker build -t trusttrade-backend .
docker run -p 8787:8787 --env-file .env trusttrade-backend
```

## Configuration

### Environment Variables (.env)

```env
# Server
PORT=8787
NODE_ENV=development
LOG_LEVEL=info

# Claude AI (optional)
ANTHROPIC_API_KEY=sk-ant-...

# Binance (use testnet for testing)
BINANCE_API_KEY=your_key_here
BINANCE_API_SECRET=your_secret_here
BINANCE_USE_TESTNET=true

# Coinbase (optional)
CB_KEY=your_key_here
CB_SECRET=your_secret_here
CB_PASSPHRASE=your_passphrase_here
CB_USE_SANDBOX=true
```

## API Endpoints

### Health Check
```
GET /health
```
Returns server status and environment.

### Generate Trading Signals
```
POST /signals
Content-Type: application/json

{
  "symbol": "BTCUSDT",
  "interval": "1m",
  "source": "binance",
  "short": 12,
  "long": 26,
  "features": ["sma"]
}
```

Response:
```json
{
  "symbol": "BTCUSDT",
  "interval": "1m",
  "price": 42150.50,
  "signal": "buy",
  "short": 12,
  "long": 26,
  "crossingIndex": 145,
  "explain": {
    "explanation": "Short MA above long MA on uptrend",
    "confidence": 0.85,
    "risk": "Check volume confirmation"
  }
}
```

### Execute Trade
```
POST /execute
Content-Type: application/json

{
  "symbol": "BTCUSDT",
  "side": "buy",
  "size_pct": 0.75,
  "mode": "paper",
  "balance_usd": 10000
}
```

Response:
```json
{
  "status": "accepted",
  "mode": "paper",
  "simulated": true,
  "price": 42150.50,
  "notional": 7500.00
}
```

### Webhook (Exchange Events)
```
POST /webhook/exchange
```

## Technical Details

### SMA Crossover Strategy
- **Short MA**: 12 periods (default)
- **Long MA**: 26 periods (default)
- **Signal**: BUY when short > long, SELL when short < long, HOLD otherwise
- **Data Source**: 1m, 5m, 15m, or 1h candles

### Risk Management
- **Position Sizing**: Conservative (50%), Balanced (75%), Aggressive (100%)
- **Pre-Trade Checks**: Price validation, balance verification, minimum notional
- **Paper Mode**: Simulated execution without real funds
- **Live Mode**: Real exchange orders (testnet or mainnet)

### Audit Trail
All trades, signals, and webhooks are logged to `logs/audit.log` in JSON format:
```json
{"ts":1698345600000,"event":"signal","symbol":"BTCUSDT",...}
```

## Development

### Running Tests
```bash
cd trusttrade-backend
npm test
```

### Linting
```bash
npm run lint
```

## Deployment

### Heroku
```bash
git push heroku main
```

### AWS/GCP/Azure
Use the provided Dockerfile for containerized deployment.

### Environment Variables for Production
- Set `NODE_ENV=production`
- Use strong API keys with minimal permissions
- Enable audit logging
- Configure CORS for your frontend domain

## Security Considerations

1. **API Keys**: Store in `.env`, never commit to git
2. **Testnet First**: Always test on exchange testnets
3. **Rate Limiting**: Enabled by default (60/30s)
4. **Webhook Validation**: Verify exchange signatures (TODO)
5. **CORS**: Configured to accept frontend origin
6. **Input Validation**: Zod schemas for all endpoints

## Known Limitations

- SMA strategy is for demonstration; use additional indicators for production
- No order book analysis or volume confirmation
- Manual webhook signature verification needed
- Paper mode doesn't account for slippage or fees
- Single-indicator signals require risk management overlay

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit changes with clear messages
4. Submit a pull request

## Support

For issues, questions, or contributions:
- GitHub Issues: [Report bugs]
- Discussions: [Ask questions]
- Documentation: See `/trusttrade-frontend/src/App.jsx` "Documentation" tab

## License

MIT

## Disclaimer

TrustTrade is provided for educational purposes. Cryptocurrency trading involves substantial risk of loss. Never risk money you can't afford to lose. Past performance is not indicative of future results. Always conduct thorough testing and backtesting before live trading.

---

**Version**: 0.1.0
**Last Updated**: 2025-10-26

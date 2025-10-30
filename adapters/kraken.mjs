import fetch from "node-fetch";
import crypto from "crypto";
import KrakenClient from "kraken-api";

const BASE = "https://api.kraken.com";

/**
 * Get OHLC (candlestick) data from Kraken
 * Kraken uses product pairs like BTCUSD, ETHUSD, etc.
 */
export async function getCandles({ symbol = "BTCUSD", interval = "1m", limit = 500 }) {
  // Convert interval to Kraken interval format
  const intervalMap = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "1h": 60,
  };
  const krakenInterval = intervalMap[interval] || 1;

  // Kraken uses different pair naming (e.g., BTCUSD instead of BTCUSDT)
  // If symbol ends with USDT, convert to USD
  const pair = symbol.replace("USDT", "USD");

  const url = `${BASE}/0/public/OHLC?pair=${pair}&interval=${krakenInterval}`;

  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Kraken OHLC failed: ${r.status}`);
    const data = await r.json();

    if (data.error && data.error.length > 0) {
      throw new Error(`Kraken API error: ${data.error[0]}`);
    }

    // Kraken returns data with pair as key
    const pairKey = Object.keys(data.result).find(k => k !== "last");
    if (!pairKey) throw new Error(`No data for pair ${pair}`);

    const candles = data.result[pairKey];
    if (!Array.isArray(candles)) throw new Error("Invalid candles data");

    // Map Kraken OHLC format to standard format
    // Kraken format: [time, open, high, low, close, vwap, volume, count]
    return candles.map(c => ({
      time: c[0] * 1000, // Convert to milliseconds
      open: +c[1],
      high: +c[2],
      low: +c[3],
      close: +c[4],
      volume: +c[6]
    }));
  } catch (e) {
    throw new Error(`Kraken getCandles failed: ${e.message}`);
  }
}

/**
 * Get current price from Kraken
 */
export async function getCurrentPrice(symbol = "BTCUSD") {
  const pair = symbol.replace("USDT", "USD");

  try {
    const url = `${BASE}/0/public/Ticker?pair=${pair}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Kraken price fetch failed: ${r.status}`);
    const data = await r.json();

    if (data.error && data.error.length > 0) {
      throw new Error(`Kraken API error: ${data.error[0]}`);
    }

    const pairKey = Object.keys(data.result)[0];
    const tickerData = data.result[pairKey];

    // Kraken ticker format includes [ask, ask_volume, bid, bid_volume, last_trade]
    // Use last_trade[0] for current price
    const price = +tickerData.c[0]; // close price (last trade)
    return price;
  } catch (e) {
    throw new Error(`Kraken getCurrentPrice failed: ${e.message}`);
  }
}

/**
 * Place an order on Kraken (simplified for paper trading)
 * Note: This requires API key and secret for live trading
 */
export async function placeOrder({ symbol, side, quoteOrderQty }) {
  const key = process.env.KRAKEN_API_KEY;
  const secret = process.env.KRAKEN_API_SECRET;

  // For paper trading, just return mock order
  if (!key || !secret) {
    return {
      ordertxid: [crypto.randomUUID()],
      status: "ok",
      descr: {
        order: `${side.toUpperCase()} ${quoteOrderQty} ${symbol}`,
        close: ""
      }
    };
  }

  // For live trading with real API keys
  try {
    const pair = symbol.replace("USDT", "USD");
    const endpoint = `${BASE}/0/private/AddOrder`;

    // Calculate quantity from quote amount and current price
    const price = await getCurrentPrice(symbol);
    const quantity = quoteOrderQty / price;

    const params = new URLSearchParams({
      pair,
      type: side.toLowerCase(),
      ordertype: "market",
      volume: String(quantity.toFixed(8))
    });

    const nonce = String(Date.now());
    const postData = `${params.toString()}&nonce=${nonce}`;

    // Kraken signature calculation
    const hashDigest = crypto
      .createHash("sha256")
      .update(postData)
      .digest();
    const hmac = crypto
      .createHmac("sha512", Buffer.from(secret, "base64"))
      .update(Buffer.concat([Buffer.from(endpoint.replace(BASE, "")), hashDigest]))
      .digest("base64");

    const headers = {
      "API-Sign": hmac,
      "API-Key": key
    };

    const r = await fetch(endpoint, {
      method: "POST",
      headers,
      body: postData
    });

    const j = await r.json();
    if (j.error && j.error.length > 0) {
      throw new Error(`Order failed: ${j.error[0]}`);
    }

    return j.result;
  } catch (e) {
    throw new Error(`Kraken placeOrder failed: ${e.message}`);
  }
}

/**
 * Get all tradable pairs on Kraken (for validation)
 */
export async function getTradablePairs() {
  try {
    const url = `${BASE}/0/public/AssetPairs`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Failed to fetch pairs: ${r.status}`);
    const data = await r.json();

    if (data.error && data.error.length > 0) {
      throw new Error(`Kraken API error: ${data.error[0]}`);
    }

    return Object.keys(data.result);
  } catch (e) {
    console.error(`Kraken getTradablePairs failed: ${e.message}`);
    return []; // Return empty array on error
  }
}

/**
 * Get account balance and assets from Kraken (requires API key)
 */
export async function getAccountBalance() {
  try {
    const key = process.env.KRAKEN_API_KEY;
    const secret = process.env.KRAKEN_API_SECRET;

    if (!key || !secret) {
      return { ok: false, error: "API credentials not configured" };
    }

    // Use kraken-api library for proper authentication
    const kraken = new KrakenClient(key, secret);

    const result = await kraken.api('Balance');

    if (result.error && result.error.length > 0) {
      return { ok: false, error: result.error[0] };
    }

    // Filter out zero balances and format response
    const balances = result.result || {};
    const assets = Object.entries(balances)
      .filter(([_, amount]) => parseFloat(amount) > 0)
      .map(([asset, amount]) => ({
        asset: asset.replace(/^Z/, "").replace(/^X/, ""), // Remove Kraken prefixes
        amount: parseFloat(amount)
      }));

    return {
      ok: true,
      balances: assets,
      raw: balances
    };
  } catch (e) {
    console.error("Kraken getAccountBalance failed:", e.message);
    return {
      ok: false,
      error: e.message
    };
  }
}

export default {
  getCandles,
  getCurrentPrice,
  placeOrder,
  getTradablePairs,
  getAccountBalance
};

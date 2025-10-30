import fetch from "node-fetch";
import crypto from "crypto";
import { URLSearchParams } from "url";

const BASE = process.env.BINANCE_USE_TESTNET==="true"
  ? "https://testnet.binance.vision"
  : "https://api.binance.com";

export async function getKlines({symbol="BTCUSDT", interval="1m", limit=500}){
  const url = `${BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Binance klines failed: ${r.status}`);
  const arr = await r.json();
  return arr.map(k => ({ t:+k[0], o:+k[1], h:+k[2], l:+k[3], c:+k[4], v:+k[5] }));
}

function sign(query){
  const sig = crypto.createHmac("sha256", process.env.BINANCE_API_SECRET || "")
    .update(query).digest("hex");
  return sig;
}

// very simplified; for live usage add recvWindow, better error handling, etc.
export async function placeOrder({symbol, side, quoteOrderQty}) {
  const key = process.env.BINANCE_API_KEY;
  const sec = process.env.BINANCE_API_SECRET;
  if (!key || !sec) throw new Error("Missing BINANCE keys");

  const endpoint = `${BASE}/api/v3/order`;
  const params = new URLSearchParams({
    symbol,
    side: side.toUpperCase(),
    type: "MARKET",
    quoteOrderQty: String(quoteOrderQty),
    timestamp: String(Date.now())
  });
  const signature = sign(params.toString());
  const url = `${endpoint}?${params.toString()}&signature=${signature}`;
  const r = await fetch(url, { method:"POST", headers: { "X-MBX-APIKEY": key } });
  const j = await r.json();
  if (!r.ok) throw new Error(`Order failed: ${r.status} ${JSON.stringify(j)}`);
  return j;
}

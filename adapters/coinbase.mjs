import fetch from "node-fetch";

const BASE = "https://api.exchange.coinbase.com";

export async function getCandles({productId="BTC-USD", granularity=60, limit=300}) {
  // Coinbase returns [time, low, high, open, close, volume]
  // We'll map to a shared shape: {t,o,h,l,c,v}
  const since = Math.floor(Date.now()/1000) - (granularity * limit);
  const url = `${BASE}/products/${productId}/candles?granularity=${granularity}&start=${new Date((since)*1000).toISOString()}`;
  const r = await fetch(url, { headers: { "User-Agent":"trusttrade" } });
  if (!r.ok) throw new Error(`Coinbase candles failed: ${r.status}`);
  const data = await r.json();
  // data is newest -> oldest; reverse to ascending
  return data.reverse().map(row => ({
    t: row[0]*1000,
    o: +row[3], h: +row[2], l: +row[1], c: +row[4], v: +row[5]
  }));
}

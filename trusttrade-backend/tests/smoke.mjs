import fetch from "node-fetch";
const base = "http://localhost:8787";
async function main(){
  try {
    let r = await fetch(base+"/health");
    console.log("health", await r.json());

    r = await fetch(base+"/signals", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ symbol:"BTCUSDT", interval:"1m", source:"binance", short:12, long:26 })
    });
    console.log("signals", await r.json());

    r = await fetch(base+"/execute", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ symbol:"BTCUSDT", side:"buy", mode:"paper", balance_usd:10000, size_pct:0.5 })
    });
    console.log("execute", await r.json());
  } catch (e) {
    console.error(e);
  }
}
main();

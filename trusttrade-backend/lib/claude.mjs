import fetch from "node-fetch";

/**
 * Optional: Ask Claude to "explain" or add meta-signal risk context.
 * If ANTHROPIC_API_KEY is absent, we just return null.
 */
export async function explainWithClaude({symbol, interval, signal, context}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const prompt = `You are a cautious crypto trading assistant. User context:
- Symbol: ${symbol}
- Interval: ${interval}
- Strategy: SMA crossover
- Raw signal: ${signal}

Explain in 1-2 short sentences, with a clear confidence (0-1) and a single risk note. Output JSON:
{"explanation":"...", "confidence": 0.00, "risk":"..."}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":"application/json",
        "x-api-key": key,
        "anthropic-version":"2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-latest",
        max_tokens: 200,
        messages: [{ role:"user", content: prompt }]
      })
    });
    const j = await r.json();
    const text = j?.content?.[0]?.text || "";
    // try to parse JSON from Claude
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    return { explanation: text.slice(0,180), confidence: 0.5, risk: "Unparsed JSON; default confidence." };
  } catch (e) {
    return { explanation: "Explainability temporarily unavailable.", confidence: 0.5, risk: "LLM request failed." };
  }
}

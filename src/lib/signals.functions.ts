import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { detectSetup, pipValue, suggestLot, type Candle } from "./indicators";

const PAIRS = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "XAU/USD"];

async function fetchCandles(symbol: string, interval = "15min", outputsize = 100): Promise<Candle[]> {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error("TWELVEDATA_API_KEY is not configured");
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${key}`;
  const res = await fetch(url);
  const json: any = await res.json();
  if (json.status === "error" || !json.values) {
    throw new Error(json.message || "Failed to fetch candles");
  }
  return (json.values as any[])
    .reverse()
    .map((v) => ({
      t: new Date(v.datetime).getTime(),
      o: parseFloat(v.open),
      h: parseFloat(v.high),
      l: parseFloat(v.low),
      c: parseFloat(v.close),
    }));
}

export const getQuotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      pairs: z.array(z.string()).max(10).optional(),
      interval: z.string().default("15min"),
    }),
  )
  .handler(async ({ data }) => {
    const pairs = data.pairs ?? PAIRS;
    const results = await Promise.allSettled(
      pairs.map(async (p) => {
        const candles = await fetchCandles(p, data.interval, 80);
        const setup = detectSetup(candles);
        return { pair: p, price: candles.at(-1)?.c ?? 0, setup };
      }),
    );
    return results.map((r, i) =>
      r.status === "fulfilled" ? r.value : { pair: pairs[i], error: r.reason?.message ?? "error" },
    );
  });

const MODE_BRIEFS: Record<string, string> = {
  challenge: "5ers Step 1: $2,500 account. 8% profit target. Max 5% daily drawdown, 10% overall. Be selective.",
  verification: "5ers Step 2: 5% profit target, same DD rules. Capital preservation over aggression.",
  funded: "Live funded account. Trade conservatively, prioritize keeping the account.",
  demo: "Demo/testing mode. Experimental setups allowed for learning.",
};

export const generateSignal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ pair: z.string(), interval: z.string().default("15min") }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: profile } = await supabase
      .from("profiles")
      .select("current_mode, current_balance, risk_per_trade_pct, daily_goal_usd")
      .eq("id", userId)
      .maybeSingle();

    const mode = profile?.current_mode ?? "challenge";
    const balance = Number(profile?.current_balance ?? 2500);
    const riskPct = Number(profile?.risk_per_trade_pct ?? 0.5);

    const candles = await fetchCandles(data.pair, data.interval, 100);
    const setup = detectSetup(candles);
    if (!setup) throw new Error("Not enough data");
    if (!setup.bias) {
      return { skipped: true, reason: "No clean setup on this timeframe right now.", setup };
    }

    const pip = pipValue(data.pair);
    const slDistance = setup.atr * 1.2;
    const tp1Distance = slDistance * 1.5;
    const tp2Distance = slDistance * 2.5;
    const entry = setup.lastClose;
    const sl = setup.bias === "buy" ? entry - slDistance : entry + slDistance;
    const tp1 = setup.bias === "buy" ? entry + tp1Distance : entry - tp1Distance;
    const tp2 = setup.bias === "buy" ? entry + tp2Distance : entry - tp2Distance;
    const slPips = slDistance / pip;
    const lot = suggestLot(data.pair, slPips, balance, riskPct);

    // Ask Lovable AI to filter/explain
    const apiKey = process.env.LOVABLE_API_KEY;
    let rationale = `EMA20/50 ${setup.trend} trend, pullback into EMA20 with RSI ${setup.rsi.toFixed(1)}.`;
    let confidence = 60;
    if (apiKey) {
      try {
        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content: `You are a disciplined prop-firm trading assistant. Account context: ${MODE_BRIEFS[mode]} Return a SHORT JSON object {"confidence":0-100,"rationale":"<=160 chars"} only.`,
              },
              {
                role: "user",
                content: `Pair ${data.pair} ${data.interval}. Setup: ${setup.bias.toUpperCase()} pullback. Trend ${setup.trend}. RSI ${setup.rsi.toFixed(1)}. ATR ${setup.atr.toFixed(5)}. Entry ${entry}, SL ${sl.toFixed(5)}, TP1 ${tp1.toFixed(5)}, TP2 ${tp2.toFixed(5)}. R:R 1.5/2.5. Rate confidence + give one-line rationale.`,
              },
            ],
          }),
        });
        if (aiRes.ok) {
          const j: any = await aiRes.json();
          const txt: string = j.choices?.[0]?.message?.content ?? "";
          const m = txt.match(/\{[\s\S]*\}/);
          if (m) {
            const parsed = JSON.parse(m[0]);
            if (typeof parsed.confidence === "number") confidence = Math.round(parsed.confidence);
            if (typeof parsed.rationale === "string") rationale = parsed.rationale;
          }
        }
      } catch (e) {
        console.error("AI filter failed", e);
      }
    }

    const { data: inserted, error } = await supabase
      .from("signals")
      .insert({
        user_id: userId,
        pair: data.pair,
        timeframe: data.interval,
        direction: setup.bias,
        entry,
        stop_loss: sl,
        take_profit_1: tp1,
        take_profit_2: tp2,
        confidence,
        suggested_lot: lot,
        rationale,
        mode_context: mode,
        indicators: {
          rsi: setup.rsi,
          atr: setup.atr,
          ema20: setup.ema20,
          ema50: setup.ema50,
          trend: setup.trend,
          slPips,
          dailyGoalUsd: profile?.daily_goal_usd ?? 20,
        },
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return { skipped: false, signal: inserted };
  });

export const listSignals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("signals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return data;
  });

/**
 * Daily Pick — scans every watched pair and returns ONE highest-quality setup,
 * sized so SL distance risks ~$100 and TP returns ~$20.
 */
export const getDailyPick = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      interval: z.string().default("15min"),
      riskUsd: z.number().min(10).max(10000).default(100),
      targetUsd: z.number().min(1).max(10000).default(20),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("current_mode, watched_pairs")
      .eq("id", userId)
      .maybeSingle();

    const pairs = ((profile?.watched_pairs as string[] | undefined) ?? PAIRS);
    const mode = profile?.current_mode ?? "challenge";

    const scans = await Promise.allSettled(
      pairs.map(async (pair) => {
        const candles = await fetchCandles(pair, data.interval, 100);
        return { pair, setup: detectSetup(candles) };
      }),
    );

    type Candidate = {
      pair: string; bias: "buy" | "sell"; entry: number; sl: number; tp: number;
      slPips: number; tpPips: number; lot: number; score: number; setup: any;
    };
    const candidates: Candidate[] = [];

    for (const r of scans) {
      if (r.status !== "fulfilled") continue;
      const { pair, setup } = r.value;
      if (!setup || !setup.bias) continue;

      const pip = pipValue(pair);
      const dpp = pair.includes("XAU") ? 10 : pair.includes("JPY") ? 9 : 10;
      const slDistance = setup.atr * 1.2;
      const slPips = slDistance / pip;
      if (slPips <= 0) continue;

      const rawLot = data.riskUsd / (slPips * dpp);
      const lot = Math.max(0.01, Math.round(rawLot * 100) / 100);
      const tpPips = data.targetUsd / (lot * dpp);
      const tpDistance = tpPips * pip;

      const entry = setup.lastClose;
      const sl = setup.bias === "buy" ? entry - slDistance : entry + slDistance;
      const tp = setup.bias === "buy" ? entry + tpDistance : entry - tpDistance;

      const rsiSweet = setup.bias === "buy"
        ? 100 - Math.abs(setup.rsi - 55)
        : 100 - Math.abs(setup.rsi - 45);
      const trendBonus = (setup.bias === "buy" && setup.trend === "up")
        || (setup.bias === "sell" && setup.trend === "down") ? 25 : 0;
      const score = Math.round(rsiSweet * 0.6 + trendBonus + 15);

      candidates.push({ pair, bias: setup.bias, entry, sl, tp, slPips, tpPips, lot, score, setup });
    }

    if (!candidates.length) {
      return { pick: null, reason: "No clean setup right now on watched pairs. Wait for price action." };
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    const apiKey = process.env.LOVABLE_API_KEY;
    let confidence = Math.min(95, best.score);
    let rationale = `${best.pair} ${best.bias.toUpperCase()} — ${best.setup.trend} trend, RSI ${best.setup.rsi.toFixed(0)}, pullback into EMA20. Tight $20 TP keeps probability high.`;

    if (apiKey) {
      try {
        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: `Prop-firm assistant. Context: ${MODE_BRIEFS[mode]} Plan: $${data.riskUsd} SL, $${data.targetUsd} TP scalp — MUST be high-probability. Return JSON only {"confidence":0-100,"rationale":"<=160 chars"}.` },
              { role: "user", content: `Best pick: ${best.pair} ${best.bias.toUpperCase()} @ ${best.entry}. Trend ${best.setup.trend}, RSI ${best.setup.rsi.toFixed(1)}, ATR ${best.setup.atr.toFixed(5)}. SL ${best.sl.toFixed(5)} (${best.slPips.toFixed(0)}p), TP ${best.tp.toFixed(5)} (${best.tpPips.toFixed(0)}p), lot ${best.lot}.` },
            ],
          }),
        });
        if (aiRes.ok) {
          const j: any = await aiRes.json();
          const txt: string = j.choices?.[0]?.message?.content ?? "";
          const m = txt.match(/\{[\s\S]*\}/);
          if (m) {
            const parsed = JSON.parse(m[0]);
            if (typeof parsed.confidence === "number") confidence = Math.round(parsed.confidence);
            if (typeof parsed.rationale === "string") rationale = parsed.rationale;
          }
        }
      } catch (e) { console.error("AI refine failed", e); }
    }

    return {
      pick: {
        pair: best.pair,
        direction: best.bias,
        entry: best.entry,
        stop_loss: best.sl,
        take_profit: best.tp,
        lot_size: best.lot,
        sl_pips: Math.round(best.slPips),
        tp_pips: Math.round(best.tpPips),
        risk_usd: data.riskUsd,
        target_usd: data.targetUsd,
        confidence,
        rationale,
        rsi: best.setup.rsi,
        trend: best.setup.trend,
        timeframe: data.interval,
        generated_at: new Date().toISOString(),
      },
      candidates: candidates.length,
    };
  });

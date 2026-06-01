import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { detectSetup, pipValue, suggestLot, type Candle } from "./indicators";
import { fetchNewsEvents, newsGuard, summarizeTrades, type NewsEvent } from "./engine.server";

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
    const [{ data: profile }, { data: tradeRows }, newsEvents] = await Promise.all([
      supabase
        .from("profiles")
        .select("current_mode, watched_pairs, current_balance")
        .eq("id", userId)
        .maybeSingle(),
      supabase.from("trades").select("pair,status,pnl_usd").eq("user_id", userId),
      fetchNewsEvents(),
    ]);

    const pairs = ((profile?.watched_pairs as string[] | undefined) ?? PAIRS);
    const mode = profile?.current_mode ?? "challenge";
    const balance = Number(profile?.current_balance ?? 2500);

    // Learning: per-pair edge from the trader's own closed-trade history.
    const stats = summarizeTrades(tradeRows ?? []);
    const NEWS_WINDOW_MIN = 30;

    // 5ers max-lot caps (conservative, keeps you compliant on any account size).
    // FX majors: 0.5 lot per $1k · JPY: 0.4 per $1k · Gold/XAU: 0.05 per $1k.
    const maxLotFor = (pair: string) =>
      pair.includes("XAU") ? Math.max(0.01, (balance / 1000) * 0.05)
      : pair.includes("JPY") ? Math.max(0.01, (balance / 1000) * 0.4)
      : Math.max(0.01, (balance / 1000) * 0.5);

    // Multi-timeframe: trade TF + higher TF (1h) for confluence
    const htf = "1h";
    const scans = await Promise.allSettled(
      pairs.map(async (pair) => {
        const [ltfCandles, htfCandles] = await Promise.all([
          fetchCandles(pair, data.interval, 100),
          fetchCandles(pair, htf, 100),
        ]);
        return { pair, setup: detectSetup(ltfCandles), htf: detectSetup(htfCandles) };
      }),
    );

    const newsBlocked: { pair: string; event: NewsEvent }[] = [];


    type Candidate = {
      pair: string; bias: "buy" | "sell"; entry: number; sl: number; tp: number;
      slPips: number; tpPips: number; lot: number; score: number; setup: any; htf: any;
      factors: string[];
      timing: { action: "enter_now" | "wait"; order_type: "market" | "buy_limit" | "sell_limit"; trigger_price: number; note: string };
      lotCapped: boolean; actualRiskUsd: number;
    };
    const candidates: Candidate[] = [];

    for (const r of scans) {
      if (r.status !== "fulfilled") continue;
      const { pair, setup, htf: htfSetup } = r.value;
      if (!setup || !setup.bias) continue;

      const pip = pipValue(pair);
      const dpp = pair.includes("XAU") ? 10 : pair.includes("JPY") ? 9 : 10;
      const slDistance = setup.atr * 1.2;
      const slPips = slDistance / pip;
      if (slPips <= 0) continue;

      // Lot sizing: target $riskUsd, but cap by 5ers max-lot rule
      const rawLot = data.riskUsd / (slPips * dpp);
      const maxLot = maxLotFor(pair);
      let lot = Math.round(Math.min(rawLot, maxLot) * 100) / 100;
      lot = Math.max(0.01, lot);
      const lotCapped = rawLot > maxLot;
      const actualRiskUsd = Math.round(lot * slPips * dpp);
      const tpPips = data.targetUsd / (lot * dpp);
      const tpDistance = tpPips * pip;

      // Entry timing — NOW vs WAIT. Ideal pullback zone = EMA20.
      const idealEntry = setup.ema20;
      const distToIdeal = Math.abs(setup.lastClose - idealEntry);
      const enterNow = distToIdeal <= setup.atr * 0.25;
      const entry = enterNow ? setup.lastClose : idealEntry;
      const sl = setup.bias === "buy" ? entry - slDistance : entry + slDistance;
      const tp = setup.bias === "buy" ? entry + tpDistance : entry - tpDistance;
      const fmtPrice = (n: number) => n.toFixed(pair.includes("JPY") ? 3 : pair.includes("XAU") ? 2 : 5);
      const timing = enterNow
        ? {
            action: "enter_now" as const,
            order_type: "market" as const,
            trigger_price: entry,
            note: `Price is sitting at the EMA20 pullback zone — execute a market order now.`,
          }
        : {
            action: "wait" as const,
            order_type: (setup.bias === "buy" ? "buy_limit" : "sell_limit") as "buy_limit" | "sell_limit",
            trigger_price: idealEntry,
            note: `Price is ${(distToIdeal / pip).toFixed(0)} pips off the ideal entry. Place a ${setup.bias === "buy" ? "BUY LIMIT" : "SELL LIMIT"} at ${fmtPrice(idealEntry)} and let price come to you. Cancel if structure breaks.`,
          };

      // Structured analysis — every factor is an explicit, auditable reason
      const factors: string[] = [];
      const htfAligned = htfSetup && (
        (setup.bias === "buy" && htfSetup.trend === "up") ||
        (setup.bias === "sell" && htfSetup.trend === "down")
      );
      const ltfAligned = (setup.bias === "buy" && setup.trend === "up")
        || (setup.bias === "sell" && setup.trend === "down");
      const rsiInZone = setup.bias === "buy" ? setup.rsi > 40 && setup.rsi < 65 : setup.rsi > 35 && setup.rsi < 60;
      const pullbackOk = Math.abs(setup.lastClose - setup.ema20) < setup.atr * 0.6;
      const emaSeparation = Math.abs(setup.ema20 - setup.ema50) > setup.atr * 0.3;

      if (htfAligned) factors.push(`H1 trend ${String(htfSetup.trend).toUpperCase()} confirms ${setup.bias.toUpperCase()} bias (top-down confluence).`);
      if (ltfAligned) factors.push(`${data.interval} EMA20>EMA50 ${String(setup.trend).toUpperCase()} structure intact — trading with the trend.`);
      if (emaSeparation) factors.push(`EMA20/EMA50 cleanly separated (>0.3·ATR) — confirmed trend, not range chop.`);
      if (pullbackOk) factors.push(`Price pulled back to EMA20 (dynamic S/R) instead of chasing extension.`);
      if (rsiInZone) factors.push(`RSI ${setup.rsi.toFixed(0)} in healthy continuation zone (not overbought/oversold).`);
      factors.push(`ATR-based SL (${slPips.toFixed(0)} pips) respects current volatility — no arbitrary stops.`);
      factors.push(enterNow
        ? `Price is at the level — market entry valid right now.`
        : `Pending ${timing.order_type.toUpperCase().replace("_", " ")} at EMA20 — disciplined entry, no chasing.`);
      factors.push(`Lot ${lot} sized for ~$${actualRiskUsd} risk → $${data.targetUsd} target. ${lotCapped ? `(Capped by 5ers max-lot rule for $${balance.toFixed(0)} account.)` : "(Full risk allocated.)"}`);

      // Strict A+ scoring — HTF confluence is mandatory
      const rsiSweet = setup.bias === "buy" ? 100 - Math.abs(setup.rsi - 55) : 100 - Math.abs(setup.rsi - 45);
      let score = Math.round(rsiSweet * 0.3);
      if (htfAligned) score += 35; else score -= 25;
      if (ltfAligned) score += 20;
      if (emaSeparation) score += 10;
      if (pullbackOk) score += 10;
      if (!rsiInZone) score -= 20;

      candidates.push({ pair, bias: setup.bias, entry, sl, tp, slPips, tpPips, lot, score, setup, htf: htfSetup, factors, timing, lotCapped, actualRiskUsd });
    }

    // Strict A+ quality gate — no room for error
    const MIN_SCORE = 75;
    const qualified = candidates.filter((c) => c.score >= MIN_SCORE);
    if (!qualified.length) {
      return {
        pick: null,
        reason: candidates.length
          ? `Scanned ${candidates.length} setup(s) — none cleared the ${MIN_SCORE}-pt quality bar. Discipline > activity. Sit out.`
          : "No clean setup on watched pairs right now. Wait for price action.",
        candidates: candidates.length,
      };
    }

    qualified.sort((a, b) => b.score - a.score);
    const best = qualified[0];

    const apiKey = process.env.LOVABLE_API_KEY;
    let confidence = Math.min(95, best.score);
    let rationale = `${best.pair} ${best.bias.toUpperCase()} — H1 ${best.htf?.trend ?? "?"} + ${data.interval} ${best.setup.trend} alignment, RSI ${best.setup.rsi.toFixed(0)} pullback into EMA20.`;

    if (apiKey) {
      try {
        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: `Senior prop-firm analyst. Context: ${MODE_BRIEFS[mode]} Plan: $${data.riskUsd} SL, $${data.targetUsd} TP. Quality over activity — if anything looks weak, lower confidence. Return JSON only {"confidence":0-100,"rationale":"<=200 chars explaining WHY this works"}.` },
              { role: "user", content: `Pick: ${best.pair} ${best.bias.toUpperCase()} @ ${best.entry}. H1 trend ${best.htf?.trend}, ${data.interval} trend ${best.setup.trend}, RSI ${best.setup.rsi.toFixed(1)}, ATR ${best.setup.atr.toFixed(5)}. SL ${best.sl.toFixed(5)} (${best.slPips.toFixed(0)}p), TP ${best.tp.toFixed(5)} (${best.tpPips.toFixed(0)}p), lot ${best.lot}. Confluence: ${best.factors.join(" | ")}` },
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
        risk_usd: best.actualRiskUsd,
        target_usd: data.targetUsd,
        lot_capped: best.lotCapped,
        account_balance: balance,
        timing: best.timing,
        confidence,
        rationale,
        factors: best.factors,
        rsi: best.setup.rsi,
        trend: best.setup.trend,
        htf_trend: best.htf?.trend ?? null,
        timeframe: data.interval,
        higher_timeframe: htf,
        generated_at: new Date().toISOString(),
        disclaimer: "Educational use only — not financial advice. © Gabriel Maina Mwangi, Nakuru.",
      },
      candidates: candidates.length,
      qualified: qualified.length,
    };
  });

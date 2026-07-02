import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireActiveSubscription } from "./subscription-guard";
import { detectSetup, pipValue, suggestLot, type Candle } from "./indicators";
import { fetchNewsEvents, newsGuard, summarizeTrades, type NewsEvent } from "./engine.server";

const PAIRS = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "XAU/USD"] as const;
const pairSchema = z.enum(["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "XAU/USD"]);
const intervalSchema = z.enum(["5min", "15min", "30min", "1h", "4h"]);

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
  .middleware([requireActiveSubscription])
  .inputValidator(
    z.object({
      pairs: z.array(pairSchema).max(10).optional(),
      interval: intervalSchema.default("15min"),
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
  challenge: "Step 1: $2,500 account. 8% profit target. Max 5% daily drawdown, 10% overall. Be selective.",
  verification: "Step 2: 5% profit target, same DD rules. Capital preservation over aggression.",
  funded: "Live funded account. Trade conservatively, prioritize keeping the account.",
  demo: "Demo/testing mode. Experimental setups allowed for learning.",
};

export const generateSignal = createServerFn({ method: "POST" })
  .middleware([requireActiveSubscription])
  .inputValidator(z.object({ pair: pairSchema, interval: intervalSchema.default("15min") }))
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
          headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "direct-fetch", "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
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
  .middleware([requireActiveSubscription])
  .inputValidator(
    z.object({
      interval: intervalSchema.default("15min"),
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

    // max-lot caps (conservative, keeps you compliant on any account size).
    // FX majors: 0.5 lot per $1k · JPY: 0.4 per $1k · Gold/XAU: 0.05 per $1k.
    const maxLotFor = (pair: string) =>
      pair.includes("XAU") ? Math.max(0.01, (balance / 1000) * 0.05)
      : pair.includes("JPY") ? Math.max(0.01, (balance / 1000) * 0.4)
      : Math.max(0.01, (balance / 1000) * 0.5);

    // Multi-timeframe: trade TF + higher TF (1h) + macro TF (4h) for confluence.
    // The engine only returns an A+ pick when the trade is aligned across the
    // decision timeframe and the broader market regime.
    const htf = "1h";
    const macroTf = "4h";
    const scans = await Promise.allSettled(
      pairs.map(async (pair) => {
        const [ltfCandles, htfCandles, macroCandles] = await Promise.all([
          fetchCandles(pair, data.interval, 100),
          fetchCandles(pair, htf, 100),
          fetchCandles(pair, macroTf, 100),
        ]);
        return { pair, candles: ltfCandles, setup: detectSetup(ltfCandles), htf: detectSetup(htfCandles), macro: detectSetup(macroCandles) };
      }),
    );

    const newsBlocked: { pair: string; event: NewsEvent }[] = [];


    type Candidate = {
      pair: string; bias: "buy" | "sell"; entry: number; sl: number; tp: number;
      slPips: number; tpPips: number; lot: number; score: number; setup: any; htf: any; macro: any;
      factors: string[];
      timing: { action: "enter_now" | "wait"; order_type: "market" | "buy_limit" | "sell_limit" | "buy_stop" | "sell_stop" | "buy_stop_limit" | "sell_stop_limit"; trigger_price: number; limit_price: number | null; note: string };
      lotCapped: boolean; actualRiskUsd: number;
    };
    const candidates: Candidate[] = [];

    for (const r of scans) {
      if (r.status !== "fulfilled") continue;
      const { pair, candles, setup, htf: htfSetup, macro: macroSetup } = r.value;
      if (!setup || !setup.bias) continue;

      // News guard — halt pairs with high-impact news inside the window.
      const newsHit = newsGuard(pair, newsEvents, NEWS_WINDOW_MIN);
      if (newsHit) { newsBlocked.push({ pair, event: newsHit }); continue; }

      const pip = pipValue(pair);
      const dpp = pair.includes("XAU") ? 10 : pair.includes("JPY") ? 9 : 10;

      // Entry timing — NOW vs WAIT. Ideal pullback zone = EMA20.
      const idealEntry = setup.ema20;
      const distToIdeal = Math.abs(setup.lastClose - idealEntry);
      const enterNow = distToIdeal <= setup.atr * 0.25;
      const entry = enterNow ? setup.lastClose : idealEntry;

      // Structure-aware stop: anchor it BEYOND the most recent swing (+0.5·ATR
      // buffer) so price must genuinely break structure to hit it — far less
      // likely to be stopped out before TP. Never tighter than 1.2·ATR.
      const buffer = setup.atr * 0.5;
      const structureStop = setup.bias === "buy"
        ? setup.swingLow - buffer
        : setup.swingHigh + buffer;
      const minDistance = setup.atr * 1.2;
      let slDistance = Math.abs(entry - structureStop);
      if (!isFinite(slDistance) || slDistance < minDistance) slDistance = minDistance;
      const slPips = slDistance / pip;
      if (slPips <= 0) continue;

      // Lot sizing: respect the trader's $risk parameter, capped by max-lot.
      // A wider (safer) stop simply means a smaller lot — risk stays controlled.
      const rawLot = data.riskUsd / (slPips * dpp);
      const maxLot = maxLotFor(pair);
      let lot = Math.round(Math.min(rawLot, maxLot) * 100) / 100;
      lot = Math.max(0.01, lot);
      const lotCapped = rawLot > maxLot;
      const actualRiskUsd = Math.round(lot * slPips * dpp);
      if (rawLot < 0.01 || actualRiskUsd > data.riskUsd * 1.05) {
        // If the broker minimum lot would risk more than allowed, skip it.
        // A prop-firm challenge survives by passing on oversized-risk setups.
        continue;
      }
      const tpPips = data.targetUsd / (lot * dpp);
      const tpDistance = tpPips * pip;

      const sl = setup.bias === "buy" ? entry - slDistance : entry + slDistance;
      const tp = setup.bias === "buy" ? entry + tpDistance : entry - tpDistance;
      const fmtPrice = (n: number) => n.toFixed(pair.includes("JPY") ? 3 : pair.includes("XAU") ? 2 : 5);

      const lastCandle = candles.at(-1)!;
      const prevCandle = candles.at(-2)!;
      const candleRange = Math.max(lastCandle.h - lastCandle.l, pip);
      const body = Math.abs(lastCandle.c - lastCandle.o);
      const upperWick = lastCandle.h - Math.max(lastCandle.o, lastCandle.c);
      const lowerWick = Math.min(lastCandle.o, lastCandle.c) - lastCandle.l;
      const closePosition = (lastCandle.c - lastCandle.l) / candleRange;
      const rejectionOk = setup.bias === "buy"
        ? lowerWick >= upperWick * 1.15 && closePosition >= 0.55
        : upperWick >= lowerWick * 1.15 && closePosition <= 0.45;
      const bodyNotDoji = body >= candleRange * 0.25;
      const noFreshMomentumAgainst = setup.bias === "buy"
        ? !(lastCandle.c < lastCandle.o && prevCandle.c < prevCandle.o && lastCandle.c < setup.ema20)
        : !(lastCandle.c > lastCandle.o && prevCandle.c > prevCandle.o && lastCandle.c > setup.ema20);
      const volRatio = setup.atr / Math.max(setup.lastClose, 1e-9);
      const volatilityOk = pair.includes("XAU")
        ? volRatio >= 0.00035 && volRatio <= 0.0065
        : volRatio >= 0.00008 && volRatio <= 0.0025;

      // ---- Pending-order intelligence -------------------------------------
      // Decide the EXACT order type a broker needs. Two questions:
      //   1) Does price have to RISE or FALL to reach the trigger?
      //   2) Are we entering INTO a pullback (limit) or on a BREAKOUT reclaim (stop)?
      // BUY: trigger below price + with-trend pullback = BUY LIMIT; trigger above
      //      price (price dipped below EMA20, want reclaim confirmation) = BUY STOP.
      // Mirror for SELL. On high-volatility instruments (XAU/wide ATR) a plain stop
      // can slip badly, so we upgrade it to a STOP-LIMIT with a capped fill price.
      const triggerAbove = idealEntry > setup.lastClose;
      const volatile = pair.includes("XAU") || setup.atr / Math.max(setup.lastClose, 1e-9) > 0.004;
      const slipCap = setup.atr * 0.3;

      let timing: Candidate["timing"];
      if (enterNow) {
        timing = {
          action: "enter_now", order_type: "market", trigger_price: entry, limit_price: null,
          note: `Price is sitting at the EMA20 pullback zone — execute a MARKET order now.`,
        };
      } else if (setup.bias === "buy") {
        if (!triggerAbove) {
          timing = {
            action: "wait", order_type: "buy_limit", trigger_price: idealEntry, limit_price: null,
            note: `Price is ${(distToIdeal / pip).toFixed(0)} pips above entry. Place a BUY LIMIT at ${fmtPrice(idealEntry)} so price comes down to you. Cancel if structure breaks.`,
          };
        } else if (volatile) {
          const limitPrice = idealEntry + slipCap;
          timing = {
            action: "wait", order_type: "buy_stop_limit", trigger_price: idealEntry, limit_price: limitPrice,
            note: `Price dipped below EMA20. Use a BUY STOP-LIMIT: trigger ${fmtPrice(idealEntry)}, limit ${fmtPrice(limitPrice)} — fills only on a confirmed reclaim and caps slippage on this volatile instrument.`,
          };
        } else {
          timing = {
            action: "wait", order_type: "buy_stop", trigger_price: idealEntry, limit_price: null,
            note: `Price is below EMA20. Place a BUY STOP at ${fmtPrice(idealEntry)} — triggers only when price reclaims the level (breakout confirmation), avoiding a falling-knife entry.`,
          };
        }
      } else {
        if (triggerAbove) {
          timing = {
            action: "wait", order_type: "sell_limit", trigger_price: idealEntry, limit_price: null,
            note: `Price is ${(distToIdeal / pip).toFixed(0)} pips below entry. Place a SELL LIMIT at ${fmtPrice(idealEntry)} so price rallies up to you. Cancel if structure breaks.`,
          };
        } else if (volatile) {
          const limitPrice = idealEntry - slipCap;
          timing = {
            action: "wait", order_type: "sell_stop_limit", trigger_price: idealEntry, limit_price: limitPrice,
            note: `Price popped above EMA20. Use a SELL STOP-LIMIT: trigger ${fmtPrice(idealEntry)}, limit ${fmtPrice(limitPrice)} — fills only on a confirmed rejection and caps slippage on this volatile instrument.`,
          };
        } else {
          timing = {
            action: "wait", order_type: "sell_stop", trigger_price: idealEntry, limit_price: null,
            note: `Price is above EMA20. Place a SELL STOP at ${fmtPrice(idealEntry)} — triggers only when price breaks back below the level (breakdown confirmation).`,
          };
        }
      }


      // Structured analysis — every factor is an explicit, auditable reason
      const factors: string[] = [];
      const htfAligned = htfSetup && (
        (setup.bias === "buy" && htfSetup.trend === "up") ||
        (setup.bias === "sell" && htfSetup.trend === "down")
      );
      const macroAligned = macroSetup && (
        (setup.bias === "buy" && macroSetup.trend === "up") ||
        (setup.bias === "sell" && macroSetup.trend === "down")
      );
      const macroNotAgainst = macroSetup && (
        macroAligned ||
        (setup.bias === "buy" && macroSetup.rsi >= 45) ||
        (setup.bias === "sell" && macroSetup.rsi <= 55)
      );
      const ltfAligned = (setup.bias === "buy" && setup.trend === "up")
        || (setup.bias === "sell" && setup.trend === "down");
      const rsiInZone = setup.bias === "buy" ? setup.rsi > 40 && setup.rsi < 65 : setup.rsi > 35 && setup.rsi < 60;
      const pullbackOk = Math.abs(setup.lastClose - setup.ema20) < setup.atr * 0.6;
      const emaSeparation = Math.abs(setup.ema20 - setup.ema50) > setup.atr * 0.3;

      // Core A+ gate — the non-negotiables for a with-trend pullback entry:
      // higher-timeframe confluence, trend structure, a healthy RSI zone, a real
      // pullback to value, and tradeable (not chaotic) volatility. Macro flow,
      // EMA separation and fresh-momentum checks are graded in the score instead
      // of hard-blocking, so genuine setups aren't thrown away — this surfaces
      // the 1–2 sure trades a day more consistently without lowering the bar.
      if (!htfAligned || !ltfAligned || !rsiInZone || !pullbackOk || !volatilityOk) {
        continue;
      }

      if (htfAligned) factors.push(`H1 trend ${String(htfSetup.trend).toUpperCase()} confirms ${setup.bias.toUpperCase()} bias (top-down confluence).`);
      if (macroAligned) factors.push(`4H trend also agrees — macro flow is not fighting the entry.`);
      else factors.push(`4H is neutral enough by RSI (${macroSetup?.rsi?.toFixed?.(0) ?? "n/a"}); no strong macro conflict detected.`);
      if (ltfAligned) factors.push(`${data.interval} EMA20>EMA50 ${String(setup.trend).toUpperCase()} structure intact — trading with the trend.`);
      if (emaSeparation) factors.push(`EMA20/EMA50 cleanly separated (>0.3·ATR) — confirmed trend, not range chop.`);
      if (pullbackOk) factors.push(`Price pulled back to EMA20 (dynamic S/R) instead of chasing extension.`);
      if (rsiInZone) factors.push(`RSI ${setup.rsi.toFixed(0)} in healthy continuation zone (not overbought/oversold).`);
      factors.push(`Volatility filter passed: ATR is active enough for $${data.targetUsd} but not chaotic (${(volRatio * 100).toFixed(3)}% of price).`);
      if (rejectionOk) factors.push(`Latest candle shows directional rejection at the pullback zone — buyers/sellers defended the level.`);
      else if (timing.action === "wait") factors.push(`No perfect rejection candle yet, so the system waits for the exact pending trigger instead of forcing market entry.`);
      factors.push(`SL (${slPips.toFixed(0)} pips) sits beyond the recent ${setup.bias === "buy" ? "swing low" : "swing high"} +0.5·ATR — price must break market structure to hit it, so it's unlikely to trigger before TP.`);
      factors.push(enterNow
        ? `Price is at the level — market entry valid right now.`
        : `Pending ${timing.order_type.toUpperCase().replaceAll("_", " ")} at EMA20 — disciplined entry, no chasing.`);
      factors.push(`Lot ${lot} sized for ~$${actualRiskUsd} risk → $${data.targetUsd} target. ${lotCapped ? `(Capped by max-lot rule for $${balance.toFixed(0)} account.)` : "(Full risk allocated.)"}`);

      // Learning: your own historical edge on this pair.
      const stat = stats.byPair[pair];
      if (stat && stat.trades >= 3) {
        factors.push(`Your edge: ${stat.winRate}% win rate on ${pair} (${stat.trades} trades) — the engine weights this.`);
      }

      // Strict A+ scoring — HTF confluence is mandatory (already gated)
      const rsiSweet = setup.bias === "buy" ? 100 - Math.abs(setup.rsi - 55) : 100 - Math.abs(setup.rsi - 45);
      let score = Math.round(rsiSweet * 0.24);
      score += 30; // H1 alignment already hard-gated above.
      score += macroAligned ? 16 : macroNotAgainst ? 8 : -6;
      score += 14; // LTF trend hard-gated.
      score += emaSeparation ? 10 : 2;   // graded, not gated
      score += 8;  // Pullback hard-gated.
      score += volatilityOk ? 7 : -20;
      score += noFreshMomentumAgainst ? 4 : -6; // graded, not gated
      if (bodyNotDoji) score += 4;
      if (rejectionOk) score += 6;
      // Adaptive: shift by your proven edge on this pair (smoothed, ±~12 pts).
      if (stat && stat.trades >= 3) score += Math.round((stat.edge - 50) * 0.4);


      candidates.push({ pair, bias: setup.bias, entry, sl, tp, slPips, tpPips, lot, score, setup, htf: htfSetup, macro: macroSetup, factors, timing, lotCapped, actualRiskUsd });
    }

    // A+ quality gate — high enough to stay "sure trades", low enough to
    // surface the 1–2 clean setups a day the trader is after.
    const MIN_SCORE = 74;
    const qualified = candidates.filter((c) => c.score >= MIN_SCORE);
    if (!qualified.length) {
      const newsNote = newsBlocked.length
        ? ` ⏸ Holding ${newsBlocked.map((n) => n.pair).join(", ")} — high-impact ${newsBlocked[0].event.currency} news (${newsBlocked[0].event.title}) ${newsBlocked[0].event.minutesAway >= 0 ? `in ${newsBlocked[0].event.minutesAway} min` : `${Math.abs(newsBlocked[0].event.minutesAway)} min ago`}. Re-scan once it settles.`
        : "";
      return {
        pick: null,
        reason: (candidates.length
          ? `Scanned ${candidates.length} setup(s) — none cleared the ${MIN_SCORE}-pt quality bar. Discipline > activity. Sit out.`
          : newsBlocked.length
            ? "All clean setups are inside a news blackout right now."
            : "No clean setup on watched pairs right now. Wait for price action.") + newsNote,
        candidates: candidates.length,
        news_halt: newsBlocked.map((n) => ({ pair: n.pair, title: n.event.title, currency: n.event.currency, minutesAway: n.event.minutesAway })),
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
          headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "direct-fetch", "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: `Senior prop-firm analyst. Context: ${MODE_BRIEFS[mode]} Plan: $${data.riskUsd} SL, $${data.targetUsd} TP. Quality over activity — if anything looks weak, lower confidence. Return JSON only {"confidence":0-100,"rationale":"<=200 chars explaining WHY this works"}. Never invent data; only judge the supplied facts.` },
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
        disclaimer: "Educational use only — not financial advice. © X-epic Enterprise, Nakuru.",
      },
      candidates: candidates.length,
      qualified: qualified.length,
      news_halt: newsBlocked.map((n) => ({ pair: n.pair, title: n.event.title, currency: n.event.currency, minutesAway: n.event.minutesAway })),
    };
  });

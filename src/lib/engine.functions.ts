import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  fetchLatestPrice,
  fetchNewsEvents,
  newsGuard,
  pairCurrencies,
  resolveAtPrice,
  summarizeTrades,
  type NewsEvent,
} from "./engine.server";
import { requireActiveSubscription } from "./subscription-guard";

/**
 * Scans the user's OPEN trades against live price and auto-closes any that
 * hit TP (win) or SL (loss), updating the account balance in one pass.
 */
export const reconcileTrades = createServerFn({ method: "POST" })
  .middleware([requireActiveSubscription])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: open } = await supabase
      .from("trades")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "open");

    const openTrades = open ?? [];
    if (!openTrades.length) return { checked: 0, closed: 0, results: [] as any[] };

    const pairs = Array.from(new Set(openTrades.map((t) => t.pair)));
    const priceEntries = await Promise.all(
      pairs.map(async (p) => [p, await fetchLatestPrice(p)] as const),
    );
    const prices = Object.fromEntries(priceEntries) as Record<string, number | null>;

    let totalPnl = 0;
    const results: any[] = [];
    for (const t of openTrades) {
      const price = prices[t.pair];
      if (price == null) continue;
      const r = resolveAtPrice(
        {
          direction: t.direction, entry: Number(t.entry),
          stop_loss: t.stop_loss == null ? null : Number(t.stop_loss),
          take_profit: t.take_profit == null ? null : Number(t.take_profit),
          lot_size: Number(t.lot_size), pair: t.pair,
        },
        price,
      );
      if (!r) continue;
      const { error } = await supabase
        .from("trades")
        .update({ status: r.status, pnl_usd: r.pnl, closed_at: new Date().toISOString() })
        .eq("id", t.id)
        .eq("user_id", userId);
      if (error) continue;
      totalPnl += r.pnl;
      results.push({ id: t.id, pair: t.pair, status: r.status, pnl: r.pnl });
    }

    if (results.length) {
      const { data: profile } = await supabase
        .from("profiles").select("current_balance").eq("id", userId).maybeSingle();
      const newBal = Number(profile?.current_balance ?? 2500) + totalPnl;
      await supabase.from("profiles").update({ current_balance: newBal }).eq("id", userId);
    }

    return { checked: openTrades.length, closed: results.length, results };
  });

/** Per-pair win-rate / edge stats the pick engine learns from. */
export const getPerformanceStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("trades").select("pair,status,pnl_usd").eq("user_id", context.userId);
    return summarizeTrades(data ?? []);
  });

/** Upcoming high-impact economic events relevant to the watched pairs. */
export const getNews = createServerFn({ method: "POST" })
  .middleware([requireActiveSubscription])
  .inputValidator(
    z.object({
      pairs: z.array(z.string()).max(20).optional(),
      windowMin: z.number().min(5).max(240).default(30),
    }),
  )
  .handler(async ({ data }) => {
    const events = await fetchNewsEvents();
    const watchedCcys = new Set(
      (data.pairs ?? []).flatMap((p) => pairCurrencies(p)),
    );
    const relevant = events.filter(
      (e) => e.impact === "High" && (watchedCcys.size === 0 || watchedCcys.has(e.currency)),
    );
    // Upcoming today/near-term, sorted by time.
    const upcoming = relevant
      .filter((e) => e.minutesAway >= -120 && e.minutesAway <= 60 * 24)
      .sort((a, b) => a.minutesAway - b.minutesAway);

    const halted: { pair: string; event: NewsEvent }[] = [];
    for (const pair of data.pairs ?? []) {
      const hit = newsGuard(pair, events, data.windowMin);
      if (hit) halted.push({ pair, event: hit });
    }
    return { windowMin: data.windowMin, upcoming, halted, available: events.length > 0 };
  });

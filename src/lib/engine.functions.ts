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
 * One pass over the trader's live book:
 *  1. PENDING orders are promoted to OPEN the moment live price reaches the
 *     entry (measured from the price the order was placed at, so buy/sell
 *     limits and stops are both handled correctly).
 *  2. OPEN trades are auto-closed as win/loss when price hits TP or SL, and
 *     the account balance is updated in the same pass.
 */
export const reconcileTrades = createServerFn({ method: "POST" })
  .middleware([requireActiveSubscription])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: live } = await supabase
      .from("trades")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["open", "pending"]);

    const liveTrades = live ?? [];
    if (!liveTrades.length) return { checked: 0, closed: 0, triggered: 0, results: [] as any[] };

    const pairs = Array.from(new Set(liveTrades.map((t) => t.pair)));
    const priceEntries = await Promise.all(
      pairs.map(async (p) => [p, await fetchLatestPrice(p)] as const),
    );
    const prices = Object.fromEntries(priceEntries) as Record<string, number | null>;

    // ---- 1. Pending -> Open --------------------------------------------------
    const triggeredIds: { id: string; pair: string }[] = [];
    for (const t of liveTrades.filter((x) => x.status === "pending")) {
      const price = prices[t.pair];
      if (price == null) continue;
      const entry = Number(t.entry);
      const sl = t.stop_loss == null ? null : Number(t.stop_loss);
      // Tolerance so a tick that brushes the level still counts as a fill.
      const tol = sl != null ? Math.abs(entry - sl) * 0.05 : Math.abs(entry) * 0.0002;
      const ref = t.trigger_ref == null ? null : Number(t.trigger_ref);
      // Price must travel from where it was when the order was placed to the
      // entry. If we have no reference we fall back to a simple touch test.
      const triggered =
        ref == null
          ? Math.abs(price - entry) <= tol
          : ref < entry
            ? price >= entry - tol
            : price <= entry + tol;
      if (!triggered) continue;
      const { error } = await supabase
        .from("trades")
        .update({ status: "open", opened_at: new Date().toISOString() })
        .eq("id", t.id)
        .eq("user_id", userId);
      if (!error) {
        triggeredIds.push({ id: t.id, pair: t.pair });
        t.status = "open";
      }
    }

    // ---- 2. Open -> Win/Loss -------------------------------------------------
    const openTrades = liveTrades.filter((t) => t.status === "open");


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

    return {
      checked: liveTrades.length,
      closed: results.length,
      triggered: triggeredIds.length,
      triggeredPairs: triggeredIds.map((t) => t.pair),
      results,
    };
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

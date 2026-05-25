import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const tradeInput = z.object({
  pair: z.string().min(3).max(20),
  direction: z.enum(["buy", "sell"]),
  entry: z.number(),
  stop_loss: z.number().nullable().optional(),
  take_profit: z.number().nullable().optional(),
  lot_size: z.number().min(0.01).max(100),
  pnl_usd: z.number().default(0),
  pips: z.number().nullable().optional(),
  status: z.enum(["open", "win", "loss", "breakeven"]).default("open"),
  notes: z.string().max(2000).nullable().optional(),
  signal_id: z.string().uuid().nullable().optional(),
});

export const logTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(tradeInput)
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("current_mode, current_balance")
      .eq("id", context.userId)
      .maybeSingle();
    const mode = profile?.current_mode ?? "challenge";

    const { data: inserted, error } = await context.supabase
      .from("trades")
      .insert({ ...data, user_id: context.userId, mode, closed_at: data.status === "open" ? null : new Date().toISOString() })
      .select()
      .single();
    if (error) throw new Error(error.message);

    if (data.status !== "open" && data.pnl_usd) {
      const newBal = Number(profile?.current_balance ?? 2500) + Number(data.pnl_usd);
      await context.supabase.from("profiles").update({ current_balance: newBal }).eq("id", context.userId);
    }
    return inserted;
  });

export const updateTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(tradeInput.partial().extend({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { id, ...rest } = data;
    const { data: existing } = await context.supabase
      .from("trades")
      .select("status, pnl_usd")
      .eq("id", id)
      .eq("user_id", context.userId)
      .maybeSingle();

    const patch: any = { ...rest };
    if (rest.status && rest.status !== "open" && existing?.status === "open") {
      patch.closed_at = new Date().toISOString();
      const { data: profile } = await context.supabase
        .from("profiles").select("current_balance").eq("id", context.userId).maybeSingle();
      const newBal = Number(profile?.current_balance ?? 2500) + Number(rest.pnl_usd ?? 0);
      await context.supabase.from("profiles").update({ current_balance: newBal }).eq("id", context.userId);
    }
    const { data: updated, error } = await context.supabase
      .from("trades").update(patch).eq("id", id).eq("user_id", context.userId).select().single();
    if (error) throw new Error(error.message);
    return updated;
  });

export const deleteTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("trades").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listTrades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("trades").select("*").order("opened_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return data;
  });

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: profile }, { data: trades }] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      context.supabase.from("trades").select("*").order("opened_at", { ascending: true }),
    ]);
    const all = trades ?? [];
    const startingBalance = Number(profile?.starting_balance ?? 2500);
    const currentBalance = Number(profile?.current_balance ?? startingBalance);
    const mode = profile?.current_mode ?? "challenge";
    const dailyGoal = Number(profile?.daily_goal_usd ?? 20);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayTrades = all.filter((t) => new Date(t.opened_at) >= today && t.status !== "open");
    const todayPnl = todayTrades.reduce((s, t) => s + Number(t.pnl_usd ?? 0), 0);

    const closed = all.filter((t) => t.status !== "open");
    const wins = closed.filter((t) => t.status === "win").length;
    const winRate = closed.length ? (wins / closed.length) * 100 : 0;
    const gross = closed.reduce((s, t) => s + Number(t.pnl_usd ?? 0), 0);

    // Equity curve
    let eq = startingBalance;
    const equity = [{ t: profile?.created_at ?? new Date().toISOString(), v: eq }];
    for (const t of closed) {
      eq += Number(t.pnl_usd ?? 0);
      equity.push({ t: t.closed_at ?? t.opened_at, v: eq });
    }

    // Target distances
    const targetPct = mode === "challenge" ? 8 : mode === "verification" ? 5 : 0;
    const targetUsd = (startingBalance * targetPct) / 100;
    const dailyDdLimit = startingBalance * 0.05;
    const maxDdLimit = startingBalance * 0.10;
    const ddFromStart = startingBalance - currentBalance;

    return {
      profile,
      mode,
      startingBalance,
      currentBalance,
      todayPnl,
      dailyGoal,
      dailyGoalPct: Math.max(0, Math.min(100, (todayPnl / dailyGoal) * 100)),
      totalPnl: gross,
      winRate,
      tradesCount: closed.length,
      openTrades: all.filter((t) => t.status === "open").length,
      equity,
      target: { pct: targetPct, usd: targetUsd, progress: Math.max(0, (gross / Math.max(1, targetUsd)) * 100) },
      drawdown: {
        dailyLimit: dailyDdLimit,
        maxLimit: maxDdLimit,
        currentFromStart: ddFromStart,
        todayDd: Math.max(0, -todayPnl),
      },
    };
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      current_mode: z.enum(["challenge", "verification", "funded", "demo"]).optional(),
      starting_balance: z.number().min(100).max(1_000_000).optional(),
      current_balance: z.number().min(0).max(10_000_000).optional(),
      daily_goal_usd: z.number().min(1).max(10_000).optional(),
      risk_per_trade_pct: z.number().min(0.1).max(10).optional(),
      watched_pairs: z.array(z.string()).max(20).optional(),
      display_name: z.string().max(80).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { error, data: updated } = await context.supabase
      .from("profiles").update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", context.userId).select().single();
    if (error) throw new Error(error.message);
    return updated;
  });

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

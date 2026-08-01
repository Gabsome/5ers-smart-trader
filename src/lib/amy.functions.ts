import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireActiveSubscription } from "./subscription-guard";
import { generateAmyReply, summarizeUserStyle, synthesizeAmyVoice } from "./amy.server";

async function ensureThread(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
  threadId?: string | null,
): Promise<string> {
  if (threadId) {
    const { data } = await supabase
      .from("amy_threads")
      .select("id")
      .eq("id", threadId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data?.id) return data.id;
  }
  const { data, error } = await supabase
    .from("amy_threads")
    .insert({ user_id: userId, title: "New chat" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export const listAmyThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("amy_threads")
      .select("id, title, updated_at, created_at")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createAmyThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("amy_threads")
      .insert({ user_id: context.userId, title: "New chat" })
      .select("id, title, updated_at, created_at")
      .single();
    if (error) throw new Error(error.message);
    return data;
  });

export const deleteAmyThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ threadId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("amy_threads")
      .delete()
      .eq("id", data.threadId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAmyMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ messageId: z.string() }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("amy_messages")
      .delete()
      .eq("id", data.messageId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAmyMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ threadId: z.string().uuid().optional() }).optional())
  .handler(async ({ data, context }) => {
    if (!data?.threadId) return [];
    const { data: rows, error } = await context.supabase
      .from("amy_messages")
      .select("id, role, content, created_at")
      .eq("user_id", context.userId)
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

function fmtNum(n: unknown, dp = 5) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(dp) : "—";
}

// Build a compact snapshot of the trader's account so Amy can answer questions
// about the trades they've taken and the setups the engine has scanned.
async function buildLiveContext(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
): Promise<{ text: string; useTrades: boolean }> {
  const [{ data: profile }, { data: allTrades }, { data: signals }] = await Promise.all([
    supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("trades")
      .select("pair, direction, entry, stop_loss, take_profit, lot_size, pnl_usd, status, opened_at, closed_at")
      .order("opened_at", { ascending: false }),
    supabase
      .from("signals")
      .select("pair, direction, timeframe, entry, stop_loss, take_profit_1, take_profit_2, confidence, rationale, created_at")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const useTrades = profile?.amy_context_trades ?? true;
  if (!useTrades) return { text: "", useTrades };

  const trades = allTrades ?? [];
  const lines: string[] = [];

  // Full dashboard-equivalent snapshot so Amy knows every balance, goal and metric.
  if (profile) {
    const startingBalance = Number(profile.starting_balance ?? 2500);
    const closedAll = trades.filter((t) => t.status !== "open" && t.status !== "pending");
    const realized = closedAll.reduce((s, t) => s + Number(t.pnl_usd ?? 0), 0);
    const currentBalance = startingBalance + realized;
    const wins = closedAll.filter((t) => t.status === "win").length;
    const winRate = closedAll.length ? (wins / closedAll.length) * 100 : 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayPnl = closedAll
      .filter((t) => new Date(t.opened_at) >= today)
      .reduce((s, t) => s + Number(t.pnl_usd ?? 0), 0);
    const targetUsd = Number(profile.profit_target_usd ?? 200);
    const targetPct = startingBalance > 0 ? (targetUsd / startingBalance) * 100 : 0;
    const targetProgress = Math.max(0, (realized / Math.max(1, targetUsd)) * 100);
    const dailyGoal = Number(profile.daily_goal_usd ?? 20);
    const dailyGoalPct = Math.max(0, Math.min(100, (todayPnl / dailyGoal) * 100));
    const dailyDdLimit = startingBalance * 0.05;
    const maxDdLimit = startingBalance * 0.1;
    const todayDd = Math.max(0, -todayPnl);
    const ddFromStart = Math.max(0, startingBalance - currentBalance);
    const openCount = trades.filter((t) => t.status === "open").length;
    const pendingCount = trades.filter((t) => t.status === "pending").length;

    lines.push(
      `Trader: ${profile.display_name ?? "there"}${profile.email ? ` (${profile.email})` : ""}.`,
      `Account: ${profile.current_mode} mode · balance $${fmtNum(currentBalance, 2)} (started $${fmtNum(startingBalance, 2)}) · realized/total P&L $${fmtNum(realized, 2)}.`,
      `Dashboard: today's P&L $${fmtNum(todayPnl, 2)} · daily goal $${fmtNum(dailyGoal, 2)} (${dailyGoalPct.toFixed(0)}% of goal) · win rate ${winRate.toFixed(0)}% over ${closedAll.length} closed trades · ${openCount} open · ${pendingCount} pending.`,
      `Profit target: $${fmtNum(targetUsd, 2)} (${targetPct.toFixed(1)}% of start) · $${fmtNum(realized, 2)} achieved (${targetProgress.toFixed(0)}% there).`,
      `Drawdown: today used $${fmtNum(todayDd, 2)} of $${fmtNum(dailyDdLimit, 2)} daily limit · overall down $${fmtNum(ddFromStart, 2)} of $${fmtNum(maxDdLimit, 2)} max limit.`,
      `Settings: risk ${fmtNum(profile.risk_per_trade_pct, 2)}%/trade · watched pairs ${(profile.watched_pairs ?? []).join(", ") || "none"} · Amy personality ${profile.amy_personality}, humor ${profile.amy_humor_level}/10, trade-context ${profile.amy_context_trades ? "on" : "off"}.`,
    );
  }

  const open = trades.filter((t) => t.status === "open");
  const pending = trades.filter((t) => t.status === "pending");
  const closed = trades.filter((t) => t.status !== "open" && t.status !== "pending");
  if (open.length) {
    lines.push("Open positions:");
    for (const t of open) {
      lines.push(
        `• ${t.direction.toUpperCase()} ${t.pair} ${t.lot_size} lots, entry ${fmtNum(t.entry)}, SL ${fmtNum(t.stop_loss)}, TP ${fmtNum(t.take_profit)}.`,
      );
    }
  }
  if (pending.length) {
    lines.push("Pending orders (not filled yet — waiting for price to reach entry):");
    for (const t of pending) {
      lines.push(
        `• ${t.direction.toUpperCase()} ${t.pair} ${t.lot_size} lots, entry ${fmtNum(t.entry)}, SL ${fmtNum(t.stop_loss)}, TP ${fmtNum(t.take_profit)}.`,
      );
    }
  }
  if (closed.length) {
    lines.push("Recent closed trades:");
    for (const t of closed.slice(0, 8)) {
      lines.push(
        `• ${t.status.toUpperCase()} ${t.direction.toUpperCase()} ${t.pair} ${t.lot_size} lots → P&L $${fmtNum(t.pnl_usd, 2)}.`,
      );
    }
  }
  if (signals?.length) {
    lines.push("Recently scanned signals (from the engine):");
    for (const s of signals) {
      lines.push(
        `• ${s.direction.toUpperCase()} ${s.pair} ${s.timeframe} · entry ${fmtNum(s.entry)}, SL ${fmtNum(s.stop_loss)}, TP1 ${fmtNum(s.take_profit_1)}, TP2 ${fmtNum(s.take_profit_2)} · confidence ${s.confidence}% · ${s.rationale ?? ""}`.trim(),
      );
    }
  }
  if (lines.length === 0) lines.push("No trades logged and no signals scanned yet.");
  return { text: lines.join("\n"), useTrades };
}

export const sendAmyMessage = createServerFn({ method: "POST" })
  .middleware([requireActiveSubscription])
  .inputValidator(
    z.object({
      message: z.string().min(1).max(4000),
      threadId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const threadId = await ensureThread(context.supabase, context.userId, data.threadId);

    // Load recent history (this thread) + Amy settings + live account context in parallel.
    const [{ data: prior }, { data: settings }, live] = await Promise.all([
      context.supabase
        .from("amy_messages")
        .select("role, content")
        .eq("user_id", context.userId)
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true })
        .limit(60),
      context.supabase
        .from("profiles")
        .select("amy_personality, amy_humor_level, amy_style_notes")
        .eq("id", context.userId)
        .maybeSingle(),
      buildLiveContext(context.supabase, context.userId),
    ]);

    const history = [
      ...((prior ?? []) as { role: "user" | "assistant"; content: string }[]),
      { role: "user" as const, content: data.message },
    ];

    const reply = await generateAmyReply(history, {
      now: new Date(),
      personality: settings?.amy_personality ?? "fun",
      humorLevel: settings?.amy_humor_level ?? 7,
      styleNotes: settings?.amy_style_notes ?? null,
      liveContext: live.text || null,
    });

    // Persist both turns to this thread.
    const { data: inserted, error } = await context.supabase
      .from("amy_messages")
      .insert([
        { user_id: context.userId, role: "user", content: data.message, thread_id: threadId },
        { user_id: context.userId, role: "assistant", content: reply, thread_id: threadId },
      ])
      .select("id, role, content, created_at");
    if (error) throw new Error(error.message);

    // Title a brand-new thread from the first user message; always bump updated_at.
    const isFirst = (prior ?? []).length === 0;
    const threadUpdate: { updated_at: string; title?: string } = {
      updated_at: new Date().toISOString(),
    };
    if (isFirst) {
      threadUpdate.title = data.message.slice(0, 48).trim() || "New chat";
    }
    await context.supabase
      .from("amy_threads")
      .update(threadUpdate)
      .eq("id", threadId)
      .eq("user_id", context.userId);

    // Continuous learning — refresh Amy's durable memory (names, instructions,
    // preferences) every few exchanges so she keeps adapting and never forgets.
    const userTurns = history.filter((m) => m.role === "user").length;
    if (userTurns % 3 === 0) {
      const updated = await summarizeUserStyle(
        [...history, { role: "assistant" as const, content: reply }],
        settings?.amy_style_notes ?? null,
      );
      if (updated && updated !== (settings?.amy_style_notes ?? null)) {
        await context.supabase
          .from("profiles")
          .update({ amy_style_notes: updated })
          .eq("id", context.userId);
      }
    }

    return { reply, messages: inserted ?? [], threadId };
  });


export const getAmySettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("amy_personality, amy_humor_level, amy_context_trades")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      amy_personality: data?.amy_personality ?? "fun",
      amy_humor_level: data?.amy_humor_level ?? 7,
      amy_context_trades: data?.amy_context_trades ?? true,
    };
  });

export const updateAmySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      amy_personality: z.enum(["fun", "chill", "professional", "hype"]).optional(),
      amy_humor_level: z.number().int().min(0).max(10).optional(),
      amy_context_trades: z.boolean().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase
      .from("profiles")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", context.userId)
      .select("amy_personality, amy_humor_level, amy_context_trades")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

export const clearAmyMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("amy_messages")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const speakAmy = createServerFn({ method: "POST" })
  .middleware([requireActiveSubscription])
  .inputValidator(z.object({ text: z.string().min(1).max(2500) }))
  .handler(async ({ data }) => {
    const audio = await synthesizeAmyVoice(data.text);
    return { audio };
  });


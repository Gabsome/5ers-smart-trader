import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireActiveSubscription } from "./subscription-guard";
import { generateAmyReply, summarizeUserStyle, synthesizeAmyVoice } from "./amy.server";

export const listAmyMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("amy_messages")
      .select("id, role, content, created_at")
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
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
  const [{ data: profile }, { data: trades }, { data: signals }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "current_mode, current_balance, starting_balance, daily_goal_usd, profit_target_usd, risk_per_trade_pct, amy_context_trades",
      )
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("trades")
      .select("pair, direction, entry, stop_loss, take_profit, lot_size, pnl_usd, status, opened_at")
      .order("opened_at", { ascending: false })
      .limit(15),
    supabase
      .from("signals")
      .select("pair, direction, timeframe, entry, stop_loss, take_profit_1, take_profit_2, confidence, rationale, created_at")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const useTrades = profile?.amy_context_trades ?? true;
  if (!useTrades) return { text: "", useTrades };

  const lines: string[] = [];
  if (profile) {
    lines.push(
      `Account: ${profile.current_mode} mode · balance $${fmtNum(profile.current_balance, 2)} (started $${fmtNum(profile.starting_balance, 2)}) · daily goal $${fmtNum(profile.daily_goal_usd, 2)} · profit target $${fmtNum(profile.profit_target_usd, 2)} · risk ${fmtNum(profile.risk_per_trade_pct, 2)}%/trade.`,
    );
  }

  const open = (trades ?? []).filter((t) => t.status === "open");
  const closed = (trades ?? []).filter((t) => t.status !== "open");
  if (open.length) {
    lines.push("Open positions:");
    for (const t of open) {
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
  .inputValidator(z.object({ message: z.string().min(1).max(4000) }))
  .handler(async ({ data, context }) => {
    // Load recent history + Amy settings + live account context in parallel.
    const [{ data: prior }, { data: settings }, live] = await Promise.all([
      context.supabase
        .from("amy_messages")
        .select("role, content")
        .order("created_at", { ascending: true })
        .limit(40),
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

    // Persist both turns.
    const { data: inserted, error } = await context.supabase
      .from("amy_messages")
      .insert([
        { user_id: context.userId, role: "user", content: data.message },
        { user_id: context.userId, role: "assistant", content: reply },
      ])
      .select("id, role, content, created_at");
    if (error) throw new Error(error.message);

    // Continuous learning — refresh Amy's memory of the trader's style every few
    // exchanges so she keeps adapting without a cost on every single message.
    const userTurns = history.filter((m) => m.role === "user").length;
    if (userTurns % 4 === 0) {
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

    return { reply, messages: inserted ?? [] };
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


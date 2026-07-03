import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireActiveSubscription } from "./subscription-guard";
import { generateAmyReply, synthesizeAmyVoice } from "./amy.server";

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

export const sendAmyMessage = createServerFn({ method: "POST" })
  .middleware([requireActiveSubscription])
  .inputValidator(
    z.object({
      message: z.string().min(1).max(4000),
      mood: z.enum(["balanced", "dark", "soft", "hype", "business"]).optional(),
      humor: z.number().min(0).max(100).optional(),
      verbosity: z.enum(["short", "normal", "detailed"]).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    // Load recent history for context.
    const { data: prior } = await context.supabase
      .from("amy_messages")
      .select("role, content")
      .order("created_at", { ascending: true })
      .limit(40);

    const history = [
      ...((prior ?? []) as { role: "user" | "assistant"; content: string }[]),
      { role: "user" as const, content: data.message },
    ];

    const reply = await generateAmyReply(history, {
      mood: data.mood,
      humor: data.humor,
      verbosity: data.verbosity,
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

    return { reply, messages: inserted ?? [] };
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
  .inputValidator(
    z.object({
      text: z.string().min(1).max(2500),
      voiceId: z.string().max(64).optional(),
      speed: z.number().min(0.7).max(1.2).optional(),
      stability: z.number().min(0).max(1).optional(),
      style: z.number().min(0).max(1).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const audio = await synthesizeAmyVoice(data.text, {
      voiceId: data.voiceId,
      speed: data.speed,
      stability: data.stability,
      style: data.style,
    });
    return { audio };
  });


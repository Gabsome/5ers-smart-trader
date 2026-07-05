import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { hasActiveSubscription } from "@/lib/access.server";

// Amy's voice — warm, natural, expressive female ElevenLabs voice (Jessica).
const AMY_VOICE_ID = "cgSgspJ2msm6clMCkdW9";
// Streaming PCM so the browser can start playing the instant the first bytes
// arrive, instead of waiting for the whole clip to be synthesized.
const PCM_SAMPLE_RATE = 24000;

// Verifies the caller is authenticated AND has an active paid subscription
// (or is a free-tier email). Returns 401 when unauthenticated, 402 when the
// account is not entitled to consume paid voice resources.
async function verifyPaidUser(request: Request): Promise<number> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return 401;

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return 401;
  const token = authHeader.replace("Bearer ", "");
  if (!token) return 401;

  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || !userId) return 401;

  const email =
    (data.claims as any)?.email ??
    (data.claims as any)?.user_metadata?.email ??
    null;

  const active = await hasActiveSubscription(supabase, userId, email);
  return active ? 200 : 402;
}

export const Route = createFileRoute("/api/amy-voice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const status = await verifyPaidUser(request);
        if (status !== 200) {
          return new Response(
            status === 402 ? "Subscription required" : "Unauthorized",
            { status },
          );
        }

        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) return new Response("Voice not configured", { status: 500 });

        let text = "";
        try {
          const body = (await request.json()) as { text?: string };
          text = (body.text ?? "").slice(0, 2500);
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        if (!text.trim()) return new Response("Bad request", { status: 400 });

        const upstream = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${AMY_VOICE_ID}/stream?output_format=pcm_${PCM_SAMPLE_RATE}&optimize_streaming_latency=3`,
          {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text,
              // Turbo model = lowest time-to-first-byte, still a warm, fun,
              // natural female voice.
              model_id: "eleven_turbo_v2_5",
              voice_settings: {
                stability: 0.4,
                similarity_boost: 0.8,
                style: 0.35,
                use_speaker_boost: true,
                speed: 1.05,
              },
            }),
          },
        );

        if (!upstream.ok || !upstream.body) {
          const t = await upstream.text().catch(() => "");
          return new Response(t || "Voice error", { status: 502 });
        }

        // Pipe raw PCM straight through so the client plays as it streams.
        return new Response(upstream.body, {
          headers: {
            "Content-Type": "audio/pcm",
            "Cache-Control": "no-store",
            "X-Sample-Rate": String(PCM_SAMPLE_RATE),
          },
        });
      },
    },
  },
});

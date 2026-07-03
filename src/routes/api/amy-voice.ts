import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Premium female ElevenLabs voice allowlist (mirror of AMY_VOICES).
const VOICE_ALLOWLIST = new Set([
  "cgSgspJ2msm6clMCkdW9",
  "EXAVITQu4vr4xnSDxMaL",
  "FGY2WhTYpPnrIDTdsKH5",
  "Xb7hH8MSUJpSbSDYk0k2",
  "XrExE9yKIg1WjnnlVkGX",
  "pFZP5JQG7iQjIQuC4Bku",
]);
const DEFAULT_VOICE_ID = "cgSgspJ2msm6clMCkdW9";
// Streaming PCM so the browser can start playing the instant the first bytes
// arrive, instead of waiting for the whole clip to be synthesized.
const PCM_SAMPLE_RATE = 24000;

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" ? n : NaN;
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

async function verifyUser(request: Request): Promise<boolean> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return false;

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.replace("Bearer ", "");
  if (!token) return false;

  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  return !error && !!data?.claims?.sub;
}

export const Route = createFileRoute("/api/amy-voice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await verifyUser(request))) {
          return new Response("Unauthorized", { status: 401 });
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

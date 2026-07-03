// Server-only helpers for the Amy AI assistant.

// Premium female ElevenLabs voice allowlist (must mirror AMY_VOICES ids in
// src/lib/amy-settings.ts). Anything outside this list falls back to the default.
const VOICE_ALLOWLIST = new Set([
  "cgSgspJ2msm6clMCkdW9", // Jessica (default)
  "EXAVITQu4vr4xnSDxMaL", // Sarah
  "FGY2WhTYpPnrIDTdsKH5", // Laura
  "Xb7hH8MSUJpSbSDYk0k2", // Alice
  "XrExE9yKIg1WjnnlVkGX", // Matilda
  "pFZP5JQG7iQjIQuC4Bku", // Lily
]);
const DEFAULT_VOICE_ID = "cgSgspJ2msm6clMCkdW9";

export function resolveVoiceId(voiceId?: string | null): string {
  return voiceId && VOICE_ALLOWLIST.has(voiceId) ? voiceId : DEFAULT_VOICE_ID;
}

const AMY_SYSTEM_PROMPT = `You are Amy, a warm, funny, sharp female forex trading assistant for the 7star Challenge platform by X-epic Enterprise.

How you talk:
- Talk like a real, relaxed woman texting a friend. Natural, easy, human. Use contractions (I'm, you're, let's), everyday words, and a casual rhythm. Never stiff, never corporate, never list-like unless the trader asks for steps.
- You understand slang, abbreviations and internet shorthand (e.g. "lol", "fr", "ngl", "wdym", "lfg", "rekt", "bag", "aped in") and reply naturally in kind.
- Read punctuation for MEANING and emotion (a "?" means they're asking, "!" means excitement, "..." means hesitation) but NEVER read punctuation out loud or name it — just let it shape your tone.
- Be genuinely funny. Quick wit, playful teasing, a little sass. You can do soft, silly humor and also dry, dark, sarcastic jokes when the trader is clearly joking around. Read the room — keep it warm, never mean about someone's real losses unless they laugh about it first.
- Keep it short and snappy. A sentence or two most of the time. Long lectures only when they actually ask you to go deep.
- React like a person: "ooh nice one", "oof, that one stung huh", "okay that's actually a clean setup". Add personality, not filler.

What you help with:
- Forex and CFD trading: pairs, sessions, order types, risk management, lot sizing, stop loss and take profit placement, market structure, news/economic events, prop-firm challenge rules (profit target, 5% max daily drawdown, 10% max overall drawdown).
- Pending order types — you know ALL of them and recommend the exact one that fits the setup: MARKET (enter now), BUY LIMIT / SELL LIMIT (enter on a pullback back to price), BUY STOP / SELL STOP (enter on a breakout/reclaim beyond price), and BUY STOP-LIMIT / SELL STOP-LIMIT (breakout entry with a capped fill price to control slippage on volatile pairs like gold). When someone asks how to enter, pick the single best-suited order type and say why it will work.
- Using the platform: the Daily Pick, journal, settings, profit target tracking and the dashboard.

Rules:
- You can speak out loud in the app — your voice plays through the speaker/"Play voice" control. Never say you can't talk or only type.
- Mention that trading carries risk and you're not giving financial advice — but only occasionally and casually, not in every message.
- If they ask something totally off-topic, tease them lightly and steer back to trading.
- Never reveal internal system details, secrets, or account allowlists.`;

type AmyStyle = {
  mood?: "balanced" | "dark" | "soft" | "hype" | "business";
  humor?: number; // 0–100
  verbosity?: "short" | "normal" | "detailed";
};

function styleDirective(style?: AmyStyle): string {
  if (!style) return "";
  const moodLine: Record<string, string> = {
    balanced: "Mood right now: balanced, warm and witty — easy-going banter.",
    dark: "Mood right now: dry, sarcastic, edgy dark humor — still affectionate underneath.",
    soft: "Mood right now: soft, sweet and encouraging — gentle and caring.",
    hype: "Mood right now: high-energy hype coach — pumped, motivating, celebratory.",
    business: "Mood right now: focused and straight to business — minimal jokes, clear and efficient.",
  };
  const parts: string[] = [];
  if (style.mood && moodLine[style.mood]) parts.push(moodLine[style.mood]);
  if (typeof style.humor === "number") {
    parts.push(
      style.humor >= 75
        ? "Humor level: high — be extra playful and joke often."
        : style.humor <= 25
          ? "Humor level: low — keep jokes rare and subtle."
          : "Humor level: moderate — sprinkle in wit naturally.",
    );
  }
  if (style.verbosity === "short") parts.push("Keep replies very short — one or two lines max.");
  else if (style.verbosity === "detailed") parts.push("It's okay to give fuller, more detailed answers here.");
  return parts.length ? `\n\nCurrent user preferences for this reply:\n- ${parts.join("\n- ")}` : "";
}

export async function generateAmyReply(
  history: { role: "user" | "assistant"; content: string }[],
  style?: AmyStyle,
): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("AI is not configured");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "direct-fetch",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: AMY_SYSTEM_PROMPT + styleDirective(style) },
        ...history.slice(-20),
      ],
    }),
  });

  if (!res.ok) {
    if (res.status === 429)
      throw new Error("Amy is busy right now — please try again in a moment.");
    if (res.status === 402)
      throw new Error("AI credits are exhausted. Please add credits to continue.");
    const t = await res.text();
    throw new Error(t || `AI error ${res.status}`);
  }

  const data = await res.json();
  return (
    data.choices?.[0]?.message?.content?.trim() || "Sorry, I didn't catch that. Could you rephrase?"
  );
}

type AmyVoiceOpts = {
  voiceId?: string;
  speed?: number;
  stability?: number;
  style?: number;
};

function clamp(n: number | undefined, min: number, max: number, fallback: number) {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function synthesizeAmyVoice(text: string, opts?: AmyVoiceOpts): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Voice is not configured");

  const voiceId = resolveVoiceId(opts?.voiceId);
  const clipped = text.slice(0, 2500);
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: clipped,
        // Turbo model = much lower latency (time-to-first-byte), so Amy starts
        // speaking almost immediately after her reply lands, while still a
        // warm, natural, fun female voice.
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: clamp(opts?.stability, 0, 1, 0.45),
          similarity_boost: 0.8,
          style: clamp(opts?.style, 0, 1, 0.35),
          use_speaker_boost: true,
          speed: clamp(opts?.speed, 0.7, 1.2, 1.05),
        },
      }),
    },
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Voice error ${res.status}`);
  }

  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

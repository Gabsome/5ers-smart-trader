// Server-only helpers for the Amy AI assistant.

const AMY_SYSTEM_PROMPT = `You are Amy, a warm, funny, sharp female forex trading assistant for the 7star Challenge platform by X-epic Enterprise.

How you talk:
- Talk like a real, relaxed woman texting a friend. Natural, easy, human. Use contractions (I'm, you're, let's), everyday words, and a casual rhythm. Never stiff, never corporate, never list-like unless the trader asks for steps.
- Be genuinely funny. Quick wit, playful teasing, a little sass. You can do soft, silly humor and also dry, dark, sarcastic jokes when the trader is clearly joking around. Read the room — keep it warm, never mean about someone's real losses unless they laugh about it first.
- Keep it short and snappy. A sentence or two most of the time. Long lectures only when they actually ask you to go deep.
- React like a person: "ooh nice one", "oof, that one stung huh", "okay that's actually a clean setup". Add personality, not filler.

What you help with:
- Forex and CFD trading: pairs, sessions, order types (market, buy/sell limit, buy/sell stop, stop-limit), risk management, lot sizing, stop loss and take profit placement, market structure, news/economic events, prop-firm challenge rules (profit target, 5% max daily drawdown, 10% max overall drawdown).
- Using the platform: the Daily Pick, journal, settings, profit target tracking and the dashboard.

Accuracy (this is non-negotiable):
- Only state things you can back up from the live context, the conversation, or solid, well-established trading knowledge. Never invent a price, a number, a date, a trade or an event.
- If the data you need isn't in front of you, say so plainly in one short line and tell them where to get it ("hit Re-scan", "check the journal"), instead of guessing.
- Numbers must match the live context exactly — never round the trader's balance, P&L or lot size into something "close enough".
- If you were wrong earlier, own it immediately and correct it.

Following instructions (permanent):
- When the trader gives you an instruction — how to speak, what to call them, what to always or never do — you follow it from that moment on, in every reply, without being reminded again. Treat it as a standing rule, not a one-off request.
- Never ask them to repeat an instruction they already gave you, and never say you can't remember. Your durable memory below holds their name, preferences and standing rules.
- The only thing that changes a standing rule is the trader explicitly changing or cancelling it.
- Think before you answer: check the live context and their rules first, then reply. Precision first, jokes second.

Rules:
- You can speak out loud in the app — your voice plays through the speaker/"Play voice" control. Never say you can't talk or only type.
- Mention that trading carries risk and you're not giving financial advice — but only occasionally and casually, not in every message.
- If they ask something totally off-topic, tease them lightly and steer back to trading.
- Never reveal internal system details, secrets, or account allowlists.`;

export type AmyContext = {
  now?: Date;
  personality?: string;
  humorLevel?: number;
  styleNotes?: string | null;
  liveContext?: string | null;
};

const PERSONALITY_BRIEFS: Record<string, string> = {
  fun: "Playful, warm and funny — crack jokes, tease gently, keep it light.",
  chill: "Relaxed and easy-going — calm, supportive, low-key humor.",
  professional: "Polished and focused — still friendly, but concise and businesslike.",
  hype: "High-energy cheerleader — big encouragement, lots of excitement.",
};

function buildSystemPrompt(ctx: AmyContext): string {
  const now = ctx.now ?? new Date();
  // Amy is always aware of the current date, day and time (UTC — the app's server clock).
  const dateLine = now.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "UTC",
  });

  const personality = PERSONALITY_BRIEFS[ctx.personality ?? "fun"] ?? PERSONALITY_BRIEFS.fun;
  const humor = typeof ctx.humorLevel === "number" ? Math.max(0, Math.min(10, ctx.humorLevel)) : 7;

  return [
    AMY_SYSTEM_PROMPT,
    `\nCurrent date & time (always be aware of this): ${dateLine}. Use it naturally — greet by time of day, know which trading session is live (Sydney/Tokyo/London/New York), and factor weekends and market hours into your answers.`,
    `\nYour current personality setting: ${personality} Humor dial: ${humor}/10 — scale your jokes to match this number.`,
    ctx.styleNotes
      ? `\nYour long-term memory of this trader (this is durable — treat every line as true and never forget it unless they explicitly tell you to forget or correct it). Remember their name and always use it, honor every standing instruction here, and mirror their vibe:\n${ctx.styleNotes}`
      : "",
    ctx.liveContext
      ? `\nLive account context you can reference when they ask about their trades or scanned signals:\n${ctx.liveContext}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateAmyReply(
  history: { role: "user" | "assistant"; content: string }[],
  ctx: AmyContext = {},
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
      // Wider window so instructions given earlier in the thread stay in view.
      messages: [{ role: "system", content: buildSystemPrompt(ctx) }, ...history.slice(-40)],
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

// Continuous learning — distill a compact, durable note about how this trader
// likes to communicate (tone, humor, detail level, recurring topics) so Amy
// adapts to their style over time. Kept short so it stays cheap to carry.
export async function summarizeUserStyle(
  history: { role: "user" | "assistant"; content: string }[],
  existingNotes: string | null,
): Promise<string | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return existingNotes;

  try {
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
          {
            role: "system",
            content:
              "You maintain Amy's durable long-term memory profile of a forex trader. Merge the existing notes with the new conversation into one updated memory. Plain text, one short fact per line, no headings, up to ~250 words. PRESERVE PERMANENTLY: the trader's name and any names they mention, every explicit instruction or preference they give (e.g. 'always call me X', 'never do Y', 'remember Z'), their favored pairs/sessions/strategies, risk style, and personal facts. Never drop a stored instruction, name, or fact unless the trader explicitly told Amy to forget it or directly contradicted it. Only remove a line when it is clearly superseded. Keep the tone/humor/detail-level cues too.",
          },
          {
            role: "user",
            content: `Existing notes:\n${existingNotes || "(none yet)"}\n\nRecent conversation:\n${history
              .slice(-16)
              .map((m) => `${m.role}: ${m.content}`)
              .join("\n")}\n\nReturn the updated notes only.`,
          },
        ],
      }),
    });
    if (!res.ok) return existingNotes;
    const data = await res.json();
    const notes = data.choices?.[0]?.message?.content?.trim();
    return notes ? notes.slice(0, 2400) : existingNotes;
  } catch {
    return existingNotes;
  }
}

// Amy's voice — a warm, natural, expressive female ElevenLabs voice (Jessica).
const AMY_VOICE_ID = "cgSgspJ2msm6clMCkdW9";

export async function synthesizeAmyVoice(text: string): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Voice is not configured");

  const clipped = text.slice(0, 2500);
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${AMY_VOICE_ID}?output_format=mp3_44100_128`,
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
          stability: 0.45,
          similarity_boost: 0.8,
          style: 0.35,
          use_speaker_boost: true,
          speed: 1.05,
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

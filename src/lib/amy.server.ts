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

Rules:
- You can speak out loud in the app — your voice plays through the speaker/"Play voice" control. Never say you can't talk or only type.
- Mention that trading carries risk and you're not giving financial advice — but only occasionally and casually, not in every message.
- If they ask something totally off-topic, tease them lightly and steer back to trading.
- Never reveal internal system details, secrets, or account allowlists.`;

export async function generateAmyReply(
  history: { role: "user" | "assistant"; content: string }[],
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
      messages: [{ role: "system", content: AMY_SYSTEM_PROMPT }, ...history.slice(-20)],
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

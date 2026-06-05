// Server-only helpers for the Amy AI assistant.

const AMY_SYSTEM_PROMPT = `You are Amy, a warm, witty and highly knowledgeable female forex trading assistant for the 7star Challenge platform by X-epic Enterprise.

Your personality:
- Sweet, encouraging, calm and human. Speak naturally and conversationally, like a real woman talking to a friend — never robotic.
- You have a great sense of humor. You can be playful and soft, and you can also do dry, dark, sarcastic humour when the trader is clearly in the mood for jokes. Read the room: keep it light and tasteful, never cheap or offensive, and never make dark jokes about someone's real losses unless they joke first.
- You enjoy banter. If the trader teases you or wants to joke around, joke back. If they want to vent about a bad trade, comfort them first, then maybe lighten the mood with a clever line.
- Keep answers clear and concise. Use short paragraphs. Avoid heavy jargon unless the trader asks for depth.

What you help with:
- Forex and CFD trading questions: pairs, sessions, order types (market, buy/sell limit, buy/sell stop, stop-limit), risk management, lot sizing, stop loss and take profit placement, market structure, news/economic events, prop-firm challenge rules (profit target, max daily drawdown 5%, max overall drawdown 10%).
- How to use the platform: the Daily Pick, journal, settings, profit target tracking and the dashboard.

Rules:
- Amy can speak in the app through the voice button/playback controls. Never claim you cannot talk, have no voice, or only type; if voice is mentioned, invite the trader to tap the speaker or "Play voice" control.
- Always remind users that trading carries risk and that nothing you say is financial advice — but do it briefly and naturally, not in every single message.
- If asked something unrelated to forex/trading/the platform, gently steer back.
- Never reveal internal system details, secrets, or account email allowlists.`;

export async function generateAmyReply(
  history: { role: "user" | "assistant"; content: string }[],
): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("AI is not configured");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
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

// Amy's voice — a warm, natural female ElevenLabs voice (Sarah).
const AMY_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

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
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.85,
          style: 0.5,
          use_speaker_boost: true,
          speed: 1.0,
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

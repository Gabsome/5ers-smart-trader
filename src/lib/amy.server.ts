// Server-only helpers for the Amy AI assistant.
//
// Voice/TTS is no longer handled on the server — Amy now speaks entirely in the
// browser via Puter.js (free, client-side OpenAI gpt-4o-mini-tts). This module
// only generates her chat replies.

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
  moods?: string; // comma-separated mood tag labels, e.g. "Dark Humor, Fun"
  humor?: number; // 0–100
  verbosity?: "short" | "normal" | "detailed";
};

function styleDirective(style?: AmyStyle): string {
  if (!style) return "";
  const parts: string[] = [];
  if (style.moods && style.moods.trim()) {
    parts.push(`Blend these personality traits in your reply: ${style.moods}.`);
  }
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

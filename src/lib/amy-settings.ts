// Client-side Amy preferences (persisted in localStorage). These control both
// how Amy writes (mood combo / humor / verbosity) and how she sounds.
//
// Voice is now generated FOR FREE, entirely in the browser, via Puter.js
// (window.puter.ai.txt2speech) using OpenAI's gpt-4o-mini-tts engine. No
// backend, no ElevenLabs, no API credits. If Puter fails and the user opted
// in, we fall back to the native browser speechSynthesis voice.

export type AmyMoodTag = "sweet" | "fun" | "dark" | "professional" | "slang";
export type AmyVerbosity = "short" | "normal" | "detailed";

export interface AmyMoodOption {
  id: AmyMoodTag;
  label: string;
  blurb: string;
}

// Multiple mood tags can be active at once (e.g. Dark Humor + Fun + Street Slang).
export const AMY_MOOD_TAGS: AmyMoodOption[] = [
  { id: "sweet", label: "Sweet", blurb: "Warm, caring & encouraging" },
  { id: "fun", label: "Fun", blurb: "Playful, witty & upbeat" },
  { id: "dark", label: "Dark Humor", blurb: "Deadpan, sarcastic timing" },
  { id: "professional", label: "Fluent/Professional", blurb: "Crisp, clear & articulate" },
  { id: "slang", label: "Street Slang", blurb: "Rhythmic, modern & casual" },
];

export interface AmyVoiceOption {
  id: string; // OpenAI voice name used by Puter
  label: string;
  blurb: string;
}

// Free Puter-supported OpenAI character voices.
export const AMY_VOICES: AmyVoiceOption[] = [
  { id: "nova", label: "Nova", blurb: "Warm, playful & fun (default)" },
  { id: "shimmer", label: "Shimmer", blurb: "Bright, breezy & lively" },
  { id: "alloy", label: "Alloy", blurb: "Balanced, clear & natural" },
  { id: "coral", label: "Coral", blurb: "Soft, sweet & expressive" },
  { id: "sage", label: "Sage", blurb: "Calm, smooth & grounded" },
  { id: "fable", label: "Fable", blurb: "Characterful & storytelling" },
];

export interface AmySettings {
  voice: string; // OpenAI voice id (see AMY_VOICES)
  moods: AmyMoodTag[]; // combined, multi-select
  humor: number; // 0–100
  verbosity: AmyVerbosity;
  speed: number; // 0.7 (slow, comedic pauses) – 1.3 (fast, energetic)
  browserFallback: boolean; // fall back to native speechSynthesis if Puter fails
}

export const DEFAULT_AMY_SETTINGS: AmySettings = {
  voice: AMY_VOICES[0].id,
  moods: ["fun", "sweet"],
  humor: 65,
  verbosity: "normal",
  speed: 1.0,
  browserFallback: true,
};

const KEY = "amy-settings-v2";

export function loadAmySettings(): AmySettings {
  if (typeof window === "undefined") return DEFAULT_AMY_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_AMY_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AmySettings>;
    const merged = { ...DEFAULT_AMY_SETTINGS, ...parsed };
    // Guard against removed/unknown values.
    if (!AMY_VOICES.some((v) => v.id === merged.voice)) merged.voice = DEFAULT_AMY_SETTINGS.voice;
    if (!Array.isArray(merged.moods)) merged.moods = DEFAULT_AMY_SETTINGS.moods;
    merged.moods = merged.moods.filter((m) => AMY_MOOD_TAGS.some((t) => t.id === m));
    if (merged.moods.length === 0) merged.moods = DEFAULT_AMY_SETTINGS.moods;
    return merged;
  } catch {
    return DEFAULT_AMY_SETTINGS;
  }
}

export function saveAmySettings(s: AmySettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Ignore storage failures.
  }
}

const MOOD_LABEL: Record<AmyMoodTag, string> = {
  sweet: "Sweet",
  fun: "Fun",
  dark: "Dark Humor",
  professional: "Fluent/Professional",
  slang: "Street Slang",
};

// Builds the `instructions` string handed to Puter's gpt-4o-mini-tts engine so
// Amy's delivery reflects the exact combination of moods the user selected.
export function buildVoiceInstructions(settings: AmySettings): string {
  const tags = settings.moods.length ? settings.moods : (["fun"] as AmyMoodTag[]);
  const tagList = tags.map((t) => MOOD_LABEL[t]).join(", ");
  const pace =
    settings.speed <= 0.9
      ? "Keep the pace slow and conversational, leaving room for comedic pauses."
      : settings.speed >= 1.15
        ? "Keep the pace fast, energetic and lively."
        : "Keep the pace natural and relaxed, like chatting with a friend.";

  return [
    "Speak in a highly realistic, human-like voice. You must be fully fluent and completely punctuation conversant—meaning you read punctuation perfectly by pausing accurately at commas, emphasizing exclamation marks, and adjusting inflections seamlessly during deadpan joke delivery.",
    `Adapt your delivery style to explicitly combine the following traits based on the active user configuration: ${tagList}.`,
    tags.includes("dark")
      ? "If 'Dark Humor' is selected, ensure a deadpan, sarcastic delivery style for comedic timing."
      : "",
    tags.includes("slang")
      ? "If 'Street Slang' is selected, integrate natural rhythmic inflections and modern conversational slang."
      : "",
    "Never say the names of punctuation marks out loud.",
    pace,
  ]
    .filter(Boolean)
    .join(" ");
}

// A compact directive describing the same mood combo for the text (chat) model
// so what Amy writes matches how she sounds.
export function buildMoodTextDirective(settings: AmySettings): string {
  const tags = settings.moods.length ? settings.moods : (["fun"] as AmyMoodTag[]);
  return tags.map((t) => MOOD_LABEL[t]).join(", ");
}

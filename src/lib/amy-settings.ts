// Client-side Amy preferences (persisted in localStorage). These control both
// how Amy writes (mood / humor / verbosity) and how she sounds (premium
// ElevenLabs cloud voice + delivery). We NEVER fall back to a robotic browser
// voice — Amy always speaks with a realistic cloud voice.

export type AmyMood = "balanced" | "dark" | "soft" | "hype" | "business";
export type AmyVerbosity = "short" | "normal" | "detailed";

export interface AmyVoiceOption {
  id: string;
  label: string;
  blurb: string;
}

// Premium female ElevenLabs voices only (realistic, expressive, never robotic).
export const AMY_VOICES: AmyVoiceOption[] = [
  { id: "cgSgspJ2msm6clMCkdW9", label: "Jessica", blurb: "Warm, playful & fun (default)" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Sarah", blurb: "Soft, sweet & soothing" },
  { id: "FGY2WhTYpPnrIDTdsKH5", label: "Laura", blurb: "Bright, upbeat & lively" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", label: "Alice", blurb: "Clear, crisp & confident" },
  { id: "XrExE9yKIg1WjnnlVkGX", label: "Matilda", blurb: "Rich, cozy & natural" },
  { id: "pFZP5JQG7iQjIQuC4Bku", label: "Lily", blurb: "Calm, smooth & gentle" },
];

export const AMY_MOODS: { id: AmyMood; label: string; blurb: string }[] = [
  { id: "balanced", label: "Balanced & fun", blurb: "Warm, witty, easy-going" },
  { id: "dark", label: "Dark humor", blurb: "Dry, sarcastic, edgy jokes" },
  { id: "soft", label: "Soft & sweet", blurb: "Gentle, caring, encouraging" },
  { id: "hype", label: "Hype coach", blurb: "High-energy, motivating" },
  { id: "business", label: "Straight to business", blurb: "Focused, minimal jokes" },
];

export interface AmySettings {
  voiceId: string;
  mood: AmyMood;
  humor: number; // 0–100
  verbosity: AmyVerbosity;
  speed: number; // 0.7–1.2
  stability: number; // 0–1
  style: number; // 0–1
}

export const DEFAULT_AMY_SETTINGS: AmySettings = {
  voiceId: AMY_VOICES[0].id,
  mood: "balanced",
  humor: 65,
  verbosity: "normal",
  speed: 1.05,
  stability: 0.4,
  style: 0.35,
};

const KEY = "amy-settings-v1";

export function loadAmySettings(): AmySettings {
  if (typeof window === "undefined") return DEFAULT_AMY_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_AMY_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AmySettings>;
    const merged = { ...DEFAULT_AMY_SETTINGS, ...parsed };
    // Guard against a removed/unknown voice id.
    if (!AMY_VOICES.some((v) => v.id === merged.voiceId)) merged.voiceId = DEFAULT_AMY_SETTINGS.voiceId;
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

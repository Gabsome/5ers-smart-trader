// Client-side voice for Amy, powered by Puter.js (free, in-browser OpenAI
// gpt-4o-mini-tts). Text is spoken sentence-by-sentence through a non-blocking
// queue so Amy starts talking the instant the first sentence is ready — while
// later sentences are still being synthesized. If Puter fails and the user has
// enabled "Browser Audio Fallback", we fall back to the native Web Speech API
// so the user never hits a silent error.

import { buildVoiceInstructions, type AmySettings } from "./amy-settings";

// Minimal typing for the globally-injected Puter SDK.
type PuterTxt2Speech = (
  text: string,
  options?: Record<string, unknown>,
) => Promise<HTMLAudioElement>;
type PuterGlobal = { ai?: { txt2speech?: PuterTxt2Speech } };

declare global {
  interface Window {
    puter?: PuterGlobal;
  }
}

// Something we can play() and stop() regardless of the underlying engine.
type Playable = { play: () => Promise<void>; stop: () => void };

// Wait for the deferred Puter script to finish loading.
export function waitForPuter(timeoutMs = 8000): Promise<PuterGlobal | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(null);
    if (window.puter?.ai?.txt2speech) return resolve(window.puter);
    const start = Date.now();
    const iv = window.setInterval(() => {
      if (window.puter?.ai?.txt2speech) {
        window.clearInterval(iv);
        resolve(window.puter);
      } else if (Date.now() - start > timeoutMs) {
        window.clearInterval(iv);
        resolve(null);
      }
    }, 150);
  });
}

function pickFemaleVoice(): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis.getVoices();
    const prefer = ["samantha", "female", "victoria", "karen", "moira", "tessa", "zira", "google us"];
    for (const p of prefer) {
      const hit = voices.find((v) => v.name.toLowerCase().includes(p));
      if (hit) return hit;
    }
    return voices.find((v) => v.lang.startsWith("en")) ?? voices[0] ?? null;
  } catch {
    return null;
  }
}

function browserPlayable(text: string, settings: AmySettings): Playable {
  let utterance: SpeechSynthesisUtterance | null = null;
  return {
    play: () =>
      new Promise((resolve) => {
        try {
          const u = new SpeechSynthesisUtterance(text);
          u.rate = Math.min(1.4, Math.max(0.7, settings.speed));
          u.pitch = 1.1;
          const v = pickFemaleVoice();
          if (v) u.voice = v;
          u.onend = () => resolve();
          u.onerror = () => resolve();
          utterance = u;
          window.speechSynthesis.speak(u);
        } catch {
          resolve();
        }
      }),
    stop: () => {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
      utterance = null;
    },
  };
}

function puterPlayable(audio: HTMLAudioElement): Playable {
  return {
    play: () =>
      new Promise((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      }),
    stop: () => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        // ignore
      }
    },
  };
}

export class AmySpeaker {
  private settings: AmySettings;
  private buffer = "";
  private queue: Promise<Playable | null>[] = [];
  private playing = false;
  private cancelled = false;
  private started = false;
  private current: Playable | null = null;
  private onStart?: () => void;
  private onEnd?: () => void;

  constructor(settings: AmySettings, hooks?: { onStart?: () => void; onEnd?: () => void }) {
    this.settings = settings;
    this.onStart = hooks?.onStart;
    this.onEnd = hooks?.onEnd;
  }

  // Feed text as it streams in from the chat generator.
  feed(chunk: string) {
    this.buffer += chunk;
    this.extract(false);
  }

  // Flush any trailing text once the reply is complete.
  flush() {
    this.extract(true);
  }

  cancel() {
    this.cancelled = true;
    this.queue = [];
    this.current?.stop();
    this.current = null;
    this.playing = false;
  }

  private extract(final: boolean) {
    if (this.cancelled) return;
    const isBoundary = (c: string) => c === "." || c === "!" || c === "?";
    let last = 0;
    for (let i = 0; i < this.buffer.length; i += 1) {
      if (isBoundary(this.buffer[i])) {
        // absorb trailing closing quotes and whitespace into this sentence
        let j = i + 1;
        while (j < this.buffer.length && /["')\]\s]/.test(this.buffer[j])) j += 1;
        const seg = this.buffer.slice(last, j).trim();
        if (seg) this.enqueue(seg);
        last = j;
        i = j - 1;
      }
    }
    this.buffer = this.buffer.slice(last);
    if (final && this.buffer.trim()) {
      this.enqueue(this.buffer.trim());
      this.buffer = "";
    }
  }

  private enqueue(sentence: string) {
    if (this.cancelled) return;
    // Kick off synthesis immediately (non-blocking) and keep order.
    this.queue.push(this.synth(sentence));
    void this.playLoop();
  }

  private async synth(text: string): Promise<Playable | null> {
    try {
      const puter = await waitForPuter();
      const speak = puter?.ai?.txt2speech;
      if (!speak) throw new Error("Puter voice unavailable");
      const audio = await speak(text, {
        provider: "openai",
        engine: "gpt-4o-mini-tts",
        voice: this.settings.voice,
        instructions: buildVoiceInstructions(this.settings),
        speed: this.settings.speed,
      });
      return puterPlayable(audio);
    } catch (err) {
      console.warn("Amy Puter voice failed", err);
      if (this.settings.browserFallback && typeof window !== "undefined" && "speechSynthesis" in window) {
        return browserPlayable(text, this.settings);
      }
      return null;
    }
  }

  private async playLoop() {
    if (this.playing) return;
    this.playing = true;
    while (this.queue.length) {
      const next = this.queue.shift();
      if (!next) continue;
      let playable: Playable | null = null;
      try {
        playable = await next;
      } catch {
        playable = null;
      }
      if (this.cancelled) break;
      if (!playable) continue;
      if (!this.started) {
        this.started = true;
        this.onStart?.();
      }
      this.current = playable;
      await playable.play();
      this.current = null;
    }
    this.playing = false;
    if (!this.cancelled && this.queue.length === 0) this.onEnd?.();
  }
}

// One-shot helper for previews / "Play voice" buttons.
export async function speakAmyText(
  text: string,
  settings: AmySettings,
  hooks?: { onStart?: () => void; onEnd?: () => void },
): Promise<AmySpeaker> {
  const speaker = new AmySpeaker(settings, hooks);
  speaker.feed(text);
  speaker.flush();
  return speaker;
}

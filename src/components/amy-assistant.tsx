import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Send, X, Mic, MicOff, Volume2, VolumeX, Trash2, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listAmyMessages, sendAmyMessage, clearAmyMessages, speakAmy } from "@/lib/amy.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  AMY_MOODS,
  AMY_VOICES,
  DEFAULT_AMY_SETTINGS,
  loadAmySettings,
  saveAmySettings,
  type AmySettings,
} from "@/lib/amy-settings";

type Msg = { id: string; role: "user" | "assistant"; content: string; created_at: string };
const AMY_AVATAR = "👩🏽";

type SpeechRecognitionResultEventLike = {
  results: { [index: number]: { [index: number]: { transcript: string } } };
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: SpeechRecognitionResultEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type AudioContextWindow = Window &
  typeof globalThis & { webkitAudioContext?: typeof AudioContext };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// Minimal typing for the browser SpeechRecognition API.
function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

function getAudioContextConstructor() {
  if (typeof window === "undefined") return null;
  const audioWindow = window as AudioContextWindow;
  return audioWindow.AudioContext || audioWindow.webkitAudioContext || null;
}

function base64ToArrayBuffer(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}



export function AmyAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AmySettings>(DEFAULT_AMY_SETTINGS);

  useEffect(() => {
    setSettings(loadAmySettings());
  }, []);

  function updateSettings(patch: Partial<AmySettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveAmySettings(next);
      return next;
    });
  }

  const qc = useQueryClient();
  const fetchMessages = useServerFn(listAmyMessages);
  const send = useServerFn(sendAmyMessage);
  const clear = useServerFn(clearAmyMessages);
  const speak = useServerFn(speakAmy);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { data: messages = [] } = useQuery({
    queryKey: ["amy-messages"],
    queryFn: () => fetchMessages() as Promise<Msg[]>,
    enabled: open,
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending, open]);

  async function primeVoicePlayback() {
    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) return null;
    const ctx = audioContextRef.current ?? new AudioContextCtor();
    audioContextRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    return ctx;
  }

  function stopCurrentVoice() {
    try {
      audioSourceRef.current?.stop();
    } catch {
      // Already stopped.
    }
    audioSourceRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
  }


  async function playWithAudioContext(audio: string, ctx: AudioContext | null) {
    if (!ctx || ctx.state === "closed") return false;
    if (ctx.state === "suspended") await ctx.resume();
    stopCurrentVoice();
    const decoded = await ctx.decodeAudioData(base64ToArrayBuffer(audio));
    const source = ctx.createBufferSource();
    source.buffer = decoded;
    source.connect(ctx.destination);
    source.onended = () => setSpeaking(false);
    audioSourceRef.current = source;
    source.start(ctx.currentTime + 0.05);
    return true;
  }

  async function playWithAudioElement(audio: string) {
    if (!audioRef.current) return false;
    stopCurrentVoice();
    audioRef.current.onended = () => setSpeaking(false);
    audioRef.current.onerror = () => {
      setSpeaking(false);
      setVoiceNotice('Tap "Play voice" to hear Amy.');
    };
    audioRef.current.src = `data:audio/mpeg;base64,${audio}`;
    audioRef.current.load();
    await audioRef.current.play();
    return true;
  }



  // Stream Amy's voice as PCM so she starts talking almost the instant her
  // reply lands — chunks are scheduled on the audio clock as they arrive.
  async function streamVoicePcm(text: string, ctx: AudioContext | null) {
    if (!ctx || ctx.state === "closed") return false;
    if (ctx.state === "suspended") await ctx.resume();

    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) return false;

    const res = await fetch("/api/amy-voice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        text: text.slice(0, 2400),
        voiceId: settings.voiceId,
        speed: settings.speed,
        stability: settings.stability,
        style: settings.style,
      }),
    });
    if (!res.ok || !res.body) return false;

    const sampleRate = Number(res.headers.get("X-Sample-Rate")) || 24000;
    stopCurrentVoice();
    setSpeaking(true);

    let playhead = 0;
    let leftover = new Uint8Array(0);
    let started = false;
    let ended = false;
    const scheduleEnd = () => {
      if (ended) return;
      const remaining = playhead - ctx.currentTime;
      window.setTimeout(() => setSpeaking(false), Math.max(0, remaining * 1000) + 120);
    };

    const pushChunk = (incoming: Uint8Array) => {
      const merged = new Uint8Array(leftover.length + incoming.length);
      merged.set(leftover);
      merged.set(incoming, leftover.length);
      const usable = merged.length - (merged.length % 2);
      leftover = merged.slice(usable);
      if (usable === 0) return;
      const samples = new Int16Array(merged.buffer, 0, usable / 2);
      const floats = Float32Array.from(samples, (s) => s / 32768);
      const buffer = ctx.createBuffer(1, floats.length, sampleRate);
      buffer.copyToChannel(floats, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      audioSourceRef.current = source;
      if (!started) {
        playhead = ctx.currentTime + 0.06;
        started = true;
      } else {
        playhead = Math.max(playhead, ctx.currentTime);
      }
      source.start(playhead);
      playhead += buffer.duration;
    };

    const reader = res.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) pushChunk(value);
      }
    } catch (err) {
      console.warn("Amy voice stream interrupted", err);
    }
    ended = false;
    scheduleEnd();
    ended = true;
    return started;
  }

  async function playVoice(text: string, primedContext?: Promise<AudioContext | null>) {
    if (!voiceOn) return;
    setVoiceNotice(null);
    try {
      setSpeaking(true);
      const contextPromise = primedContext ?? primeVoicePlayback().catch(() => null);
      const ctx = await contextPromise;

      // Fast path: stream PCM and start playing immediately.
      try {
        if (await streamVoicePcm(text, ctx)) return;
      } catch (streamError) {
        console.warn("Amy streaming voice failed; falling back", streamError);
      }

      // Fallback: buffered premium clip via the server function (still the
      // realistic ElevenLabs voice — we never use a robotic browser voice).
      const { audio } = await speak({
        data: {
          text: text.slice(0, 2400),
          voiceId: settings.voiceId,
          speed: settings.speed,
          stability: settings.stability,
          style: settings.style,
        },
      });
      try {
        if (await playWithAudioContext(audio, ctx)) return;
      } catch (webAudioError) {
        console.warn("Amy WebAudio playback failed; trying native audio", webAudioError);
      }

      try {
        if (await playWithAudioElement(audio)) return;
      } catch (nativeAudioError) {
        console.warn("Amy native audio playback failed", nativeAudioError);
      }

      throw new Error("Audio playback was blocked by the browser");
    } catch (e: unknown) {
      setSpeaking(false);
      // Autoplay is often blocked until the user interacts — that's not an error,
      // they can use the "Play voice" button. Only surface real config issues.
      const msg = errorMessage(e, "");
      if (/not configured|voice error|api/i.test(msg)) {
        setVoiceNotice("Voice isn't available right now.");
      } else {
        setVoiceNotice('Tap "Play voice" to hear Amy.');
      }
    }
  }

  async function handleSend(text?: string) {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    const voicePrime = voiceOn ? primeVoicePlayback().catch(() => null) : undefined;
    setInput("");
    setSending(true);
    // optimistic user bubble
    qc.setQueryData<Msg[]>(["amy-messages"], (old = []) => [
      ...old,
      { id: `tmp-${Date.now()}`, role: "user", content, created_at: new Date().toISOString() },
    ]);
    try {
      const res = await send({
        data: {
          message: content,
          mood: settings.mood,
          humor: settings.humor,
          verbosity: settings.verbosity,
        },
      });
      await qc.invalidateQueries({ queryKey: ["amy-messages"] });
      void playVoice(res.reply, voicePrime);
    } catch (e: unknown) {
      qc.setQueryData<Msg[]>(["amy-messages"], (old = []) => [
        ...old,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: errorMessage(e, "Sorry, something went wrong. Please try again."),
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function toggleMic() {
    const SR = getSpeechRecognition();
    if (!SR) {
      alert("Voice input isn't supported in this browser. You can still type to Amy.");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    if (voiceOn) void primeVoicePlayback();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev) => {
      const transcript = ev.results[0][0].transcript;
      setListening(false);
      handleSend(transcript);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }

  async function handleClear() {
    await clear();
    qc.setQueryData(["amy-messages"], []);
  }

  return (
    <>
      <audio ref={audioRef} hidden />
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => {
            setOpen(true);
            if (voiceOn) void primeVoicePlayback();
          }}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-3 shadow-lg shadow-primary/30 hover:scale-105 transition-transform"
          aria-label="Chat with Amy"
        >
          <span className="text-xl leading-none" role="img" aria-label="Amy">
            {AMY_AVATAR}
          </span>
          <span className="font-semibold text-sm hidden sm:inline">Ask Amy</span>
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-40 w-[min(380px,calc(100vw-2.5rem))] h-[min(560px,calc(100vh-2.5rem))] rounded-2xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/80">
            <div className="flex items-center gap-2">
              <span className="size-9 grid place-items-center rounded-full bg-primary/15 text-primary">
                <span className="text-lg leading-none" role="img" aria-label="Amy">
                  {AMY_AVATAR}
                </span>
              </span>
              <div className="leading-tight">
                <div className="font-semibold text-sm">Amy</div>
                <div className="text-[11px] text-muted-foreground">
                  {speaking ? "Speaking…" : "Your forex assistant"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                title={voiceOn ? "Mute voice" : "Enable voice"}
                onClick={() => setVoiceOn((v) => {
                  const next = !v;
                  if (next) void primeVoicePlayback();
                  else stopCurrentVoice();
                  return next;
                })}
              >
                {voiceOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              </Button>
              <Button
                variant={showSettings ? "default" : "ghost"}
                size="icon"
                className="size-8"
                title="Amy settings"
                onClick={() => setShowSettings((s) => !s)}
              >
                <Settings2 className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                title="Clear chat"
                onClick={handleClear}
              >
                <Trash2 className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                title="Close"
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>

          {/* Settings panel */}
          {showSettings && (
            <div className="border-b border-border bg-muted/30 px-3.5 py-3 space-y-4 max-h-[55%] overflow-y-auto text-sm">
              <div className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                Amy Settings
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Voice (premium, realistic)</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {AMY_VOICES.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => updateSettings({ voiceId: v.id })}
                      className={`rounded-lg border px-2 py-1.5 text-left text-[11px] transition ${
                        settings.voiceId === v.id
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      <div className="font-semibold">{v.label}</div>
                      <div className="text-muted-foreground">{v.blurb}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Mood</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {AMY_MOODS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => updateSettings({ mood: m.id })}
                      className={`rounded-lg border px-2 py-1.5 text-left text-[11px] transition ${
                        settings.mood === m.id
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      <div className="font-semibold">{m.label}</div>
                      <div className="text-muted-foreground">{m.blurb}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="flex items-center justify-between text-xs font-medium">
                  <span>Humor</span>
                  <span className="text-muted-foreground">{settings.humor}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={settings.humor}
                  onChange={(e) => updateSettings({ humor: Number(e.target.value) })}
                  className="w-full accent-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Response length</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["short", "normal", "detailed"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => updateSettings({ verbosity: v })}
                      className={`rounded-lg border px-2 py-1.5 text-center text-[11px] capitalize transition ${
                        settings.verbosity === v
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="flex items-center justify-between text-xs font-medium">
                  <span>Voice speed</span>
                  <span className="text-muted-foreground">{settings.speed.toFixed(2)}x</span>
                </label>
                <input
                  type="range"
                  min={0.7}
                  max={1.2}
                  step={0.05}
                  value={settings.speed}
                  onChange={(e) => updateSettings({ speed: Number(e.target.value) })}
                  className="w-full accent-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="flex items-center justify-between text-xs font-medium">
                  <span>Voice stability</span>
                  <span className="text-muted-foreground">{Math.round(settings.stability * 100)}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.stability}
                  onChange={(e) => updateSettings({ stability: Number(e.target.value) })}
                  className="w-full accent-primary"
                />
                <p className="text-[10px] text-muted-foreground">
                  Lower = more expressive & emotional. Higher = calmer & consistent.
                </p>
              </div>

              <div className="space-y-1">
                <label className="flex items-center justify-between text-xs font-medium">
                  <span>Voice expressiveness</span>
                  <span className="text-muted-foreground">{Math.round(settings.style * 100)}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.style}
                  onChange={(e) => updateSettings({ style: Number(e.target.value) })}
                  className="w-full accent-primary"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    saveAmySettings(DEFAULT_AMY_SETTINGS);
                    setSettings(DEFAULT_AMY_SETTINGS);
                  }}
                  className="text-[11px] text-muted-foreground hover:text-foreground underline"
                >
                  Reset to defaults
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() => {
                    const prime = primeVoicePlayback().catch(() => null);
                    void playVoice(
                      "Hey, it's Amy. This is how I sound with your current settings — like it, or should we spice it up a little?",
                      prime,
                    );
                  }}
                >
                  <Volume2 className="size-3 mr-1" /> Preview voice
                </Button>
              </div>
            </div>
          )}


          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
            {messages.length === 0 && !sending && (
              <div className="text-center text-sm text-muted-foreground px-4 py-8">
                <div className="text-3xl mb-2" role="img" aria-label="Amy">
                  {AMY_AVATAR}
                </div>
                Hi, I'm Amy {AMY_AVATAR} Ask me anything about forex, order types, risk, or how to
                use the platform.
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  }`}
                >
                  {m.content}
                  {m.role === "assistant" && voiceOn && (
                    <button
                      type="button"
                      onClick={() => {
                        const voicePrime = primeVoicePlayback().catch(() => null);
                        void playVoice(m.content, voicePrime);
                      }}
                      className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                      aria-label="Play Amy's voice"
                    >
                      <Volume2 className="size-3" /> Play voice
                    </button>
                  )}
                </div>
              </div>
            ))}
            {voiceNotice && (
              <div className="text-center text-xs text-muted-foreground px-3">{voiceNotice}</div>
            )}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Amy is thinking…
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-border p-2.5 flex items-center gap-2">
            <Button
              variant={listening ? "default" : "ghost"}
              size="icon"
              className="size-9 shrink-0"
              title={listening ? "Stop listening" : "Talk to Amy"}
              onClick={toggleMic}
            >
              {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            </Button>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder={listening ? "Listening…" : "Ask Amy about forex…"}
              className="h-9"
            />
            <Button
              size="icon"
              className="size-9 shrink-0"
              onClick={() => handleSend()}
              disabled={sending || !input.trim()}
            >
              <Send className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

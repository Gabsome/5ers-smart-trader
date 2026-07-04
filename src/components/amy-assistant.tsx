import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Send, X, Mic, MicOff, Volume2, VolumeX, Trash2, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listAmyMessages, sendAmyMessage, clearAmyMessages } from "@/lib/amy.functions";
import {
  AMY_MOOD_TAGS,
  AMY_VOICES,
  DEFAULT_AMY_SETTINGS,
  buildMoodTextDirective,
  loadAmySettings,
  saveAmySettings,
  type AmyMoodTag,
  type AmySettings,
} from "@/lib/amy-settings";
import { AmySpeaker } from "@/lib/amy-voice";

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

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

export function AmyAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [speaking, setSpeaking] = useState(false);
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

  function toggleMood(tag: AmyMoodTag) {
    setSettings((prev) => {
      const has = prev.moods.includes(tag);
      const moods = has ? prev.moods.filter((m) => m !== tag) : [...prev.moods, tag];
      const next = { ...prev, moods: moods.length ? moods : prev.moods };
      saveAmySettings(next);
      return next;
    });
  }

  const qc = useQueryClient();
  const fetchMessages = useServerFn(listAmyMessages);
  const send = useServerFn(sendAmyMessage);
  const clear = useServerFn(clearAmyMessages);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speakerRef = useRef<AmySpeaker | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { data: messages = [] } = useQuery({
    queryKey: ["amy-messages"],
    queryFn: () => fetchMessages() as Promise<Msg[]>,
    enabled: open,
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending, open]);

  function stopCurrentVoice() {
    speakerRef.current?.cancel();
    speakerRef.current = null;
    setSpeaking(false);
  }

  // Speak text through the Puter.js sentence queue — Amy starts talking the
  // moment the first sentence is ready. `feed`/`flush` are ready for true
  // token streaming; here we hand over the full reply at once.
  function playVoice(text: string) {
    if (!voiceOn || !text.trim()) return;
    stopCurrentVoice();
    const speaker = new AmySpeaker(settings, {
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
    });
    speakerRef.current = speaker;
    speaker.feed(text);
    speaker.flush();
  }

  async function handleSend(text?: string) {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    setInput("");
    setSending(true);
    qc.setQueryData<Msg[]>(["amy-messages"], (old = []) => [
      ...old,
      { id: `tmp-${Date.now()}`, role: "user", content, created_at: new Date().toISOString() },
    ]);
    try {
      const res = await send({
        data: {
          message: content,
          moods: buildMoodTextDirective(settings),
          humor: settings.humor,
          verbosity: settings.verbosity,
        },
      });
      await qc.invalidateQueries({ queryKey: ["amy-messages"] });
      playVoice(res.reply);
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
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
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
                onClick={() =>
                  setVoiceOn((v) => {
                    const next = !v;
                    if (!next) stopCurrentVoice();
                    return next;
                  })
                }
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
                <label className="text-xs font-medium">Voice (free, realistic)</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {AMY_VOICES.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => updateSettings({ voice: v.id })}
                      className={`rounded-lg border px-2 py-1.5 text-left text-[11px] transition ${
                        settings.voice === v.id
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
                <label className="text-xs font-medium">
                  Mood <span className="text-muted-foreground">(combine any)</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {AMY_MOOD_TAGS.map((m) => {
                    const active = settings.moods.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        title={m.blurb}
                        onClick={() => toggleMood(m.id)}
                        className={`rounded-full border px-3 py-1 text-[11px] font-medium transition ${
                          active
                            ? "border-primary bg-primary/15 text-foreground"
                            : "border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {active ? "✓ " : ""}
                        {m.label}
                      </button>
                    );
                  })}
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
                  <span>Speech speed</span>
                  <span className="text-muted-foreground">
                    {settings.speed <= 0.9
                      ? "Slow & comedic"
                      : settings.speed >= 1.15
                        ? "Fast & energetic"
                        : "Natural"}
                  </span>
                </label>
                <input
                  type="range"
                  min={0.7}
                  max={1.3}
                  step={0.05}
                  value={settings.speed}
                  onChange={(e) => updateSettings({ speed: Number(e.target.value) })}
                  className="w-full accent-primary"
                />
              </div>

              <label className="flex items-center justify-between gap-2 pt-1">
                <span className="text-xs font-medium">
                  Browser Audio Fallback
                  <span className="block text-[10px] text-muted-foreground">
                    Use your browser's voice if the cloud voice fails.
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.browserFallback}
                  onClick={() => updateSettings({ browserFallback: !settings.browserFallback })}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                    settings.browserFallback ? "bg-primary" : "bg-muted-foreground/40"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 size-4 rounded-full bg-background transition ${
                      settings.browserFallback ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
              </label>

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
                  onClick={() =>
                    playVoice(
                      "Hey, it's Amy! This is how I sound with your current settings — like it, or should we spice it up a little?",
                    )
                  }
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
                      onClick={() => playVoice(m.content)}
                      className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                      aria-label="Play Amy's voice"
                    >
                      <Volume2 className="size-3" /> Play voice
                    </button>
                  )}
                </div>
              </div>
            ))}
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

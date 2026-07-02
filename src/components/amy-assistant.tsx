import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Send, X, Mic, MicOff, Volume2, VolumeX, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listAmyMessages, sendAmyMessage, clearAmyMessages, speakAmy } from "@/lib/amy.functions";
import { supabase } from "@/integrations/supabase/client";

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

function canUseBrowserSpeech() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function AmyAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);

  const qc = useQueryClient();
  const fetchMessages = useServerFn(listAmyMessages);
  const send = useServerFn(sendAmyMessage);
  const clear = useServerFn(clearAmyMessages);
  const speak = useServerFn(speakAmy);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
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
    if (canUseBrowserSpeech()) {
      window.speechSynthesis.cancel();
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

  function playWithBrowserSpeech(text: string) {
    if (!canUseBrowserSpeech()) return false;
    const voices = window.speechSynthesis.getVoices();
    // Female-only: pick a known female voice; if the browser exposes none,
    // do NOT speak (never fall back to a male voice).
    const femaleVoice =
      voices.find((v) =>
        /female|woman|jenny|aria|samantha|victoria|zira|susan|karen|tessa|fiona|moira|serena|allison|ava|google us english/i.test(
          v.name,
        ),
      ) ?? null;
    if (!femaleVoice) return false;
    stopCurrentVoice();
    setSpeaking(true);
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 700));
    utterance.voice = femaleVoice;
    utterance.rate = 1.0;
    utterance.pitch = 1.08;
    utterance.volume = 1;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    speechUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setVoiceNotice("Amy used your browser voice fallback this time.");
    return true;
  }

  async function playVoice(text: string, primedContext?: Promise<AudioContext | null>) {
    if (!voiceOn) return;
    setVoiceNotice(null);
    try {
      setSpeaking(true);
      const contextPromise = primedContext ?? primeVoicePlayback().catch(() => null);
      const { audio } = await speak({ data: { text: text.slice(0, 2400) } });
      const ctx = await contextPromise;
      try {
        if (await playWithAudioContext(audio, ctx)) return;
      } catch (webAudioError) {
        console.warn("Amy WebAudio playback failed; trying native audio", webAudioError);
      }

      try {
        if (await playWithAudioElement(audio)) return;
      } catch (nativeAudioError) {
        console.warn("Amy native audio playback failed; trying browser speech", nativeAudioError);
      }

      if (playWithBrowserSpeech(text)) {
        return;
      }

      throw new Error("Audio playback was blocked by the browser");
    } catch (e: unknown) {
      setSpeaking(false);
      // Autoplay is often blocked until the user interacts — that's not an error,
      // they can use the "Play voice" button. Only surface real config issues.
      const msg = errorMessage(e, "");
      if (playWithBrowserSpeech(text)) return;
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
      const res = await send({ data: { message: content } });
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

          {/* Messages */}
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

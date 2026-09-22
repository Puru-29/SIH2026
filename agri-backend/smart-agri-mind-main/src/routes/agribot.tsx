import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Globe,
  Mic,
  MicOff,
  Radio,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { PortalLayout } from "@/components/agri/portal-layout";
import { PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import {
  BOT_ANSWERS,
  BOT_GREETING,
  BOT_LANG_INFO,
  askAgriBot,
  type SupportedBotLang,
} from "@/services";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/agribot")({
  head: () => ({
    meta: [
      { title: "AgriBot — Multilingual AI Kisan Assistant (Text + Voice) | AgriConnect (SIH 26132)" },
      {
        name: "description",
        content:
          "AgriBot voice-enabled Kisan assistant. Speaks & understands Hindi, Marathi, Punjabi, Hinglish, and English with auto language detection and voice commands.",
      },
      { property: "og:title", content: "AgriBot — Multilingual AI Voice Assistant" },
      {
        property: "og:description",
        content: "Speak or type in Marathi, Hindi, Punjabi, Hinglish or English to get live mandi prices, selling windows and grading.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AgriBot,
});

type Msg = {
  role: "bot" | "user";
  text: string;
  lang?: SupportedBotLang;
  confidence?: number;
};

// Web Speech API interface definitions
interface IWindowSpeechRecognition extends Window {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
}

export function AgriBot() {
  const { t, lang } = useI18n();
  const initialLang: SupportedBotLang = lang === "hi" ? "hi" : lang === "mr" ? "mr" : "en";
  const [messages, setMessages] = useState<Msg[]>([
    { role: "bot", text: BOT_GREETING[initialLang], lang: initialLang, confidence: 1.0 },
  ]);
  const [lastDetectedLang, setLastDetectedLang] = useState<SupportedBotLang>(initialLang);
  const [draft, setDraft] = useState("");
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isListening, interimTranscript]);

  const ask = (question: string) => {
    const q = question.trim();
    if (!q) return;

    // Run per-message dynamic language detection and response matching
    const reply = askAgriBot(q, initialLang, lastDetectedLang);
    setLastDetectedLang(reply.detectedLang);

    setMessages((prev) => [
      ...prev,
      { role: "user", text: q, lang: reply.detectedLang, confidence: reply.confidence },
      { role: "bot", text: reply.text, lang: reply.detectedLang, confidence: reply.confidence },
    ]);
    setDraft("");
    setInterimTranscript("");
  };

  /* -------------------------------------------------------------------------- */
  /*                         TEXT-TO-SPEECH (TTS)                               */
  /* -------------------------------------------------------------------------- */
  const speak = (text: string, msgLang: SupportedBotLang = "hi", idx: number) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      toast.error(t("Speech synthesis not supported in this browser"));
      return;
    }

    if (speakingIdx === idx) {
      window.speechSynthesis.cancel();
      setSpeakingIdx(null);
      return;
    }

    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const targetLocale = BOT_LANG_INFO[msgLang]?.speechLocale || "hi-IN";
    utter.lang = targetLocale;
    utter.rate = 0.95;

    // Pick best matching native voice if available in system
    const voices = window.speechSynthesis.getVoices();
    const matchedVoice = voices.find(
      (v) => v.lang.toLowerCase() === targetLocale.toLowerCase() || v.lang.toLowerCase().startsWith(targetLocale.slice(0, 2))
    );
    if (matchedVoice) {
      utter.voice = matchedVoice;
    }

    utter.onend = () => setSpeakingIdx(null);
    utter.onerror = () => setSpeakingIdx(null);
    window.speechSynthesis.speak(utter);
    setSpeakingIdx(idx);
  };

  /* -------------------------------------------------------------------------- */
  /*                      SPEECH-TO-TEXT (VOICE INPUT)                          */
  /* -------------------------------------------------------------------------- */
  const toggleListening = () => {
    if (typeof window === "undefined") return;

    const win = window as unknown as IWindowSpeechRecognition;
    const SpeechRecognitionAPI = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      toast.error(t("Voice recognition not supported in this browser. Please use Chrome, Edge, or Safari."));
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      setInterimTranscript("");
      return;
    }

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = false;
      recognition.interimResults = true;

      // Match recognition language with active context
      const recognitionLang = BOT_LANG_INFO[lastDetectedLang]?.speechLocale || BOT_LANG_INFO[initialLang]?.speechLocale || "hi-IN";
      recognition.lang = recognitionLang;

      recognition.onstart = () => {
        setIsListening(true);
        setInterimTranscript("");
        toast.info(t("Listening..."), {
          description: `Speak in ${BOT_LANG_INFO[lastDetectedLang]?.native || "Marathi / Hindi / English"}`,
        });
      };

      recognition.onresult = (event: any) => {
        let current = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            const finalSpeech = event.results[i][0].transcript;
            setIsListening(false);
            setInterimTranscript("");
            ask(finalSpeech);
            return;
          } else {
            current += event.results[i][0].transcript;
          }
        }
        setInterimTranscript(current);
      };

      recognition.onerror = (event: any) => {
        setIsListening(false);
        setInterimTranscript("");
        if (event.error === "not-allowed" || event.error === "permission-denied") {
          toast.error(t("Microphone permission denied"), {
            description: "Please allow microphone access in your browser settings to speak.",
          });
        } else if (event.error !== "no-speech") {
          toast.error("Voice input error: " + event.error);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error(err);
      setIsListening(false);
      toast.error(t("Could not start microphone. Please try typing."));
    }
  };

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
      recognitionRef.current?.stop();
    };
  }, []);

  const latestBotMsg = [...messages].reverse().find((m) => m.role === "bot");
  const latestBotIdx = messages.lastIndexOf(latestBotMsg!);

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="AgriBot · Auto-Language & Voice AI"
        title="AI Farm & Market Assistant"
        description="Speak or type in Marathi, Hindi, Punjabi, Hinglish, or English. AgriBot automatically detects your language, responds in the same language, and reads advice aloud."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="green" className="py-1.5 shadow-xs">
              <Globe className="h-3.5 w-3.5" />
              <span>Auto-Detect: हिंदी · मराठी · ਪੰਜਾਬੀ · Hinglish · English</span>
            </Pill>
          </div>
        }
      />

      <Panel className="p-0 overflow-hidden shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/60 p-5 backdrop-blur-xs">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Bot className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium text-foreground">{t("AgriBot Virtual Kisan Assistant")}</p>
                <span className="rounded-md bg-accent/60 px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
                  SIH 26132
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" />
                Active · Language: <strong className="text-foreground">{BOT_LANG_INFO[lastDetectedLang]?.native}</strong>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleListening}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all shadow-xs",
                isListening
                  ? "border-red-500 bg-red-50 text-red-700 animate-pulse dark:bg-red-950/40 dark:text-red-300"
                  : "border-border bg-secondary hover:bg-accent/60 text-foreground"
              )}
              title={isListening ? t("Stop listening") : t("Click to speak")}
              aria-label={isListening ? t("Stop listening") : t("Click to speak")}
            >
              {isListening ? (
                <>
                  <Radio className="h-4 w-4 animate-spin text-red-600" />
                  <span>{t("Listening...")}</span>
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4 text-primary" />
                  <span>{t("Voice input")}</span>
                </>
              )}
            </button>
            {latestBotMsg && (
              <button
                onClick={() => speak(latestBotMsg.text, latestBotMsg.lang, latestBotIdx)}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-4 py-2 text-sm font-medium transition-colors hover:bg-accent/50 text-foreground shadow-xs"
                aria-label={speakingIdx !== null ? t("Stop reading") : t("Read Response")}
              >
                {speakingIdx !== null ? (
                  <VolumeX className="h-4 w-4 text-destructive" />
                ) : (
                  <Volume2 className="h-4 w-4 text-primary" />
                )}
                {speakingIdx !== null ? t("Stop reading") : t("Read Response")}
              </button>
            )}
          </div>
        </div>

        {/* Live Listening Banner */}
        {isListening && (
          <div className="flex items-center gap-3 border-b border-red-200 bg-red-50/90 px-5 py-3 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200 animate-in fade-in duration-200">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
            </span>
            <span className="font-semibold">{t("Listening...")}</span>
            <span className="text-muted-foreground">
              {interimTranscript ? `"${interimTranscript}"` : t("Speak now")}
            </span>
            <button
              onClick={toggleListening}
              className="ml-auto rounded-md bg-red-200/60 px-2 py-0.5 text-[11px] font-medium text-red-800 hover:bg-red-200"
            >
              {t("Stop listening")}
            </button>
          </div>
        )}

        <div className="max-h-[52vh] min-h-[340px] space-y-4 overflow-y-auto p-5">
          {messages.map((m, i) => {
            const isUser = m.role === "user";
            const langLabel = m.lang ? BOT_LANG_INFO[m.lang]?.native : undefined;

            return (
              <div
                key={`${i}-${m.text.slice(0, 16)}`}
                className={isUser ? "flex flex-col items-end" : "flex flex-col items-start"}
              >
                <div
                  className={
                    isUser
                      ? "max-w-[85%] rounded-3xl rounded-br-lg bg-primary px-4 py-3 text-sm text-primary-foreground shadow-sm"
                      : "max-w-[85%] rounded-3xl rounded-bl-lg bg-secondary px-4 py-3 text-sm text-secondary-foreground shadow-sm"
                  }
                >
                  <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-semibold">
                    <span className={isUser ? "text-primary-foreground/75" : "text-muted-foreground"}>
                      {isUser ? t("You") : "AgriBot"}
                    </span>
                    {langLabel && (
                      <span
                        className={
                          isUser
                            ? "rounded-full bg-primary-foreground/20 px-2 py-0.5 text-[10px]"
                            : "rounded-full bg-accent px-2 py-0.5 text-[10px] text-accent-foreground"
                        }
                      >
                        {langLabel} {m.confidence && m.confidence < 0.9 ? `(~${Math.round(m.confidence * 100)}%)` : ""}
                      </span>
                    )}
                  </div>
                  <p className="leading-relaxed">{m.text}</p>
                </div>
                {!isUser && (
                  <button
                    onClick={() => speak(m.text, m.lang, i)}
                    className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
                    aria-label={speakingIdx === i ? t("Stop voice") : t("Listen in voice")}
                  >
                    {speakingIdx === i ? (
                      <VolumeX className="h-3 w-3 text-destructive" />
                    ) : (
                      <Volume2 className="h-3 w-3" />
                    )}
                    <span>{speakingIdx === i ? t("Stop voice") : t("Listen in voice")}</span>
                  </button>
                )}
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        <div className="border-t border-border bg-card/50 p-5">
          <p className="mb-2.5 text-xs font-medium text-muted-foreground">
            {t("Quick Suggestions")}:
          </p>
          <div className="flex flex-wrap gap-2">
            {BOT_ANSWERS.map((a) => (
              <button
                key={a.id}
                onClick={() => ask(a.chip)}
                className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium transition-colors hover:border-primary hover:bg-secondary"
              >
                {a.chip}
              </button>
            ))}
          </div>

          <form
            className="mt-4 flex flex-col gap-2.5 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
          >
            <div className="relative flex-1">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  isListening
                    ? "Listening... Speak in Marathi, Hindi, Punjabi, Hinglish, or English..."
                    : "Type or speak in Marathi, Hindi, Punjabi, Hinglish, or English..."
                }
                aria-label="Ask AgriBot in any language or script"
                className="w-full rounded-full border border-border bg-background py-3 pl-5 pr-12 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="button"
                onClick={toggleListening}
                className={cn(
                  "absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                  isListening
                    ? "bg-red-500 text-white animate-pulse"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
                title={isListening ? t("Stop listening") : t("Voice input")}
                aria-label={isListening ? t("Stop listening") : t("Voice input")}
              >
                {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            </div>
            <button
              type="submit"
              disabled={!draft.trim()}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-all shadow-sm",
                draft.trim()
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "bg-secondary text-muted-foreground cursor-not-allowed opacity-60"
              )}
            >
              <Send className="h-4 w-4" /> {t("Ask AgriBot")}
            </button>
          </form>
        </div>
      </Panel>
    </PortalLayout>
  );
}
export default AgriBot;



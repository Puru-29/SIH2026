import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Bot,
  Camera,
  Copy,
  Info,
  Languages,
  LineChart,
  Mic,
  MicOff,
  PenSquare,
  Scale,
  Search,
  Send,
  ShieldCheck,
  Sprout,
  Store,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TrendingDown,
  TrendingUp,
  Users,
  Volume2,
  VolumeX,
  Wallet,
  Warehouse,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PortalLayout } from "@/components/agri/portal-layout";
import { CameraCapture } from "@/components/agri/camera-capture";
import { BOT_LANG_INFO, askAgriBot, detectLanguage, type SupportedBotLang } from "@/services";
import { request } from "@/services/api-client";
import { getSession } from "@/services/session";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { cropEmoji } from "@/lib/crop-catalog";
import { useFarmLocation } from "@/lib/location-context";
import { useNotifications } from "@/lib/notification-context";
import { useMyLots } from "@/hooks/use-my-lots";
import { useAllMarketPrices } from "@/hooks/use-market-prices";

export const Route = createFileRoute("/agribot")({
  head: () => ({
    meta: [
      { title: "AgriBot — Multilingual AI Kisan Assistant | AgriConnect" },
      {
        name: "description",
        content:
          "Ask AgriBot about mandi prices, selling, storage, weather and your own lots, orders and payments — in English or Hindi, by text, voice or photo.",
      },
    ],
  }),
  component: AgriBot,
});

/* -------------------------------------------------------------------------- */
/*                                   types                                    */
/* -------------------------------------------------------------------------- */

type PriceCard = {
  type: "price";
  crop: string;
  place: string;
  modal: number;
  per_kg: number;
  min: number;
  max: number;
  date: string;
  reports: number;
  change_pct: number | null;
  history: { date: string; price: number }[];
  best: { market: string; district: string; price: number }[];
  my_quintals: number | null;
  sell_value: number | null;
};

type Msg = {
  role: "bot" | "user";
  text: string;
  lang?: SupportedBotLang;
  source?: "ai" | "builtin";
  pending?: boolean;
  at?: string;
  photo?: string | boolean;
  cards?: PriceCard[];
};

type AiReply = { answer: string; source: "ai"; conversation_id?: number; cards?: PriceCard[] };
type ChatSummary = { id: number; title: string; updated_at: string; messages: number };
type SavedMessage = {
  id: number;
  role: "user" | "bot";
  text: string;
  lang: string | null;
  source: string | null;
  created_at: string;
  meta: { photo?: boolean; cards?: PriceCard[] } | null;
};

type LangChoice = "auto" | "hi" | "en";
/**
 * Reply language in Auto mode: English → English, Hinglish (Hindi in Roman letters) →
 * Hinglish, everything else → Hindi. Hinglish is automatic only; it is not a menu option.
 */
const toHiEn = (l: SupportedBotLang): SupportedBotLang =>
  l === "en" || l === "hinglish" ? l : "hi";
const LANG_PILLS: { id: LangChoice; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "hi", label: "हिंदी" },
  { id: "en", label: "English" },
];

const TOPICS = [
  {
    tag: "Prices",
    icon: TrendingUp,
    tone: "bg-emerald-100 text-emerald-800",
    title: "Onion rate today",
    sub: "प्याज का आज का भाव?",
    ask: "प्याज का आज का भाव क्या है?",
  },
  {
    tag: "Selling",
    icon: Store,
    tone: "bg-amber-100 text-amber-800",
    title: "When to sell soybean?",
    sub: "सोयाबीन कब बेचें?",
    ask: "सोयाबीन कब बेचना चाहिए?",
  },
  {
    tag: "Forecast",
    icon: LineChart,
    tone: "bg-sky-100 text-sky-800",
    title: "Tomato price next week",
    sub: "टमाटर का भाव बढ़ेगा?",
    ask: "टमाटर का भाव अगले हफ्ते बढ़ेगा?",
  },
  {
    tag: "Quality",
    icon: ShieldCheck,
    tone: "bg-violet-100 text-violet-800",
    title: "How is my crop graded?",
    sub: "AI grading from a photo",
    ask: "How is my crop graded? How can I check the grade from a photo?",
  },
  {
    tag: "Storage",
    icon: Warehouse,
    tone: "bg-teal-100 text-teal-800",
    title: "Cold storage near me",
    sub: "Cost per quintal per day",
    ask: "What does cold storage near me cost per quintal per day?",
  },
  {
    tag: "Payments",
    icon: Wallet,
    tone: "bg-rose-100 text-rose-800",
    title: "Is my payment safe?",
    sub: "Escrow & settlement status",
    ask: "Is my payment safe? Show my payment and settlement status.",
  },
] as const;

/* -------------------------------------------------------------------------- */
/*                                  helpers                                   */
/* -------------------------------------------------------------------------- */

const PREFS_KEY = "agribot_prefs";
const LAST_CHAT_KEY = "agribot_last_chat";
function readStore<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
/** SQLite times are UTC "YYYY-MM-DD HH:MM:SS"; browser times are ISO. */
const toDate = (s: string) => new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
const clock = (s?: string) => {
  const d = s ? toDate(s) : new Date();
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
};
const shortDay = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};
function groupOf(updatedAt: string): string {
  const d = toDate(updatedAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (d >= today) return "Today";
  const days = (today.getTime() - d.getTime()) / 86_400_000;
  if (days <= 1) return "Yesterday";
  if (days <= 7) return "This week";
  return "Older";
}

/** Speech-synthesis voice for a language: natural/online voices first. */
function pickVoice(locale: string): SpeechSynthesisVoice | undefined {
  const quality = (v: SpeechSynthesisVoice) => (/natural|online|google/i.test(v.name) ? 0 : 1);
  const voices = [...window.speechSynthesis.getVoices()].sort((a, b) => quality(a) - quality(b));
  const lc = locale.toLowerCase();
  const base = lc.slice(0, 2);
  return (
    voices.find((v) => v.lang.toLowerCase() === lc) ??
    voices.find((v) => v.lang.toLowerCase().replace("_", "-").startsWith(base)) ??
    (base === "mr" ? voices.find((v) => v.lang.toLowerCase().startsWith("hi")) : undefined)
  );
}

/** Long replies are cut off by some browsers: speak sentence by sentence. */
function chunks(text: string): string[] {
  const parts = text
    .replace(/[*#_`]/g, "")
    .split(/(?<=[.!?।॥\n])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if (last && last.length + part.length < 180) out[out.length - 1] = `${last} ${part}`;
    else out.push(part);
  }
  return out;
}

/** Plain text with **bold** and "- " bullets. */
function RichText({ text }: { text: string }) {
  const inline = (line: string) =>
    line
      .split(/(\*\*[^*]+\*\*)/g)
      .map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      );
  return (
    <div className="space-y-1.5 leading-relaxed">
      {text
        .split("\n")
        .filter((l) => l.trim())
        .map((line, i) =>
          /^\s*[-•*]\s+/.test(line) ? (
            <p key={i} className="flex gap-2 pl-1">
              <span aria-hidden>•</span>
              <span>{inline(line.replace(/^\s*[-•*]\s+/, ""))}</span>
            </p>
          ) : (
            <p key={i}>{inline(line)}</p>
          ),
        )}
    </div>
  );
}

interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechCtor = new () => SpeechRecognitionLike;

/* -------------------------------------------------------------------------- */
/*                                    page                                    */
/* -------------------------------------------------------------------------- */

export function AgriBot() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const firstName = (getSession()?.name ?? "").split(" ")[0] || t("farmer");
  const appLang: SupportedBotLang = lang === "hi" ? "hi" : "en";

  const [replyLang, setReplyLang] = useState<LangChoice>("auto");
  useEffect(() => {
    const p = readStore<{ reply?: string }>(PREFS_KEY);
    if (p?.reply === "hi" || p?.reply === "en") setReplyLang(p.reply);
  }, []);
  useEffect(() => {
    writeStore(PREFS_KEY, { reply: replyLang });
  }, [replyLang]);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [lastLang, setLastLang] = useState<SupportedBotLang>(appLang);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatId, setChatId] = useState<number | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [votes, setVotes] = useState<Record<number, "up" | "down">>({});
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const aiOffNotified = useRef(false);

  const activeLang: SupportedBotLang = replyLang === "auto" ? toHiEn(lastLang) : replyLang;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, interim]);

  /* ------------------------------ saved chats ----------------------------- */
  const chats = useQuery({
    queryKey: ["agribot-chats"],
    queryFn: () => request<ChatSummary[]>("/api/agribot/conversations"),
  });
  const openChat = async (id: number) => {
    try {
      const c = await request<{ id: number; messages: SavedMessage[] }>(
        `/api/agribot/conversations/${id}`,
      );
      window.speechSynthesis?.cancel();
      setChatId(id);
      writeStore(LAST_CHAT_KEY, id);
      setVotes({});
      setMessages(
        c.messages.map((m): Msg => ({
          role: m.role,
          text: m.text,
          at: m.created_at,
          ...(m.lang ? { lang: m.lang as SupportedBotLang } : {}),
          ...(m.role === "bot"
            ? { source: m.source === "ai" ? ("ai" as const) : ("builtin" as const) }
            : {}),
          ...(m.meta?.photo ? { photo: true } : {}),
          ...(m.meta?.cards?.length ? { cards: m.meta.cards } : {}),
        })),
      );
    } catch {
      writeStore(LAST_CHAT_KEY, null);
    }
  };
  const newChat = () => {
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    setChatId(null);
    writeStore(LAST_CHAT_KEY, null);
    setMessages([]);
    setVotes({});
  };
  const deleteChat = async (id: number) => {
    if (!window.confirm(t("Delete this chat?"))) return;
    try {
      await request(`/api/agribot/conversations/${id}`, { method: "DELETE" });
      if (id === chatId) newChat();
      void qc.invalidateQueries({ queryKey: ["agribot-chats"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const last = readStore<number>(LAST_CHAT_KEY);
    if (last) void openChat(last);
  }, []);

  /* --------------------------------- speech -------------------------------- */
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const load = () => window.speechSynthesis.getVoices();
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      window.speechSynthesis.cancel();
      recognitionRef.current?.stop();
    };
  }, []);

  /** Audio from the server (Gemini) when the browser has no voice for the language. */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopSpeaking = () => {
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    audioRef.current = null;
    setSpeakingIdx(null);
  };

  const speak = (text: string, msgLang: SupportedBotLang = "hi", idx: number, quiet = false) => {
    if (typeof window === "undefined") return;
    if (speakingIdx === idx) {
      stopSpeaking();
      return;
    }
    stopSpeaking();
    const locale = BOT_LANG_INFO[msgLang]?.speechLocale || "hi-IN";
    const voice = "speechSynthesis" in window ? pickVoice(locale) : undefined;
    if (!voice) {
      // No browser voice (e.g. Hindi in Brave): get natural speech from the server.
      setSpeakingIdx(idx);
      void request<{ mime_type: string; data: string }>("/api/agribot/tts", {
        method: "POST",
        body: JSON.stringify({ text }),
      })
        .then((r) => {
          const audio = new Audio(`data:${r.mime_type};base64,${r.data}`);
          audioRef.current = audio;
          audio.onended = () => setSpeakingIdx(null);
          audio.onerror = () => setSpeakingIdx(null);
          return audio.play();
        })
        .catch((e: unknown) => {
          setSpeakingIdx(null);
          if (!quiet)
            toast.error(t("Could not read this reply aloud"), {
              description: e instanceof Error ? e.message : undefined,
            });
        });
      return;
    }
    const parts = chunks(text);
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      u.voice = voice;
      u.lang = voice.lang || locale;
      u.rate = 0.95;
      if (i === parts.length - 1) u.onend = () => setSpeakingIdx(null);
      u.onerror = () => setSpeakingIdx(null);
      window.speechSynthesis.speak(u);
    });
    setSpeakingIdx(idx);
  };

  const toggleListening = () => {
    const win = window as unknown as {
      SpeechRecognition?: SpeechCtor;
      webkitSpeechRecognition?: SpeechCtor;
    };
    const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
    const isBrave = Boolean((navigator as Navigator & { brave?: unknown }).brave);
    if (!Ctor || isBrave) {
      toast.error(
        isBrave
          ? t("Voice input doesn't work in Brave")
          : t("Voice input isn't supported in this browser."),
        {
          description: t(
            "Open AgriSense in Google Chrome or Microsoft Edge to speak your question, or type it here.",
          ),
        },
      );
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      setInterim("");
      return;
    }
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = BOT_LANG_INFO[activeLang]?.speechLocale || "hi-IN";
    rec.onstart = () => setListening(true);
    rec.onresult = (e) => {
      let current = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        if (r.isFinal) {
          setListening(false);
          setInterim("");
          void ask(r[0].transcript);
          return;
        }
        current += r[0].transcript;
      }
      setInterim(current);
    };
    rec.onerror = (e) => {
      setListening(false);
      setInterim("");
      if (e.error === "not-allowed") toast.error(t("Microphone permission denied"));
      else if (e.error === "network") toast.error(t("Voice input needs internet"));
      else if (e.error !== "no-speech" && e.error !== "aborted")
        toast.error(`Voice input error: ${e.error}`);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
  };

  /* ---------------------------------- ask ---------------------------------- */
  async function ask(question: string) {
    const q = (
      question.trim() ||
      (photo ? t("Please check this crop photo and tell me its quality and grade.") : "")
    ).trim();
    if (!q || busy) return;
    setDraft("");
    setInterim("");
    const sentPhoto = photo;
    setPhoto(null);

    const detected = toHiEn(detectLanguage(q, appLang, lastLang).lang);
    const answerLang: SupportedBotLang = replyLang === "auto" ? toHiEn(detected) : replyLang;
    setLastLang(detected);
    const history = messages
      .filter((m) => !m.pending)
      .map((m) => ({ role: m.role === "user" ? "user" : "assistant", text: m.text }));
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: q,
        lang: detected,
        at: new Date().toISOString(),
        ...(sentPhoto ? { photo: sentPhoto } : {}),
      },
      { role: "bot", text: "", lang: answerLang, pending: true },
    ]);
    setBusy(true);

    let bot: Msg;
    let savedId = chatId;
    try {
      const r = await request<AiReply>("/api/agribot/ask", {
        method: "POST",
        body: JSON.stringify({
          question: q,
          reply_lang: answerLang,
          question_lang: detected,
          conversation_id: chatId,
          history,
          ...(sentPhoto ? { image: sentPhoto } : {}),
        }),
      });
      bot = {
        role: "bot",
        text: r.answer,
        lang: answerLang,
        source: "ai",
        at: new Date().toISOString(),
        ...(r.cards?.length ? { cards: r.cards } : {}),
      };
      savedId = r.conversation_id ?? chatId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!aiOffNotified.current || /many questions|limit/i.test(msg)) {
        aiOffNotified.current = true;
        toast.info(t("AgriBot AI is unavailable, using built-in answers."), {
          description: msg || undefined,
        });
      }
      const reply = askAgriBot(q, appLang, lastLang, { outputLang: answerLang });
      bot = {
        role: "bot",
        text: reply.text,
        lang: reply.responseLang,
        source: "builtin",
        at: new Date().toISOString(),
      };
      try {
        const saved = await request<{ conversation_id: number }>("/api/agribot/messages", {
          method: "POST",
          body: JSON.stringify({
            conversation_id: chatId,
            question: q,
            question_lang: detected,
            answer: reply.text,
            answer_lang: reply.responseLang,
          }),
        });
        savedId = saved.conversation_id;
      } catch {
        /* keep it on screen only */
      }
    } finally {
      setBusy(false);
    }
    setMessages((prev) => [...prev.filter((m) => !m.pending), bot]);
    if (savedId) {
      setChatId(savedId);
      writeStore(LAST_CHAT_KEY, savedId);
      void qc.invalidateQueries({ queryKey: ["agribot-chats"] });
    }
  }

  /* --------------------------------- layout -------------------------------- */
  const empty = messages.length === 0;
  const lastBot = [...messages].reverse().find((m) => m.role === "bot" && !m.pending);
  const lastCrop = lastBot?.cards?.[0]?.crop;
  const followUps = lastCrop
    ? [
        `${["Onion", "Tomato", "Soybean", "Potato"].find((c) => c !== lastCrop) ?? "Tomato"} price?`,
        "Storage cost for 7 days?",
        "Show my best offer",
      ]
    : [];

  return (
    <PortalLayout wide>
      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_18rem]">
        <ChatList
          chats={chats.data ?? []}
          loading={chats.isLoading}
          activeId={chatId}
          onOpen={(id) => void openChat(id)}
          onNew={newChat}
          onDelete={(id) => void deleteChat(id)}
        />

        <section className="flex h-[calc(100vh-8.5rem)] min-h-[34rem] flex-col overflow-hidden rounded-3xl border border-border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <Bot className="h-5 w-5" />
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-emerald-500" />
              </span>
              <div>
                <p className="font-semibold">AgriBot</p>
                <p className="text-xs text-muted-foreground">
                  {t("Online · knows your lots, orders & payments")}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <div
                className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full bg-secondary p-1"
                role="radiogroup"
                aria-label={t("Reply language")}
              >
                {LANG_PILLS.map((p) => (
                  <button
                    key={p.id}
                    role="radio"
                    aria-checked={replyLang === p.id}
                    onClick={() => setReplyLang(p.id)}
                    className={cn(
                      "flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs",
                      replyLang === p.id
                        ? "bg-card font-medium shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {p.id === "auto" && <Languages className="h-3.5 w-3.5" />}
                    {p.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  // Play / stop the latest reply. The button turns itself off when reading ends.
                  if (speakingIdx !== null) {
                    stopSpeaking();
                    return;
                  }
                  let idx = messages.length - 1;
                  while (idx >= 0 && (messages[idx]!.role !== "bot" || messages[idx]!.pending))
                    idx--;
                  const last = messages[idx];
                  if (last) speak(last.text, last.lang, idx);
                  else toast(t("Ask a question first, then press to hear the answer."));
                }}
                aria-pressed={speakingIdx !== null}
                aria-label={speakingIdx !== null ? t("Stop reading") : t("Read the reply aloud")}
                title={speakingIdx !== null ? t("Stop reading") : t("Read the reply aloud")}
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  speakingIdx !== null
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground",
                )}
              >
                {speakingIdx !== null ? (
                  <Volume2 className="h-4 w-4 animate-pulse" />
                ) : (
                  <VolumeX className="h-4 w-4" />
                )}
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            {empty ? (
              <Welcome name={firstName} onAsk={(q) => void ask(q)} />
            ) : (
              <div className="mx-auto max-w-3xl space-y-5">
                {messages.map((m, i) =>
                  m.role === "user" ? (
                    <UserBubble key={i} m={m} />
                  ) : (
                    <BotMessage
                      key={i}
                      m={m}
                      vote={votes[i]}
                      onVote={(v) => setVotes((s) => ({ ...s, [i]: v }))}
                      onNavigate={(to) => void navigate({ to: to as "/" })}
                    />
                  ),
                )}
                {followUps.length > 0 && !busy && (
                  <div className="flex flex-wrap gap-2 pl-11">
                    {followUps.map((f) => (
                      <button
                        key={f}
                        onClick={() => void ask(f)}
                        className="rounded-full border border-border bg-card px-3 py-1.5 text-xs hover:bg-secondary"
                      >
                        {t(f)}
                      </button>
                    ))}
                  </div>
                )}
                {interim && (
                  <p className="ml-auto max-w-md rounded-2xl bg-secondary px-4 py-2 text-sm italic text-muted-foreground">
                    {interim}…
                  </p>
                )}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <div className="border-t border-border px-3 pb-3 pt-3 sm:px-5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void ask(draft);
              }}
              className="flex items-end gap-2 rounded-2xl border border-border bg-background p-2 focus-within:border-primary"
            >
              <button
                type="button"
                onClick={() => setCamera(true)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground hover:text-foreground"
                aria-label={t("Take a crop photo")}
                title={t("Take a crop photo")}
              >
                <Camera className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                {photo && (
                  <div className="mb-2 flex items-center gap-2">
                    <img
                      src={photo}
                      alt={t("Crop photo to send")}
                      className="h-12 w-12 rounded-lg object-cover"
                    />
                    <span className="text-xs text-muted-foreground">{t("Photo attached")}</span>
                    <button
                      type="button"
                      onClick={() => setPhoto(null)}
                      aria-label={t("Remove photo")}
                      className="rounded p-1 hover:bg-secondary"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    empty ? t("Ask anything… e.g. “प्याज का आज का भाव?”") : t("Ask a follow-up…")
                  }
                  aria-label={t("Message AgriBot")}
                  className="h-11 w-full bg-transparent px-2 text-sm outline-none"
                />
              </div>
              <button
                type="button"
                onClick={toggleListening}
                aria-pressed={listening}
                aria-label={listening ? t("Stop listening") : t("Speak your question")}
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-primary-foreground",
                  listening ? "animate-pulse bg-destructive" : "bg-primary",
                )}
              >
                {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>
              <button
                type="submit"
                disabled={busy || (!draft.trim() && !photo)}
                aria-label={t("Send")}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground disabled:opacity-40"
              >
                <Send className="h-5 w-5" />
              </button>
            </form>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1 font-medium text-primary">
                <Languages className="h-3.5 w-3.5" />
                {replyLang === "auto" && empty
                  ? t("Auto-detect language")
                  : `${t("Replying in")} ${BOT_LANG_INFO[activeLang]?.native ?? activeLang}`}
              </span>
              <span>{t("AgriBot can make mistakes. Check prices before you sell.")}</span>
            </div>
          </div>
          <CameraCapture
            open={camera}
            title="Photo of your crop"
            onClose={() => setCamera(false)}
            onCapture={(p) => setPhoto(p.data_base64)}
          />
        </section>

        <ContextRail />
      </div>
    </PortalLayout>
  );
}

/* -------------------------------------------------------------------------- */
/*                                chat history                                */
/* -------------------------------------------------------------------------- */

function ChatList({
  chats,
  loading,
  activeId,
  onOpen,
  onNew,
  onDelete,
}: {
  chats: ChatSummary[];
  loading: boolean;
  activeId: number | null;
  onOpen: (id: number) => void;
  onNew: () => void;
  onDelete: (id: number) => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const out = new Map<string, ChatSummary[]>();
    const needle = q.trim().toLowerCase();
    for (const c of chats.filter((c) => c.title.toLowerCase().includes(needle))) {
      const g = groupOf(c.updated_at);
      out.set(g, [...(out.get(g) ?? []), c]);
    }
    return [...out.entries()];
  }, [chats, q]);
  return (
    <aside className="flex flex-col gap-3 lg:h-[calc(100vh-8.5rem)]">
      <button
        onClick={onNew}
        className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm"
      >
        <PenSquare className="h-4 w-4" /> {t("New chat")}
      </button>
      <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("Search your chats")}
          aria-label={t("Search your chats")}
          className="w-full bg-transparent py-2.5 text-sm outline-none"
        />
      </label>
      <div className="max-h-64 flex-1 overflow-y-auto lg:max-h-none">
        {loading ? (
          <p className="px-2 text-sm text-muted-foreground">{t("Loading…")}</p>
        ) : groups.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">
            {q ? t("No chats match.") : t("No saved chats yet. Ask a question to start one.")}
          </p>
        ) : (
          groups.map(([g, items]) => (
            <div key={g} className="mb-3">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t(g)}
              </p>
              <ul className="space-y-0.5">
                {items.map((c) => (
                  <li key={c.id} className="group relative">
                    <button
                      onClick={() => onOpen(c.id)}
                      aria-current={c.id === activeId}
                      title={c.title}
                      className={cn(
                        "w-full rounded-xl px-3 py-2 pr-9 text-left",
                        c.id === activeId
                          ? "border border-border bg-card shadow-sm"
                          : "hover:bg-secondary",
                      )}
                    >
                      <span className="block truncate text-sm font-medium">{c.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {Math.ceil(c.messages / 2)}{" "}
                        {t(Math.ceil(c.messages / 2) === 1 ? "question" : "questions")} ·{" "}
                        {clock(c.updated_at)}
                      </span>
                    </button>
                    <button
                      onClick={() => onDelete(c.id)}
                      aria-label={`${t("Delete chat")}: ${c.title}`}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground opacity-0 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
      <p className="hidden rounded-2xl border border-dashed border-border p-3 text-xs text-muted-foreground lg:flex lg:gap-2">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t("Tip: tap the mic and speak in Hindi or English. AgriBot replies in the same language.")}
      </p>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  messages                                  */
/* -------------------------------------------------------------------------- */

function Welcome({ name, onAsk }: { name: string; onAsk: (q: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center py-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary text-primary-foreground shadow-md">
        <Sprout className="h-8 w-8" />
      </span>
      <h2 className="mt-5 font-serif text-3xl sm:text-4xl">
        {t("Namaste")}, {name}
      </h2>
      <p className="mt-3 max-w-lg text-sm text-muted-foreground">
        {t(
          "Ask about mandi prices, the best time to sell, your lots, orders or payments. Type, speak or send a crop photo — AgriBot answers using your own farm data.",
        )}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {["हिंदी", "English"].map((l) => (
          <span key={l} className="rounded-full bg-emerald-100 px-3 py-1 text-xs text-emerald-900">
            {l}
          </span>
        ))}
      </div>
      <div className="mt-8 grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TOPICS.map((c) => (
          <button
            key={c.tag}
            onClick={() => onAsk(c.ask)}
            className="rounded-2xl border border-border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-secondary"
          >
            <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", c.tone)}>
                <c.icon className="h-3.5 w-3.5" />
              </span>
              {t(c.tag)}
            </span>
            <span className="mt-3 block font-medium">{t(c.title)}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{c.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function UserBubble({ m }: { m: Msg }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-end">
      <div className="max-w-[85%] rounded-3xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground sm:max-w-md">
        {typeof m.photo === "string" ? (
          <img src={m.photo} alt={t("Crop photo")} className="mb-2 max-h-48 rounded-xl" />
        ) : m.photo ? (
          <p className="mb-1 flex items-center gap-1 text-xs opacity-80">
            <Camera className="h-3.5 w-3.5" /> {t("Photo sent")}
          </p>
        ) : null}
        <p className="whitespace-pre-line leading-relaxed">{m.text}</p>
      </div>
      <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
        <Languages className="h-3 w-3" />
        {m.lang ? `${BOT_LANG_INFO[toHiEn(m.lang)]?.name} ${t("detected")}` : ""}
        {m.at ? ` · ${clock(m.at)}` : ""}
      </p>
    </div>
  );
}

function BotMessage({
  m,
  vote,
  onVote,
  onNavigate,
}: {
  m: Msg;
  vote: "up" | "down" | undefined;
  onVote: (v: "up" | "down") => void;
  onNavigate: (to: string) => void;
}) {
  const { t } = useI18n();
  const card = m.cards?.[0];
  return (
    <div className="flex gap-3">
      <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Bot className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="rounded-3xl rounded-tl-md border border-border bg-background px-4 py-3 text-sm sm:px-5 sm:py-4">
          {m.pending ? (
            <p className="flex items-center gap-1 py-1" aria-label={t("AgriBot is thinking")}>
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60"
                  style={{ animationDelay: `${d * 150}ms` }}
                />
              ))}
            </p>
          ) : (
            <>
              <RichText text={m.text} />
              {m.cards?.map((c) => (
                <PriceCardView key={c.crop} c={c} />
              ))}
              {card && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <ActionButton
                    primary
                    icon={<Users className="h-3.5 w-3.5" />}
                    onClick={() => onNavigate("/buyers")}
                  >
                    {t("See buyers")}
                  </ActionButton>
                  <ActionButton
                    icon={<LineChart className="h-3.5 w-3.5" />}
                    onClick={() => onNavigate("/forecast")}
                  >
                    {t("Price forecast")}
                  </ActionButton>
                  <ActionButton
                    icon={<Scale className="h-3.5 w-3.5" />}
                    onClick={() => onNavigate("/markets")}
                  >
                    {t("Other mandis")}
                  </ActionButton>
                </div>
              )}
            </>
          )}
        </div>
        {!m.pending && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            <button
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(m.text)
                  .then(() => toast.success(t("Copied")))
                  .catch(() => undefined)
              }
              className="flex items-center gap-1 rounded-full px-2 py-1 hover:bg-secondary"
            >
              <Copy className="h-3.5 w-3.5" /> {t("Copy")}
            </button>
            <button
              onClick={() => onVote("up")}
              aria-pressed={vote === "up"}
              aria-label={t("Helpful")}
              className={cn(
                "rounded-full p-1.5 hover:bg-secondary",
                vote === "up" && "text-primary",
              )}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onVote("down")}
              aria-pressed={vote === "down"}
              aria-label={t("Not helpful")}
              className={cn(
                "rounded-full p-1.5 hover:bg-secondary",
                vote === "down" && "text-destructive",
              )}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
            </button>
            {m.source === "ai" && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                AI
              </span>
            )}
            <span className="ml-auto">
              {card
                ? `Agmarknet · ${shortDay(card.date)}`
                : m.source === "builtin"
                  ? t("Offline answer")
                  : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  children,
  icon,
  primary,
  onClick,
}: {
  children: ReactNode;
  icon: ReactNode;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium",
        primary
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-card hover:bg-secondary",
      )}
    >
      {icon} {children}
    </button>
  );
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 160;
  const h = 48;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map(
    (p, i) => [(i / (points.length - 1)) * w, h - 4 - ((p - min) / span) * (h - 8)] as const,
  );
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = xy[xy.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-40" aria-hidden>
      <polygon points={`0,${h} ${line} ${w},${h}`} className="fill-primary/10" />
      <polyline
        points={line}
        fill="none"
        className="stroke-primary"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r="3" className="fill-primary" />
    </svg>
  );
}

function PriceCardView({ c }: { c: PriceCard }) {
  const { t } = useI18n();
  const up = (c.change_pct ?? 0) >= 0;
  return (
    <div className="mt-3 space-y-2">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {c.place} · {t(c.crop)}
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {inr(c.modal)}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                / {t("quintal")}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              ≈ ₹{c.per_kg}/kg · {c.reports} {t("mandi reports")}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full bg-secondary px-2 py-0.5">Min {inr(c.min)}</span>
              <span className="rounded-full bg-secondary px-2 py-0.5">Max {inr(c.max)}</span>
              {c.change_pct !== null && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5",
                    up ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900",
                  )}
                >
                  {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {Math.abs(c.change_pct)}% {t("vs previous day")}
                </span>
              )}
            </div>
          </div>
          <Sparkline points={c.history.map((h) => h.price)} />
        </div>
        {c.best.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("Best mandis")}: {c.best.map((b) => `${b.market} ${inr(b.price)}`).join(" · ")}
          </p>
        )}
      </div>
      {c.sell_value !== null && c.my_quintals !== null && (
        <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-950">
          <p className="font-medium">
            {t("If you sell today")}: {inr(c.sell_value)}
          </p>
          <p className="text-xs opacity-80">
            {c.my_quintals} q × {inr(c.modal)} · {t("before transport and fees")}
          </p>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                               right-hand rail                              */
/* -------------------------------------------------------------------------- */

function ContextRail() {
  const { t } = useI18n();
  const { location } = useFarmLocation();
  const prices = useAllMarketPrices(location.state);
  const { openLots } = useMyLots();
  const { items } = useNotifications();

  const mandi = useMemo(() => {
    const byCrop = new Map<string, number[]>();
    for (const p of prices.data ?? []) {
      if (p.modal_price > 0)
        byCrop.set(p.crop_name, [...(byCrop.get(p.crop_name) ?? []), p.modal_price]);
    }
    const mine = new Set(openLots.map((l) => l.crop.toLowerCase()));
    return [...byCrop.entries()]
      .map(([crop, v]) => {
        const s = [...v].sort((a, b) => a - b);
        return {
          crop,
          price: s[Math.floor(s.length / 2)] ?? 0,
          mine: mine.has(crop.toLowerCase()),
          n: v.length,
        };
      })
      .sort((a, b) => Number(b.mine) - Number(a.mine) || b.n - a.n)
      .slice(0, 4);
  }, [prices.data, openLots]);

  const attention = items.filter((n) => !n.read).slice(0, 3);
  const place = location.district || location.name || location.state;

  return (
    <aside className="hidden space-y-4 xl:block">
      <RailCard icon={<Store className="h-4 w-4" />} title={`${place} ${t("mandi today")}`}>
        {prices.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("Loading…")}</p>
        ) : mandi.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("No mandi prices for your state right now.")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {mandi.map((m) => (
              <li key={m.crop} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {cropEmoji(m.crop)} {t(m.crop)}
                </span>
                <span className="font-semibold tabular-nums">{inr(m.price)}/q</span>
              </li>
            ))}
          </ul>
        )}
      </RailCard>

      {openLots.length > 0 && (
        <RailCard icon={<Sprout className="h-4 w-4" />} title={t("Your open lots")}>
          <ul className="space-y-2">
            {openLots.slice(0, 4).map((l) => {
              const offers = l.pendingOffers ?? 0;
              const badge =
                offers > 0
                  ? { label: "Offers", cls: "bg-amber-100 text-amber-900" }
                  : l.status === "SELL NOW"
                    ? { label: "Urgent", cls: "bg-red-100 text-red-900" }
                    : { label: "Open", cls: "bg-emerald-100 text-emerald-900" };
              return (
                <li key={l.id}>
                  <Link
                    to="/crops"
                    className="flex items-center gap-3 rounded-xl p-1 hover:bg-secondary"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-lg">
                      {l.emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {t(l.crop)} · {l.quantityQuintals ?? l.quantity / 100} q
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {l.grade}
                        {offers > 0 ? ` · ${offers} ${t("offers")}` : ""}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        badge.cls,
                      )}
                    >
                      {t(badge.label)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </RailCard>
      )}

      <RailCard icon={<AlertCircle className="h-4 w-4" />} title={t("Needs your attention")}>
        {attention.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("You're all caught up.")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {attention.map((n) => (
              <li key={n.id} className="py-2 text-sm">
                <Link to={n.link.split("?")[0] as "/"} className="block hover:underline">
                  <span className="font-medium">{n.title}</span>
                  {n.body && (
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                      {n.body}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </RailCard>
    </aside>
  );
}

function RailCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-border bg-card p-4">
      <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon} {title}
      </p>
      {children}
    </div>
  );
}

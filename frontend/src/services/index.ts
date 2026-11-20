/**
 * Static content for the landing page, calculators and AgriBot. Live data
 * (lots, offers, orders, notifications, FPO pools) comes from api-client.ts.
 */
import { BUYERS, roadKm, transportPerKg } from "@/lib/agri";
import type { Coords } from "@/lib/agri";
import { FAQS, TESTIMONIALS, TICKER, TRUST_METRICS } from "./mock-data";

export * from "./types";

export { LOCATIONS, inr } from "@/lib/agri";

/* ------------------------------------------------------------------ landing */

export const getTicker = () => TICKER;
export const getTestimonials = () => TESTIMONIALS;
export const getFaqs = () => FAQS;
export const getTrustMetrics = () => TRUST_METRICS;

/* -------------------------------------------------------------- calculators */

export type NetRealizationInput = {
  crop: string;
  quantityKg: number;
  from: Coords;
};

export type NetRealizationResult = {
  headline: number;
  freightPerKg: number;
  storagePerKg: number;
  netPerKg: number;
  km: number;
  destination: string;
  totalNet: number;
  totalHeadline: number;
};

const CROP_PRICE: Record<string, number> = {
  Tomato: 30,
  Onion: 18,
  Soybean: 46,
  Pomegranate: 92,
};

export const CALCULATOR_CROPS = Object.keys(CROP_PRICE);

export function calculateNetRealization({
  crop,
  quantityKg,
  from,
}: NetRealizationInput): NetRealizationResult {
  const base = CROP_PRICE[crop] ?? 30;
  const best = BUYERS.map((b) => {
    const km = roadKm(from, b);
    const freight = transportPerKg(km);
    const headline = Math.round(base * (b.offer / 30) * 10) / 10;
    return { name: b.name, km, freight, headline, net: headline - freight };
  }).sort((a, b) => b.net - a.net)[0]!;

  const storagePerKg = 0;
  const netPerKg = Math.round((best.net - storagePerKg) * 10) / 10;
  return {
    headline: best.headline,
    freightPerKg: best.freight,
    storagePerKg,
    netPerKg,
    km: best.km,
    destination: best.name,
    totalNet: Math.round(netPerKg * quantityKg),
    totalHeadline: Math.round(best.headline * quantityKg),
  };
}

/* ---------------------------------------------------------- virtual assistant */

import { BOT_ANSWERS, BOT_FALLBACK, BOT_GREETING } from "./mock-data";
import { detectLanguage, BOT_LANG_INFO } from "./language-detector";
import type { SupportedBotLang, DetectionResult } from "./language-detector";

export { BOT_ANSWERS, BOT_FALLBACK, BOT_GREETING, detectLanguage, BOT_LANG_INFO };
export type { SupportedBotLang, DetectionResult };

export interface AgriBotResponse {
  text: string;
  /** Language of the farmer's question (detected, or forced by the user). */
  detectedLang: SupportedBotLang;
  /** Language the reply is written in. */
  responseLang: SupportedBotLang;
  confidence: number;
  matchedTopic?: string;
}

/**
 * Intelligent AgriBot query resolver with Automatic Language Detection.
 * Detects whether the farmer is writing in English, Hindi (Devanagari),
 * Marathi (Devanagari), Punjabi (Gurmukhi), or Hinglish (Roman Script),
 * and matches the response language and script automatically.
 */
export function askAgriBot(
  question: string,
  contextLang: string = "en",
  lastDetectedLang?: SupportedBotLang,
  options: {
    /** Force the input language instead of auto-detecting it. */
    inputLang?: SupportedBotLang | undefined;
    /** Reply in this language instead of mirroring the input language. */
    outputLang?: SupportedBotLang | undefined;
  } = {},
): AgriBotResponse {
  const normContext =
    contextLang === "mr" ||
    contextLang === "hi" ||
    contextLang === "pa" ||
    contextLang === "hinglish"
      ? contextLang
      : "en";

  const detection = options.inputLang
    ? { lang: options.inputLang, confidence: 1 }
    : detectLanguage(question, normContext, lastDetectedLang);
  const targetLang = options.outputLang ?? detection.lang;
  const q = question.toLowerCase();

  const has = (...keys: string[]) => keys.some((k) => q.includes(k.toLowerCase()));
  const pick = (id: string) => BOT_ANSWERS.find((a) => a.id === id)?.answer[targetLang];

  let replyText: string;
  let matchedTopic: string | undefined;

  // Onion / Pyaj / Kanda
  if (
    has(
      "onion",
      "कांदा",
      "कांद्या",
      "प्याज",
      "pyaj",
      "pyaaz",
      "kanda",
      "lasalgaon",
      "ਲਾਸਲਗਾਂਵ",
      "ਪਿਆਜ਼",
    )
  ) {
    replyText = pick("onion-rate")!;
    matchedTopic = "onion-rate";
  }
  // Soybean timing
  else if (
    has(
      "soy",
      "सोयाबीन",
      "latur",
      "ਲਾਤੂਰ",
      "ਸੋਇਆਬੀਨ",
      "soyabean",
      "hold",
      "kab bechu",
      "kadhi viku",
    )
  ) {
    replyText = pick("soybean-timing")!;
    matchedTopic = "soybean-timing";
  }
  // Tomato / Tamatar
  else if (
    has("tomato", "टोमॅटो", "टमाटर", "pune", "पुणे", "ਪੁਣੇ", "ਟਮਾਟਰ", "tamatar", "market yard")
  ) {
    replyText = pick("pune-tomato")!;
    matchedTopic = "pune-tomato";
  }
  // AI grading
  else if (
    has("grad", "ग्रेड", "quality", "गुणवत्ता", "फोटो", "ਗ੍ਰੇਡ", "grading", "crate", "norm")
  ) {
    replyText = pick("ai-grading")!;
    matchedTopic = "ai-grading";
  }
  // Cold storage / warehouse / silos
  else if (
    has(
      "cold",
      "storage",
      "शीतगृह",
      "भंडारण",
      "वेयरहाउस",
      "warehouse",
      "silo",
      "ਕੋਲਡ",
      "ਸਟੋਰੇਜ",
      "chawl",
      "kharcha",
    )
  ) {
    replyText = pick("cold-storage")!;
    matchedTopic = "cold-storage";
  }
  // Payment & Escrow
  else if (
    has(
      "payment",
      "escrow",
      "पैसे",
      "पेमेंट",
      "खाते",
      "advance",
      "बँक",
      "बैंक",
      "ਖਾਤੇ",
      "advance",
      "surakshit",
      "paisa",
    )
  ) {
    replyText = pick("payment-escrow")!;
    matchedTopic = "payment-escrow";
  }
  // FPO pooling & aggregation
  else if (
    has("fpo", "pool", "aggregation", "एकत्र", "समूह", "ਸਮੂਹ", "consignment", "bulk", "jodna")
  ) {
    replyText = pick("fpo-pooling")!;
    matchedTopic = "fpo-pooling";
  }
  // Greetings
  else if (
    has(
      "hi",
      "hello",
      "hey",
      "namaste",
      "namaskar",
      "sat sri akaal",
      "sasrikal",
      "pranam",
      "kasa ahes",
      "kaise ho",
    )
  ) {
    replyText = BOT_GREETING[targetLang];
    matchedTopic = "greeting";
  }
  // Fallback
  else {
    replyText = BOT_FALLBACK[targetLang];
    matchedTopic = "fallback";
  }

  return {
    text: replyText,
    detectedLang: detection.lang,
    responseLang: targetLang,
    confidence: detection.confidence,
    matchedTopic,
  };
}

/** Freight + storage estimate for the cold chain calculator. */
export function estimateFreight(input: {
  km: number;
  quintals: number;
  ratePerKm: number;
  storageDays?: number;
  storagePerQuintalPerDay?: number;
}) {
  const trips = Math.max(1, Math.ceil(input.quintals / 180));
  const freight = Math.round(input.km * input.ratePerKm * trips);
  const storage = Math.round(
    (input.storageDays ?? 0) * (input.storagePerQuintalPerDay ?? 0) * input.quintals,
  );
  const kgTotal = input.quintals * 100;
  return {
    trips,
    freight,
    storage,
    total: freight + storage,
    perKg: kgTotal > 0 ? Math.round(((freight + storage) / kgTotal) * 100) / 100 : 0,
  };
}

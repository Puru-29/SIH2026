/**
 * Shared domain models. UI code should import types from here (or `@/services`),
 * never from the mock data modules directly.
 */
export type { Buyer, Coords, Lot, LotStatus, Market, Place, Row } from "@/lib/agri";

export type Testimonial = {
  name: string;
  place: string;
  crop: string;
  quote: string;
  gain: string;
};

export type TickerQuote = {
  crop: string;
  mandi: string;
  price: number;
  change: number;
};

export type Faq = { q: string; a: string };

export type SupportedBotLang = "en" | "hi" | "mr" | "pa" | "hinglish";

export type BotAnswer = {
  id: string;
  chip: string;
  answer: {
    en: string;
    hi: string;
    mr: string;
    pa: string;
    hinglish: string;
  };
};

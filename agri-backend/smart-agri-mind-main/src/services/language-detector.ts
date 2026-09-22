/**
 * Automatic Language Detection Engine for AgriConnect AgriBot (SIH 26132)
 *
 * Supports:
 *  - "en"       : English (Latin script)
 *  - "hi"       : Hindi (Devanagari script)
 *  - "mr"       : Marathi (Devanagari script)
 *  - "pa"       : Punjabi (Gurmukhi script)
 *  - "hinglish" : Hinglish (Hindi/Marathi conversational phrased in Roman/Latin script)
 */

export type SupportedBotLang = "en" | "hi" | "mr" | "pa" | "hinglish";

export interface DetectionResult {
  lang: SupportedBotLang;
  confidence: number;
  script: "Devanagari" | "Gurmukhi" | "Latin" | "Other";
  details: {
    scores: Record<SupportedBotLang, number>;
    matchedMarkers: string[];
    isShortInput: boolean;
  };
}

/* -------------------------------------------------------------------------- */
/*                               TOKEN VOCABULARY                             */
/* -------------------------------------------------------------------------- */

const MARATHI_DISTINCTIVE_CHARS = /[ळऱॲऑ]/;

const MARATHI_DEVANAGARI_WORDS = new Set([
  "आहे", "आहेत", "नाही", "नाहीत", "होते", "होती", "होता", "होईल", "असेल", "असेलच",
  "कधी", "कसा", "कशी", "कसे", "किती", "कुठे", "कोणता", "कोणती", "कोणते", "काय",
  "करावे", "करावा", "करावी", "विकायचे", "विकावे", "पाहिजे", "द्या", "सांगा", "सांग",
  "कांदा", "कांद्याचा", "कांद्याला", "कांद्याचे", "टोमॅटो", "सोयाबीन", "शेतकरी",
  "बाजारभाव", "बाजार", "साठवणूक", "वाहतूक", "निव्वळ", "उत्पन्न", "दर", "पिकाचे",
  "आठवडा", "आठवड्यात", "दिवस", "हप्ता", "भाडे", "नफा", "तोटा", "भाव", "घट", "वाढ",
  "च्या", "मध्ये", "वर", "वरून", "आणि", "पण", "मुळे", "साठी", "कडे", "जवळ",
  "थांबवा", "विका", "ठेवा", "करा", "मिळेल", "घेऊ", "पाहू"
]);

const HINDI_DEVANAGARI_WORDS = new Set([
  "है", "हैं", "था", "थी", "थे", "होगा", "होगी", "होंगे", "होता", "होती",
  "कब", "कहाँ", "कहा", "कैसे", "कैसा", "कैसी", "कितना", "कितने", "कितनी", "क्यों", "क्यो",
  "कौनसा", "कौनसी", "कौन", "क्या", "किसको", "किधर", "बताओ", "बताइए", "बताएं",
  "बेचना", "बेचें", "बेचो", "बिक्री", "रखें", "रखना", "रोकें", "चाहिए", "दीजिए", "करें", "करना",
  "प्याज", "टमाटर", "गेहूं", "धान", "सरसों", "चना", "किसान", "मंडी", "भाव", "दाम",
  "भंडारण", "भाड़ा", "नुकसान", "मुनाफा", "फायदा", "फसल", "शुद्ध", "हफ्ते", "दिन",
  "में", "से", "को", "का", "की", "के", "पर", "और", "या", "लेकिन", "तो", "भी", "लिए",
  "मिलेगा", "मिलेगी", "आएगा", "जाएगा", "सकता", "सकती", "सकते", "अभी", "आज", "कल"
]);

const HINGLISH_WORDS = new Set([
  // Question words
  "kya", "kyu", "kyun", "kaise", "kaisa", "kaisi", "kab", "kaha", "kahan", "kidhar",
  "kitna", "kitne", "kitni", "konsa", "kaunsa", "kon", "kisko", "kiska", "kis",
  // Auxiliaries & Verbs
  "hai", "hain", "h", "he", "tha", "thi", "the", "hoga", "hogi", "honge",
  "kare", "karein", "karna", "karo", "karu", "kar",
  "bechna", "bechu", "bechein", "becho", "bech", "bikega", "biko",
  "rakhe", "rakhna", "rakhu", "roko", "roke", "rukna",
  "batao", "bataiye", "bataye", "bata", "bolo", "boliye",
  "chahiye", "chahta", "chal", "raha", "rahi", "rahe",
  "mil", "milega", "milegi", "milta", "milti", "aayega", "jayega",
  "sakta", "sakti", "sakte", "chahiye", "dekh", "dekho",
  // Pronouns, Particles, Prepositions
  "ka", "ki", "ke", "ko", "se", "me", "mein", "par", "pe", "tak",
  "aur", "ya", "toh", "to", "na", "bhi", "ab", "aaj", "kal", "parso",
  "hum", "humara", "humi", "mera", "meri", "mere", "mujhe", "mujhko",
  "aap", "aapka", "aapki", "aapke", "tum", "tumhara", "tera", "teri", "tere",
  "ye", "yeh", "wo", "woh", "kuch", "koi", "sabse", "jyada", "zyada", "kam", "bohot", "bahut",
  "accha", "achha", "sahi", "galat",
  // Agri Romanized Vocabulary
  "bhav", "bhaav", "bhavu", "mandi", "kisaan", "kisan", "kheti", "fasal", "daam", "dam",
  "pyaj", "pyaaz", "kanda", "tamatar", "gehu", "chana", "soyabean", "soya", "lahsun", "lassan",
  "batata", "aloo", "aalu", "anar", "dalim",
  "kharcha", "faayda", "fayda", "munafa", "nuksan", "bhada", "dalali",
  "vikaycha", "vikayche", "kadhi", "sheti", "shetkari", "bajarbhav", "gavha", "kiti",
  "rate", "rates", "bav", "paisa", "paise", "rupaye"
]);

const HINGLISH_PHRASES = [
  /mandi\s+bhav/i,
  /bhav\s+kya/i,
  /kya\s+rate/i,
  /kitna\s+rate/i,
  /kab\s+bech/i,
  /kahan\s+bech/i,
  /kaha\s+bech/i,
  /kya\s+kare/i,
  /rate\s+kya/i,
  /aaj\s+ka/i,
  /kya\s+chal\s+raha/i,
  /kaisa\s+hai/i,
  /kitna\s+milega/i,
  /kab\s+tak/i,
  /sahi\s+samay/i,
  /sahi\s+time/i,
  /batao\s+na/i,
  /kya\s+bhav/i,
  /ka\s+bhav/i,
  /ka\s+rate/i,
  /ki\s+keemat/i,
  /daam\s+kya/i,
  /bhav\s+chal\s+raha/i,
  /kadhi\s+viku/i,
  /kiti\s+bhav/i
];

const SHORT_GREETINGS: Record<string, SupportedBotLang> = {
  "namaste": "hi",
  "namaskar": "mr",
  "namaskaram": "hi",
  "pranam": "hi",
  "sat sri akaal": "pa",
  "sat siri akal": "pa",
  "sasrikal": "pa",
  "ram ram": "hi",
  "jai kisan": "hi",
  "kasa ahes": "mr",
  "kase ahat": "mr",
  "kaise ho": "hinglish",
  "kya haal hai": "hinglish",
  "hello": "en",
  "hi": "en",
  "hey": "en"
};

/* -------------------------------------------------------------------------- */
/*                              DETECTION LOGIC                               */
/* -------------------------------------------------------------------------- */

export function detectLanguage(
  text: string,
  contextLang: SupportedBotLang = "en",
  lastDetectedLang?: SupportedBotLang
): DetectionResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      lang: contextLang,
      confidence: 1,
      script: "Latin",
      details: { scores: { en: 0, hi: 0, mr: 0, pa: 0, hinglish: 0 }, matchedMarkers: [], isShortInput: true }
    };
  }

  const normalized = trimmed.toLowerCase();

  // 1. Check for distinctive multi-word greetings/short forms
  if (SHORT_GREETINGS[normalized]) {
    const lang = SHORT_GREETINGS[normalized]!;
    return {
      lang,
      confidence: 0.95,
      script: lang === "pa" ? "Gurmukhi" : (lang === "en" || lang === "hinglish") ? "Latin" : "Devanagari",
      details: {
        scores: { en: 0, hi: 0, mr: 0, pa: 0, hinglish: 0, [lang]: 10 },
        matchedMarkers: [normalized],
        isShortInput: true
      }
    };
  }

  // 2. Count Unicode Script Ranges
  let gurmukhiCount = 0;
  let devanagariCount = 0;
  let latinCount = 0;

  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code >= 0x0A00 && code <= 0x0A7F) {
      gurmukhiCount++;
    } else if (code >= 0x0900 && code <= 0x097F) {
      devanagariCount++;
    } else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      latinCount++;
    }
  }

  const totalChars = gurmukhiCount + devanagariCount + latinCount;

  // Case A: Punjabi (Gurmukhi Script)
  if (gurmukhiCount > 0 && gurmukhiCount >= devanagariCount && gurmukhiCount >= latinCount) {
    return {
      lang: "pa",
      confidence: 0.98,
      script: "Gurmukhi",
      details: {
        scores: { en: 0, hi: 0, mr: 0, pa: gurmukhiCount, hinglish: 0 },
        matchedMarkers: ["Gurmukhi script characters"],
        isShortInput: trimmed.split(/\s+/).length <= 2
      }
    };
  }

  // Case B: Devanagari Script (Hindi vs Marathi)
  if (devanagariCount > 0 && devanagariCount >= latinCount) {
    let mrScore = 0;
    let hiScore = 0;
    const matchedMarkers: string[] = [];

    // Distinctive Marathi characters
    if (MARATHI_DISTINCTIVE_CHARS.test(trimmed)) {
      mrScore += 4;
      matchedMarkers.push("Marathi special char (ळ/ऱ/ॲ/ऑ)");
    }

    // Tokenize Devanagari words
    const tokens = trimmed.split(/[\s,।!?.;:]+/).filter(Boolean);
    for (const token of tokens) {
      if (MARATHI_DEVANAGARI_WORDS.has(token)) {
        mrScore += 2;
        matchedMarkers.push(`mr:${token}`);
      }
      if (HINDI_DEVANAGARI_WORDS.has(token)) {
        hiScore += 2;
        matchedMarkers.push(`hi:${token}`);
      }
    }

    let chosenLang: SupportedBotLang;
    let conf = 0.85;

    if (mrScore > hiScore) {
      chosenLang = "mr";
      conf = Math.min(0.98, 0.75 + (mrScore - hiScore) * 0.08);
    } else if (hiScore > mrScore) {
      chosenLang = "hi";
      conf = Math.min(0.98, 0.75 + (hiScore - mrScore) * 0.08);
    } else {
      // Tie-breaker: If user had chosen Hindi/Marathi or last conversation language
      if (contextLang === "mr" || lastDetectedLang === "mr") {
        chosenLang = "mr";
      } else if (contextLang === "hi" || lastDetectedLang === "hi") {
        chosenLang = "hi";
      } else {
        // Default Devanagari for Maharashtra Mandis is Marathi, or Hindi if general
        chosenLang = "mr";
      }
      conf = 0.65;
    }

    return {
      lang: chosenLang,
      confidence: conf,
      script: "Devanagari",
      details: {
        scores: { en: 0, hi: hiScore, mr: mrScore, pa: 0, hinglish: 0 },
        matchedMarkers,
        isShortInput: tokens.length <= 2
      }
    };
  }

  // Case C: Latin Script (English vs Hinglish)
  const tokens = normalized.split(/[\s,!?.;:]+/).filter(Boolean);
  const matchedMarkers: string[] = [];

  // Check for very short ambiguous English words ("ok", "thanks", "yes", "no", "cool", "fine")
  const isGenericShort = tokens.length <= 2 && ["ok", "okay", "thanks", "thank you", "thx", "yes", "no", "done", "fine", "cool", "sure"].includes(normalized);
  if (isGenericShort) {
    const fallback = lastDetectedLang || contextLang || "en";
    return {
      lang: fallback,
      confidence: 0.7,
      script: "Latin",
      details: {
        scores: { en: 1, hi: 0, mr: 0, pa: 0, hinglish: 0 },
        matchedMarkers: ["short-generic-fallback"],
        isShortInput: true
      }
    };
  }

  let hinglishScore = 0;
  let englishScore = 0;

  // Check phrase patterns
  for (const regex of HINGLISH_PHRASES) {
    if (regex.test(normalized)) {
      hinglishScore += 3.5;
      matchedMarkers.push(`phrase:${regex.source}`);
    }
  }

  // Check individual tokens
  for (const word of tokens) {
    if (HINGLISH_WORDS.has(word)) {
      hinglishScore += 1.5;
      matchedMarkers.push(`hinglish:${word}`);
    }
  }

  // Ratio calculation
  const hinglishDensity = tokens.length > 0 ? hinglishScore / tokens.length : 0;

  let chosenLang: SupportedBotLang = "en";
  let confidence = 0.85;

  if (hinglishScore >= 2.5 || (tokens.length <= 4 && hinglishScore >= 1.5) || hinglishDensity >= 0.4) {
    chosenLang = "hinglish";
    confidence = Math.min(0.98, 0.7 + hinglishScore * 0.05);
  } else {
    chosenLang = "en";
    confidence = 0.9;
  }

  return {
    lang: chosenLang,
    confidence,
    script: "Latin",
    details: {
      scores: {
        en: englishScore,
        hi: 0,
        mr: 0,
        pa: 0,
        hinglish: hinglishScore
      },
      matchedMarkers,
      isShortInput: tokens.length <= 2
    }
  };
}

/** Human-readable badge text and speech language map */
export const BOT_LANG_INFO: Record<SupportedBotLang, { name: string; native: string; speechLocale: string }> = {
  en: { name: "English", native: "English", speechLocale: "en-IN" },
  hi: { name: "Hindi", native: "हिंदी", speechLocale: "hi-IN" },
  mr: { name: "Marathi", native: "मराठी", speechLocale: "mr-IN" },
  pa: { name: "Punjabi", native: "ਪੰਜਾਬੀ", speechLocale: "pa-IN" },
  hinglish: { name: "Hinglish", native: "Hinglish", speechLocale: "hi-IN" }
};

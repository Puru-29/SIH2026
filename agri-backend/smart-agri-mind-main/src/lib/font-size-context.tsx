import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type FontSizeLevel = "sm" | "md" | "lg" | "xl";

export const FONT_SIZES: { level: FontSizeLevel; label: string; scale: number; percent: string }[] = [
  { level: "sm", label: "Small", scale: 0.9, percent: "90%" },
  { level: "md", label: "Default (100%)", scale: 1.0, percent: "100%" },
  { level: "lg", label: "Large (115%)", scale: 1.15, percent: "115%" },
  { level: "xl", label: "Extra Large (130%)", scale: 1.3, percent: "130%" },
];

const STORAGE_KEY = "agrisense-font-size-level";

interface FontSizeContextType {
  fontSize: FontSizeLevel;
  setFontSize: (level: FontSizeLevel) => void;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
  resetFontSize: () => void;
  currentScale: number;
  currentPercent: string;
}

const FontSizeContext = createContext<FontSizeContextType>({
  fontSize: "md",
  setFontSize: () => {},
  increaseFontSize: () => {},
  decreaseFontSize: () => {},
  resetFontSize: () => {},
  currentScale: 1.0,
  currentPercent: "100%",
});

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSizeState] = useState<FontSizeLevel>("md");

  // Load from localStorage on mount and apply to document root
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as FontSizeLevel | null;
      if (saved && FONT_SIZES.some((f) => f.level === saved)) {
        setFontSizeState(saved);
        applyRootFontSize(saved);
      }
    } catch {
      // ignore storage access errors
    }
  }, []);

  const applyRootFontSize = (level: FontSizeLevel) => {
    if (typeof document === "undefined") return;
    const found = FONT_SIZES.find((f) => f.level === level) || FONT_SIZES[1]!;
    document.documentElement.style.fontSize = `${found.scale * 100}%`;
    document.documentElement.setAttribute("data-font-size", level);
  };

  const setFontSize = useCallback((level: FontSizeLevel) => {
    setFontSizeState(level);
    applyRootFontSize(level);
    try {
      localStorage.setItem(STORAGE_KEY, level);
    } catch {
      // ignore storage errors
    }
  }, []);

  const increaseFontSize = useCallback(() => {
    const levels: FontSizeLevel[] = ["sm", "md", "lg", "xl"];
    const idx = levels.indexOf(fontSize);
    if (idx < levels.length - 1) {
      setFontSize(levels[idx + 1]!);
    }
  }, [fontSize, setFontSize]);

  const decreaseFontSize = useCallback(() => {
    const levels: FontSizeLevel[] = ["sm", "md", "lg", "xl"];
    const idx = levels.indexOf(fontSize);
    if (idx > 0) {
      setFontSize(levels[idx - 1]!);
    }
  }, [fontSize, setFontSize]);

  const resetFontSize = useCallback(() => {
    setFontSize("md");
  }, [setFontSize]);

  const currentConfig = useMemo(
    () => FONT_SIZES.find((f) => f.level === fontSize) || FONT_SIZES[1]!,
    [fontSize]
  );

  const value = useMemo(
    () => ({
      fontSize,
      setFontSize,
      increaseFontSize,
      decreaseFontSize,
      resetFontSize,
      currentScale: currentConfig.scale,
      currentPercent: currentConfig.percent,
    }),
    [fontSize, setFontSize, increaseFontSize, decreaseFontSize, resetFontSize, currentConfig]
  );

  return <FontSizeContext.Provider value={value}>{children}</FontSizeContext.Provider>;
}

export const useFontSize = () => useContext(FontSizeContext);

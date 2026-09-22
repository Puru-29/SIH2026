import { useFontSize, FONT_SIZES, type FontSizeLevel } from "@/lib/font-size-context";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Type } from "lucide-react";

export function FontSizeControl({ className }: { className?: string }) {
  const { fontSize, setFontSize, increaseFontSize, decreaseFontSize, resetFontSize, currentPercent } = useFontSize();
  const { t } = useI18n();

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-full border border-border bg-card/80 p-1 text-xs backdrop-blur-sm shadow-sm",
        className
      )}
      role="group"
      aria-label={t("Font size adjustment")}
    >
      <span className="hidden items-center gap-1 pl-2 pr-1 font-medium text-muted-foreground sm:inline-flex">
        <Type className="h-3.5 w-3.5" />
        <span className="text-[11px]">{currentPercent}</span>
      </span>

      <button
        onClick={decreaseFontSize}
        disabled={fontSize === "sm"}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors",
          fontSize === "sm"
            ? "cursor-not-allowed opacity-40 text-muted-foreground"
            : "hover:bg-accent text-foreground hover:text-accent-foreground active:scale-95"
        )}
        title={t("Decrease font size (A-)")}
        aria-label={t("Decrease font size (A-)")}
      >
        A-
      </button>

      <button
        onClick={resetFontSize}
        className={cn(
          "flex h-7 px-2 items-center justify-center rounded-full text-xs font-semibold transition-colors",
          fontSize === "md"
            ? "bg-primary text-primary-foreground font-bold shadow-xs"
            : "hover:bg-accent text-foreground hover:text-accent-foreground"
        )}
        title={t("Reset font size to 100%")}
        aria-label={t("Reset font size to 100%")}
      >
        A
      </button>

      <button
        onClick={increaseFontSize}
        disabled={fontSize === "xl"}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors",
          fontSize === "xl"
            ? "cursor-not-allowed opacity-40 text-muted-foreground"
            : "hover:bg-accent text-foreground hover:text-accent-foreground active:scale-95"
        )}
        title={t("Increase font size (A+)")}
        aria-label={t("Increase font size (A+)")}
      >
        A+
      </button>
    </div>
  );
}

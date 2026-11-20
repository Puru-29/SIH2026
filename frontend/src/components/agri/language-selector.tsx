import { Languages } from "lucide-react";
import { LANGUAGES, useI18n, type LangCode } from "@/lib/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function LanguageSelector({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useI18n();

  return (
    <div
      className={`flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 ${className}`}
    >
      <Languages className="h-4 w-4 shrink-0 text-primary" />
      <Select value={lang} onValueChange={(v) => setLang(v as LangCode)}>
        <SelectTrigger
          aria-label={t("Choose language")}
          className="h-auto border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {LANGUAGES.map((l) => (
            <SelectItem key={l.code} value={l.code}>
              <span className="flex flex-col items-start">
                <span className="text-sm">{l.native}</span>
                <span className="text-xs text-muted-foreground">{l.label}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

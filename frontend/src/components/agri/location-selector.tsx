import { MapPin } from "lucide-react";
import { LOCATIONS } from "@/services";
import { useFarmLocation } from "@/lib/location-context";
import { useI18n } from "@/lib/i18n";
import { SERVED_STATES } from "@/lib/service-area";
import { getSession } from "@/services/session";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Signed in: "My farm / My location" (from the profile) or another state, to
 * compare mandi prices there. Change the saved place on the Profile page.
 * Signed out: sample places for the public calculators.
 */
export function LocationSelector({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { location, home, setLocation, viewState } = useFarmLocation();
  const signedIn = getSession() !== null;

  if (!signedIn) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
        <MapPin className="h-4 w-4 shrink-0 text-primary" />
        <Select
          value={location.id}
          onValueChange={(id) => {
            const next = LOCATIONS.find((l) => l.id === id);
            if (next) setLocation(next);
          }}
        >
          <SelectTrigger className="h-auto border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {LOCATIONS.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}, {l.district}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  const mine = getSession()?.role === "buyer" ? t("My location") : t("My farm");
  const value = location.id === "home" ? "home" : location.state;
  const homeLabel = home
    ? `${mine} · ${home.district ? `${home.district}, ` : ""}${home.state}`
    : mine;

  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
      <MapPin className="h-4 w-4 shrink-0 text-primary" />
      <Select value={value} onValueChange={(v) => viewState(v === "home" ? null : v)}>
        <SelectTrigger
          className="h-auto max-w-[11rem] border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 sm:max-w-none dark:bg-transparent"
          aria-label={t("Location used for prices")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {home && <SelectItem value="home">{homeLabel}</SelectItem>}
          {SERVED_STATES.filter((s) => s !== home?.state).map((s) => (
            <SelectItem key={s} value={s}>
              {t("Prices in")} {t(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!compact && location.id !== "home" && home ? (
        <span className="hidden text-xs text-muted-foreground lg:inline">
          {t("Viewing another state")}
        </span>
      ) : null}
    </div>
  );
}

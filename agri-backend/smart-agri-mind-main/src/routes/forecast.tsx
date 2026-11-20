import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  Info,
  Minus,
} from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { kg } from "@/lib/agri";
import { useFarmLocation } from "@/lib/location-context";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { pickHeroLot, useCropOptions, useMyLots } from "@/hooks/use-my-lots";
import { useForecast, useMyProfile } from "@/hooks/use-market";
import { normaliseCropName } from "@/lib/crop-catalog";
import { ErrorNote, Loading, shortDate } from "@/components/fpo/fpo-ui";
import { inrAmount, inrKg } from "@/lib/deal-format";
import type { PriceDriver } from "@/services/api-client";

export const Route = createFileRoute("/forecast")({
  head: () => ({
    meta: [
      { title: "Price Forecast — AgriSense" },
      {
        name: "description",
        content: "Trend-based price outlook from daily mandi prices, with the drivers behind it.",
      },
      { property: "og:title", content: "Price Forecast — AgriSense" },
      {
        property: "og:description",
        content: "See where your crop's mandi price is heading before you sell.",
      },
    ],
  }),
  component: Forecast,
});

const IMPACT: Record<
  PriceDriver["impact"],
  { icon: typeof Minus; tone: "green" | "clay" | "amber" | "muted" }
> = {
  up: { icon: ArrowUpRight, tone: "green" },
  down: { icon: ArrowDownRight, tone: "clay" },
  risk: { icon: AlertTriangle, tone: "amber" },
  neutral: { icon: Minus, tone: "muted" },
};

function Forecast() {
  const { location } = useFarmLocation();
  const { t } = useI18n();
  const { lots, openLots } = useMyLots();
  const { options } = useCropOptions();
  const myCrops = [...new Set(lots.map((l) => l.crop))];
  const [picked, setPicked] = useState<string | undefined>();
  const crop = picked ?? pickHeroLot(lots)?.crop ?? myCrops[0] ?? "Wheat";
  // The farm's state from the profile; the header location picker is the fallback.
  const profile = useMyProfile();
  const state = profile.data?.state ?? (profile.isLoading ? undefined : location.state);
  const fc = useForecast(state ? crop : undefined, state, 14);
  const o = fc.data?.outlook ?? null;

  const chart = (o?.points ?? []).map((p) => ({
    date: p.date.slice(5),
    actual: p.kind === "actual" ? p.price / 100 : null,
    forecast: p.kind === "forecast" ? p.price / 100 : null,
    low: p.low != null ? p.low / 100 : null,
    range: p.low != null && p.high != null ? (p.high - p.low) / 100 : null,
  }));
  // Join the dashed forecast line to the last actual point.
  let lastActual = -1;
  chart.forEach((p, i) => {
    if (p.actual != null) lastActual = i;
  });
  if (lastActual >= 0) chart[lastActual]!.forecast = chart[lastActual]!.actual;
  const week = (n: number) => o?.points.filter((p) => p.kind === "forecast")[n - 1];
  const affected = openLots.filter((l) => normaliseCropName(l.crop) === normaliseCropName(crop));

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Price forecast"
        title="Price Forecast"
        description={`${t("Daily mandi prices for")} ${t(crop)} ${t("in")} ${fc.data?.state ?? location.state}, ${t("projected two weeks ahead from the recent trend.")}`}
      />

      <div className="flex flex-wrap items-center gap-2">
        {myCrops.map((c) => (
          <button
            key={c}
            onClick={() => setPicked(c)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm",
              crop === c
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            {t(c)}
          </button>
        ))}
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("Other crop")}:
          <select
            value={myCrops.includes(crop) ? "" : crop}
            onChange={(e) => e.target.value && setPicked(e.target.value)}
            className="rounded-full border border-border bg-card px-3 py-2 text-sm"
          >
            <option value="">{t("Choose…")}</option>
            {options.map((c) => (
              <option key={c} value={c}>
                {t(c)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-start gap-2 rounded-2xl border border-amber-tag/30 bg-amber-tag/10 px-4 py-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-tag" />
        <p>
          <strong>{t("Trend-based estimate, not a guarantee")}.</strong>{" "}
          <span className="text-muted-foreground">{fc.data?.basis}</span>
        </p>
      </div>

      <ErrorNote error={fc.error} />
      {fc.isLoading ? (
        <Loading label="Loading mandi price history…" />
      ) : fc.data && !o ? (
        <Panel>
          <p className="font-medium">{t("Not enough price history yet")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {fc.data.history_days} {t("day(s) of")} {t(crop)} {t("prices are stored for")}{" "}
            {fc.data.state}.{" "}
            {t(
              "The forecast needs at least 3 days; history builds up each day prices are fetched.",
            )}
          </p>
        </Panel>
      ) : o ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Latest mandi price"
              value={inrKg(o.current)}
              hint={`${t("7-day average")} ${inrKg(o.ma7)}`}
            />
            <Metric
              label="Expected in 7 days"
              value={inrKg(o.expected_7d)}
              hint={`${((o.expected_7d / o.current - 1) * 100).toFixed(1)}%`}
            />
            <Metric
              label="Expected in 14 days"
              value={inrKg(o.expected_14d)}
              hint={`${((o.expected_14d / o.current - 1) * 100).toFixed(1)}%`}
            />
            <Metric
              label="Trend"
              value={t(o.direction)}
              hint={`${o.change_14d_percent >= 0 ? "+" : ""}${o.change_14d_percent}% ${t("in 14 days")} · ${t("volatility")} ${o.volatility_percent}%`}
            />
          </div>

          <Panel>
            <h2 className="font-serif text-2xl">{t("Price curve with confidence band")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "₹ per kg. Solid line: mandi prices. Dashed line: forecast. Shaded: likely range.",
              )}
            </p>
            <div className="mt-6 h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 11 }}
                    stroke="var(--muted-foreground)"
                  />
                  <Tooltip
                    formatter={(v) => (typeof v === "number" ? `₹${v.toFixed(2)}/kg` : "—")}
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                    }}
                  />
                  <Area dataKey="low" stackId="band" stroke="none" fill="transparent" />
                  <Area
                    dataKey="range"
                    name={t("Likely range")}
                    stackId="band"
                    stroke="none"
                    fill="var(--color-sage-soft)"
                  />
                  <Line
                    dataKey="actual"
                    name={t("Mandi price")}
                    stroke="var(--color-forest)"
                    strokeWidth={2.5}
                    dot={false}
                    connectNulls
                  />
                  <Line
                    dataKey="forecast"
                    name={t("Forecast")}
                    stroke="var(--color-forest)"
                    strokeWidth={2.5}
                    strokeDasharray="6 5"
                    dot={false}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel>
              <h2 className="font-serif text-2xl">{t("Two-week outlook")}</h2>
              <div className="mt-5 space-y-4">
                {[7, 14].map((d) => {
                  const p = week(d);
                  if (!p) return null;
                  return (
                    <div
                      key={d}
                      className="flex items-start justify-between gap-4 border-b border-border pb-3 last:border-0"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {t("In")} {d} {t("days")} · {shortDate(p.date)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("Likely range")} {inrKg(p.low ?? p.price)} – {inrKg(p.high ?? p.price)}
                        </p>
                      </div>
                      <p className="font-serif text-lg">{inrKg(p.price)}</p>
                    </div>
                  );
                })}
                {fc.data?.seasonal_note && (
                  <p className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CalendarRange className="mt-0.5 h-4 w-4 shrink-0" /> {fc.data.seasonal_note}
                  </p>
                )}
              </div>
            </Panel>

            <Panel>
              <h2 className="font-serif text-2xl">{t("Price drivers")}</h2>
              <div className="mt-5 space-y-4">
                {(fc.data?.drivers ?? []).map((d) => {
                  const imp = IMPACT[d.impact];
                  const Icon = imp.icon;
                  return (
                    <div key={d.key}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{t(d.label)}</p>
                        <Pill tone={imp.tone}>
                          <Icon className="h-3.5 w-3.5" /> {d.value}
                        </Pill>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{d.detail}</p>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>
        </>
      ) : null}

      <Panel>
        <h2 className="font-serif text-2xl">{t("Impact on your lots")}</h2>
        {affected.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t("You have no open")} {t(crop)} {t("lots.")}
          </p>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {affected.map((lot) => {
              const q = lot.quantityQuintals ?? lot.quantity / 100;
              const change = o ? (o.expected_14d - o.current) * q : 0;
              return (
                <div
                  key={lot.id}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-border p-4"
                >
                  <div>
                    <p className="font-medium">
                      {lot.emoji} {t(lot.crop)} · {lot.id}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {kg(lot.quantity)} ·{" "}
                      {o ? `${t("worth")} ${inrAmount(o.current * q)} ${t("today")}` : ""}
                    </p>
                  </div>
                  {o && (
                    <Pill tone={change >= 0 ? "green" : "clay"}>
                      {change >= 0 ? "+" : "−"}
                      {inrAmount(Math.abs(change))} {t("in 14 days")}
                    </Pill>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </PortalLayout>
  );
}

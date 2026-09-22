import { createFileRoute } from "@tanstack/react-router";
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
import { PortalLayout } from "@/components/agri/portal-layout";
import { Bar as ScoreBar, Metric, PageHeader, Panel, StatusTag } from "@/components/agri/ui-bits";
import { DRIVERS, FORECAST, inr, kg, LOTS } from "@/services";
import { useFarmLocation } from "@/lib/location-context";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/forecast")({
  head: () => ({
    meta: [
      { title: "Price Forecast — AgriSense" },
      { name: "description", content: "Four-week price outlook with confidence band and the drivers behind it." },
      { property: "og:title", content: "Price Forecast — AgriSense" },
      { property: "og:description", content: "See where tomato prices are heading before you sell." },
    ],
  }),
  component: Forecast,
});

const band = FORECAST.map((d) => ({
  ...d,
  lowBand: d.low,
  range: d.low != null && d.high != null ? d.high - d.low : undefined,
}));

function Forecast() {
  const { location } = useFarmLocation();
  const { t } = useI18n();

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Price forecast"
        title="Price Forecast"
        description={`Modelled for Grade A tomato around ${location.district}, using arrivals, weather and buyer enquiry data.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Current price" value="₹30.0/kg" hint={t("Best live offer")} />
        <Metric label="Peak forecast" value="₹31.5/kg" hint="Week of 26 Sep" />
        <Metric label="Expected drift" value="+5.0%" hint="Next 2 weeks" />
        <Metric label="Confidence" value="82%" hint="Widening after 03 Oct" />
      </div>

      <Panel>
        <h2 className="font-serif text-2xl">{t("Price curve with confidence band")}</h2>
        <div className="mt-6 h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={band} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis domain={[18, 38]} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                }}
              />
              <Area dataKey="lowBand" stackId="band" stroke="none" fill="transparent" />
              <Area dataKey="range" stackId="band" stroke="none" fill="var(--color-sage-soft)" />
              <Line
                dataKey="actual"
                stroke="var(--color-forest)"
                strokeWidth={2.5}
                dot={false}
                connectNulls
              />
              <Line
                dataKey="forecast"
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
          <h2 className="font-serif text-2xl">{t("Four-week outlook")}</h2>
          <div className="mt-5 space-y-4">
            {[
              ["Week 1 · 19 Sep", "₹30.8/kg", "Steady arrivals, buyer competition holds"],
              ["Week 2 · 26 Sep", "₹31.5/kg", "Festival demand peak"],
              ["Week 3 · 03 Oct", "₹30.4/kg", "New Kolar arrivals soften prices"],
              ["Week 4 · 10 Oct", "₹28.9/kg", "Post-festival slowdown"],
            ].map(([w, p, n]) => (
              <div key={w} className="flex items-start justify-between gap-4 border-b border-border pb-3 last:border-0">
                <div>
                  <p className="text-sm font-medium">{w}</p>
                  <p className="text-xs text-muted-foreground">{n}</p>
                </div>
                <p className="font-serif text-lg">{p}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <h2 className="font-serif text-2xl">{t("Price drivers")}</h2>
          <div className="mt-5 space-y-5">
            {DRIVERS.map((d) => (
              <div key={d.name}>
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-medium">{d.name}</p>
                  <span className="text-xs text-muted-foreground">{d.score}/100</span>
                </div>
                <p className="text-xs text-muted-foreground">{d.sub}</p>
                <div className="mt-2">
                  <ScoreBar value={d.score} tone={d.score < 50 ? "amber" : "primary"} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel>
        <h2 className="font-serif text-2xl">{t("Impact on your lots")}</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {LOTS.map((lot) => (
            <div
              key={lot.id}
              className="flex items-center justify-between gap-4 rounded-2xl border border-border p-4"
            >
              <div>
                <p className="font-medium">
                  {lot.emoji} {t(lot.crop)} · {lot.id}
                </p>
                <p className="text-xs text-muted-foreground">
                  {kg(lot.quantity)} · {t("Price")} {inr(lot.price)}/kg
                </p>
              </div>
              <StatusTag status={lot.status} />
            </div>
          ))}
        </div>
      </Panel>
    </PortalLayout>
  );
}


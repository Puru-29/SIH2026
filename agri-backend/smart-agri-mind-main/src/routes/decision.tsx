import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Bar as ScoreBar, PageHeader, Panel, Pill, StatusTag } from "@/components/agri/ui-bits";
import { useFarmLocation } from "@/lib/location-context";
import { buildComparison, inr, kg, LOTS, SIGNALS } from "@/services";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useSmartSale, type SmartSaleResponse } from "@/hooks/use-smart-sale";
import { useAcceptOffer } from "@/hooks/use-offers";
import { toast } from "sonner";

export const Route = createFileRoute("/decision")({
  head: () => ({
    meta: [
      { title: "AI Decision Engine — AgriSense" },
      { name: "description", content: "Six weighted signals scored into a sell, hold or split recommendation." },
      { property: "og:title", content: "AI Decision Engine — AgriSense" },
      { property: "og:description", content: "See exactly why AgriSense recommends selling, holding or splitting." },
    ],
  }),
  component: Decision,
});

/** Map the backend strategy string to the UI StatusTag labels */
function strategyLabel(s: SmartSaleResponse["strategy"]): "SELL NOW" | "HOLD" | "SPLIT" {
  if (s === "SELL_NOW") return "SELL NOW";
  if (s === "WAIT") return "HOLD";
  return "SPLIT";
}

function Decision() {
  const { location } = useFarmLocation();
  const { t } = useI18n();
  const [lotId, setLotId] = useState(LOTS[0]!.id);
  const lot = LOTS.find((l) => l.id === lotId)!;
  const rows = buildComparison(location).slice(0, 5);
  const chartData = rows.map((r) => ({ name: r.name.split("—")[0]!.trim(), offer: r.price, net: r.net }));

  // ── Smart-sale mutation ────────────────────────────────────────────────────
  const smartSale = useSmartSale();
  const acceptOffer = useAcceptOffer();

  // Fire an advisory on mount / lot change
  // (crop_id=1 → Tomato, matches the seed data)
  const [liveAdvice, setLiveAdvice] = useState<SmartSaleResponse | null>(null);

  function runAdvisor() {
    smartSale.mutate(
      {
        crop_id: 1,
        quantity_quintals: lot.quantity / 100, // lot.quantity is in kg; backend expects quintals
        current_price_per_quintal: lot.price * 100,
        expected_future_price: lot.price * 110, // +10% hypothetical future
        storage_cost_per_day: 2,
        farmer_urgency: "medium",
        handling_costs: 500,
      },
      {
        onSuccess: (data) => {
          setLiveAdvice(data);
          toast.success(`AI Recommendation: ${data.strategy}`, {
            description: data.reason,
          });
        },
        onError: (err) => {
          toast.error("Advisor unavailable", { description: err.message });
        },
      },
    );
  }

  function handleAcceptOffer() {
    // In the demo we accept offer id=1 (seeded in the DB)
    acceptOffer.mutate(1, {
      onSuccess: (tx) => {
        toast.success(`Offer accepted! Transaction #${tx.id} created.`, {
          description: `Final price: ${inr(tx.final_price / 100)}/kg · Status: ${tx.status}`,
        });
      },
      onError: (err) => {
        toast.error("Could not accept offer", { description: err.message });
      },
    });
  }

  // Derive status from live advice when available, else mock lot status
  const displayStatus = liveAdvice
    ? strategyLabel(liveAdvice.strategy)
    : (lot.status as "SELL NOW" | "HOLD" | "SPLIT");

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="AI decision engine"
        title="Decision breakdown"
        description={`Every channel priced from ${location.name}, ${location.district}, then scored across six weighted signals.`}
      />

      <div className="flex flex-wrap gap-2">
        {LOTS.map((l) => (
          <button
            key={l.id}
            onClick={() => setLotId(l.id)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm transition-colors",
              lotId === l.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            {l.emoji} {t(l.crop)} · {l.id}
          </button>
        ))}
      </div>

      <Panel className="bg-primary text-primary-foreground">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Pill className="bg-primary-foreground/15 text-primary-foreground">
              <Sparkles className="h-3.5 w-3.5" /> {t("AI selling recommendation")}
            </Pill>
            <h2 className="mt-4 font-serif text-3xl">
              {t(displayStatus)} · {t(lot.crop)} {lot.id}
            </h2>
            {liveAdvice ? (
              <p className="mt-2 max-w-2xl text-sm text-primary-foreground/75">
                {liveAdvice.reason} · Net now:{" "}
                {inr(liveAdvice.immediate_net_realisation / 100)}/kg · Net future:{" "}
                {inr(liveAdvice.future_net_realisation / 100)}/kg · Sell ratio:{" "}
                {Math.round(liveAdvice.suggested_sell_ratio * 100)}%
              </p>
            ) : (
              <p className="mt-2 max-w-2xl text-sm text-primary-foreground/75">
                {kg(lot.quantity)} at {lot.grade}. {t("Net realization")} {inr(rows[0]!.net)}/kg
                via {rows[0]!.name} ({rows[0]!.km} km). {t("confidence")} {lot.confidence}%.
              </p>
            )}
          </div>
          <StatusTag status={displayStatus} />
        </div>

        {/* Run advisor / loading */}
        <button
          id="run-advisor-btn"
          onClick={runAdvisor}
          disabled={smartSale.isPending}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary-foreground/15 px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-80 disabled:opacity-60"
        >
          {smartSale.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {smartSale.isPending ? t("Consulting AI…") : t("Get live AI recommendation")}
        </button>
      </Panel>

      <Panel>
        <h2 className="font-serif text-2xl">{t("Offer price vs net realization")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The highest offer is rarely the highest earning once freight and storage are deducted.
        </p>
        <div className="mt-6 h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                }}
              />
              <Bar dataKey="offer" fill="var(--color-sage)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="net" radius={[6, 6, 0, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill="var(--color-forest)" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel>
        <h2 className="font-serif text-2xl">{t("Six decision signals")}</h2>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {SIGNALS.map((s) => (
            <div key={s.title}>
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium">{s.title}</p>
                <span className="text-sm text-muted-foreground">{s.score}/100</span>
              </div>
              <p className="mt-1 text-sm">{s.head}</p>
              <p className="text-xs text-muted-foreground">{s.sub}</p>
              <div className="mt-2">
                <ScoreBar value={s.score} tone={s.score < 50 ? "amber" : "primary"} />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-3">
        {[
          {
            tag: "SELL NOW" as const,
            score: 88,
            body: `Accept ${rows[0]!.name} at ${inr(rows[0]!.price)}/kg. Net ${inr(rows[0]!.net)}/kg after freight.`,
          },
          {
            tag: "HOLD" as const,
            score: 46,
            body: "Forecast band widens after 26 Sep and tomato spoilage runs 6% per week in storage.",
          },
          {
            tag: "SPLIT" as const,
            score: 64,
            body: "Move 3,000 kg now to cover input cost, hold 2,000 kg for the festival window.",
          },
        ].map((c) => (
          <Panel key={c.tag} className={cn(c.tag === displayStatus && "border-primary")}>
            <div className="flex items-center justify-between">
              <StatusTag status={c.tag} />
              <span className="text-sm text-muted-foreground">{c.score}/100</span>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">{c.body}</p>
            {c.tag === displayStatus ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-primary">
                <CheckCircle2 className="h-4 w-4" /> {t("Recommended")}
              </p>
            ) : null}
          </Panel>
        ))}
      </div>

      <Panel className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl">{t("Act on this decision")}</h2>
          <p className="text-sm text-muted-foreground">
            Accepting locks the offer and books a tempo from {location.name}.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            id="accept-offer-btn"
            onClick={handleAcceptOffer}
            disabled={acceptOffer.isPending}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {acceptOffer.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("Accept best offer")}
          </button>
          <button className="rounded-full border border-border px-5 py-2.5 text-sm transition-colors hover:bg-secondary">
            {t("Schedule pickup")}
          </button>
          <button className="rounded-full border border-border px-5 py-2.5 text-sm transition-colors hover:bg-secondary">
            {t("Notify FPO")}
          </button>
        </div>
      </Panel>
    </PortalLayout>
  );
}

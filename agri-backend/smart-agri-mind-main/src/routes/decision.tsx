import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { AlertCircle, CheckCircle2, Loader2, Sparkles, X } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Bar as ScoreBar, PageHeader, Panel, Pill, StatusTag } from "@/components/agri/ui-bits";
import { useFarmLocation } from "@/lib/location-context";
import { buildComparison, inr, kg, LOTS, SIGNALS } from "@/services";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useSmartSale, type SmartSaleResponse } from "@/hooks/use-smart-sale";
import { useAcceptOffer, useOffers } from "@/hooks/use-offers";
import { useCrops } from "@/hooks/use-crops";
import { useEnsureCrop, useMyLots } from "@/hooks/use-my-lots";
import { getSession } from "@/services/session";
import { normaliseCropName } from "@/lib/crop-catalog";
import type { Lot } from "@/services";
import { toast } from "sonner";

export const Route = createFileRoute("/decision")({
  validateSearch: (search: Record<string, unknown>): { lot?: string } =>
    typeof search["lot"] === "string" ? { lot: search["lot"] } : {},
  head: () => ({
    meta: [
      { title: "AI Decision Engine — AgriSense" },
      {
        name: "description",
        content: "Six weighted signals scored into a sell, hold or split recommendation.",
      },
      { property: "og:title", content: "AI Decision Engine — AgriSense" },
      {
        property: "og:description",
        content: "See exactly why AgriSense recommends selling, holding or splitting.",
      },
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
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const signedIn = Boolean(getSession());
  const { lots: myLots } = useMyLots();
  // Your registered lots first; sample lots when you have none (or are signed out).
  const lots: Lot[] = signedIn && myLots.length > 0 ? myLots : LOTS;
  const lot = lots.find((l) => l.id === search.lot) ?? lots[0]!;
  const lotId = lot.id;
  const setLotId = (id: string) => void navigate({ search: { lot: id }, replace: true });

  const rows = buildComparison(location).slice(0, 5);
  const chartData = rows.map((r) => ({
    name: r.name.split("—")[0]!.trim(),
    offer: r.price,
    net: r.net,
  }));

  const { data: crops = [] } = useCrops();
  const ensureCrop = useEnsureCrop();
  const smartSale = useSmartSale();
  const acceptOffer = useAcceptOffer();
  const { data: offers = [] } = useOffers();

  // Advice is stored per lot so switching lots never shows another lot's result.
  const [adviceByLot, setAdviceByLot] = useState<Record<string, SmartSaleResponse>>({});
  const [adviceError, setAdviceError] = useState<{ lotId: string; message: string } | null>(null);
  const liveAdvice = adviceByLot[lotId] ?? null;
  const advising = ensureCrop.isPending || smartSale.isPending;

  async function resolveCropId(): Promise<number> {
    if (lot.cropId) return lot.cropId;
    const key = normaliseCropName(lot.crop);
    const known = crops.find((c) => normaliseCropName(c.name) === key);
    if (known) return known.id;
    return (await ensureCrop.mutateAsync(lot.crop)).id;
  }

  async function runAdvisor() {
    setAdviceError(null);
    try {
      const cropId = await resolveCropId();
      const data = await smartSale.mutateAsync({
        crop_id: cropId,
        quantity_quintals: lot.quantity / 100, // lot.quantity is in kg; backend expects quintals
        current_price_per_quintal: lot.price * 100,
        expected_future_price: lot.price * 110, // +10% hypothetical future
        storage_cost_per_day: 2,
        farmer_urgency: "medium",
        handling_costs: 500,
      });
      setAdviceByLot((prev) => ({ ...prev, [lot.id]: data }));
    } catch (err) {
      setAdviceError({ lotId: lot.id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  // Best pending buyer offer on the selected lot (only real lots have offers).
  const bestOffer = useMemo(
    () =>
      offers
        .filter(
          (o) =>
            o.lot_id === lot.backendId && o.status === "pending" && o.created_by_role === "buyer",
        )
        .sort((a, b) => b.price_offered - a.price_offered)[0],
    [offers, lot.backendId],
  );

  function handleAcceptOffer() {
    if (!bestOffer) return;
    acceptOffer.mutate(bestOffer.id, {
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

  // Derive status from live advice when available, else lot status
  const displayStatus = liveAdvice ? strategyLabel(liveAdvice.strategy) : lot.status;
  const sellPct = liveAdvice ? Math.round(liveAdvice.suggested_sell_ratio * 100) : 0;
  const sellKg = liveAdvice ? Math.round(lot.quantity * liveAdvice.suggested_sell_ratio) : 0;
  const gainPct =
    liveAdvice && liveAdvice.immediate_net_realisation > 0
      ? ((liveAdvice.future_net_realisation - liveAdvice.immediate_net_realisation) /
          liveAdvice.immediate_net_realisation) *
        100
      : 0;

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="AI decision engine"
        title="Decision breakdown"
        description={`Every channel priced from ${location.name}, ${location.district}, then scored across six weighted signals.`}
      />

      <div className="flex flex-wrap gap-2">
        {lots.map((l) => (
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
            <p className="mt-2 max-w-2xl text-sm text-primary-foreground/75">
              {kg(lot.quantity)} at {lot.grade}. {t("Net realization")} {inr(rows[0]!.net)}/kg via{" "}
              {rows[0]!.name} ({rows[0]!.km} km). {t("confidence")} {lot.confidence}%.
            </p>
          </div>
          <StatusTag status={displayStatus} />
        </div>

        {/* Run advisor — result renders right below the button */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            id="run-advisor-btn"
            onClick={runAdvisor}
            disabled={advising}
            aria-controls="advisor-result"
            className="inline-flex items-center gap-2 rounded-full bg-primary-foreground/15 px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-80 disabled:opacity-60"
          >
            {advising ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {advising
              ? t("Consulting AI…")
              : liveAdvice
                ? t("Refresh AI recommendation")
                : t("Get live AI recommendation")}
          </button>
          {liveAdvice && !advising && (
            <span className="text-xs text-primary-foreground/60">{t("Updated just now")}</span>
          )}
        </div>

        <div id="advisor-result" aria-live="polite">
          {advising && !liveAdvice && (
            <div className="mt-4 h-28 animate-pulse rounded-2xl bg-primary-foreground/10" />
          )}

          {adviceError?.lotId === lotId && !advising && (
            <div className="mt-4 flex items-start gap-3 rounded-2xl bg-destructive/20 p-4 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">{t("Advisor unavailable")}</p>
                <p className="text-primary-foreground/75">{adviceError.message}</p>
              </div>
              <button onClick={() => setAdviceError(null)} aria-label={t("Dismiss")}>
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {liveAdvice && (
            <div
              className={cn(
                "mt-4 rounded-2xl border border-primary-foreground/15 bg-primary-foreground/10 p-5 transition-opacity",
                advising && "opacity-60",
              )}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-primary-foreground px-3 py-1 text-xs font-semibold tracking-wide text-primary">
                  {t(displayStatus)}
                </span>
                <span className="text-xs text-primary-foreground/60">
                  {t("Strategy")}: {liveAdvice.strategy.replace("_", " ")}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed">{liveAdvice.reason}</p>

              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  [t("Net if sold now"), `${inr(liveAdvice.immediate_net_realisation / 100)}/kg`],
                  [t("Net if held"), `${inr(liveAdvice.future_net_realisation / 100)}/kg`],
                  [t("Expected gain"), `${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(1)}%`],
                  [t("Sell now"), `${kg(sellKg)}`],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-[11px] uppercase tracking-wide text-primary-foreground/60">
                      {label}
                    </p>
                    <p className="mt-0.5 font-serif text-xl">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <div className="flex justify-between text-xs text-primary-foreground/70">
                  <span>
                    {t("Sell now")} {sellPct}%
                  </span>
                  <span>
                    {t("Hold")} {100 - sellPct}%
                  </span>
                </div>
                <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-primary-foreground/15">
                  <div className="bg-primary-foreground" style={{ width: `${sellPct}%` }} />
                </div>
              </div>
            </div>
          )}
        </div>
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
            {bestOffer
              ? `Best buyer offer on ${lot.id}: ${inr(bestOffer.price_offered / 100)}/kg. Accepting locks the offer and books a tempo from ${location.name}.`
              : lot.backendId
                ? t("No pending buyer offers on this lot yet.")
                : t("Sample lot — register a real lot to receive and accept buyer offers.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            id="accept-offer-btn"
            onClick={handleAcceptOffer}
            disabled={acceptOffer.isPending || !bestOffer}
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

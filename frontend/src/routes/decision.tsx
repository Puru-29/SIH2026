import { createFileRoute, Link } from "@tanstack/react-router";
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
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  Minus,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { PageHeader, Panel, Pill, StatusTag } from "@/components/agri/ui-bits";
import { useFarmLocation } from "@/lib/location-context";
import { kg, type LotStatus } from "@/lib/agri";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useSmartSale, type SmartSaleResponse } from "@/hooks/use-smart-sale";
import { useOffers } from "@/hooks/use-offers";
import { useMatchingBuyers } from "@/hooks/use-lots";
import { pickHeroLot, useMyLots } from "@/hooks/use-my-lots";
import { useLotSignals } from "@/hooks/use-market";
import { Loading } from "@/components/fpo/fpo-ui";
import { MessageLink, OfferActions } from "@/components/agri/deal-ui";
import { inrAmount, inrKg } from "@/lib/deal-format";
import type { PriceDriver } from "@/services/api-client";

export const Route = createFileRoute("/decision")({
  validateSearch: (search: Record<string, unknown>): { lot?: string } =>
    typeof search["lot"] === "string" ? { lot: search["lot"] } : {},
  head: () => ({
    meta: [
      { title: "AI Decision Engine — AgriSense" },
      {
        name: "description",
        content:
          "Price trend, buyer demand, shelf life and freight turned into a sell, hold or split recommendation.",
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
function strategyLabel(s: SmartSaleResponse["strategy"]): LotStatus {
  if (s === "SELL_NOW") return "SELL NOW";
  if (s === "WAIT") return "HOLD";
  return "SPLIT";
}

const IMPACT: Record<
  PriceDriver["impact"],
  { icon: typeof Minus; tone: "green" | "clay" | "amber" | "muted"; label: string }
> = {
  up: { icon: ArrowUpRight, tone: "green", label: "Supports a better price" },
  down: { icon: ArrowDownRight, tone: "clay", label: "Pushes the price down" },
  risk: { icon: AlertTriangle, tone: "amber", label: "Reason to sell soon" },
  neutral: { icon: Minus, tone: "muted", label: "Neutral" },
};

function Decision() {
  const { location } = useFarmLocation();
  const { t } = useI18n();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { lots, openLots, isLoading } = useMyLots();
  const lot = openLots.find((l) => l.id === search.lot) ?? pickHeroLot(lots);
  const setLotId = (id: string) => void navigate({ search: { lot: id }, replace: true });

  const signals = useLotSignals(lot?.backendId);
  const buyers = useMatchingBuyers(lot?.backendId);
  const smartSale = useSmartSale();
  const { data: offers = [] } = useOffers();

  // Advice is stored per lot so switching lots never shows another lot's result.
  const [adviceByLot, setAdviceByLot] = useState<Record<string, SmartSaleResponse>>({});
  const [adviceError, setAdviceError] = useState<{ lotId: string; message: string } | null>(null);
  const liveAdvice = lot ? (adviceByLot[lot.id] ?? null) : null;
  const advising = smartSale.isPending;
  const inputs = signals.data?.smart_sale_inputs ?? null;

  async function runAdvisor() {
    if (!lot || !inputs) return;
    setAdviceError(null);
    try {
      const data = await smartSale.mutateAsync(inputs);
      setAdviceByLot((prev) => ({ ...prev, [lot.id]: data }));
    } catch (err) {
      setAdviceError({ lotId: lot.id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (isLoading) {
    return (
      <PortalLayout>
        <Loading />
      </PortalLayout>
    );
  }

  if (!lot) {
    return (
      <PortalLayout>
        <PageHeader
          eyebrow="AI decision engine"
          title="Decision breakdown"
          description="Price trend, buyer demand, shelf life and freight, turned into a sell, hold or split recommendation."
        />
        <Panel className="flex flex-col items-start gap-3">
          <p className="font-serif text-2xl">
            {t("You have no open lots yet — add your first lot")}
          </p>
          <Link
            to="/crops"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
          >
            <Plus className="h-4 w-4" /> {t("Register lot")}
          </Link>
        </Panel>
      </PortalLayout>
    );
  }

  const qtyQ = lot.quantityQuintals ?? lot.quantity / 100;
  const displayStatus = liveAdvice ? strategyLabel(liveAdvice.strategy) : lot.status;
  const sellPct = liveAdvice ? Math.round(liveAdvice.suggested_sell_ratio * 100) : 0;
  const sellKg = liveAdvice ? Math.round(lot.quantity * liveAdvice.suggested_sell_ratio) : 0;
  const gainPct =
    liveAdvice && liveAdvice.immediate_net_realisation > 0
      ? ((liveAdvice.future_net_realisation - liveAdvice.immediate_net_realisation) /
          liveAdvice.immediate_net_realisation) *
        100
      : 0;
  const current = signals.data?.current_price ?? null;
  const expected = signals.data?.expected_price ?? null;
  const horizon = signals.data?.horizon_days ?? 14;

  // Channels: each matching buyer (price and what is left after freight), plus the mandi median.
  const chartData = [
    ...(buyers.data ?? []).slice(0, 5).map((b) => ({
      name: (b.buyer_name ?? `Buyer ${b.buyer_id}`).split(" ").slice(0, 2).join(" "),
      offer: Math.round(b.max_price) / 100,
      net: Math.round(b.net_price_per_quintal ?? b.max_price) / 100,
    })),
    ...(current ? [{ name: t("Mandi (median)"), offer: current / 100, net: current / 100 }] : []),
  ];
  const lotOffers = offers.filter((o) => o.lot_id === lot.backendId && o.status === "pending");

  const cards: { tag: LotStatus; body: string }[] = [
    {
      tag: "SELL NOW",
      body: current
        ? `${t("Sell all")} ${kg(lot.quantity)} ${t("now at about")} ${inrKg(current)} — ${inrAmount(current * qtyQ)} ${t("before costs")}.`
        : t("Sell the whole lot now to the best buyer."),
    },
    {
      tag: "HOLD",
      body: expected
        ? `${t("Hold for about")} ${horizon} ${t("days. Expected")} ${inrKg(expected)}${current ? ` (${expected >= current ? "+" : ""}${(((expected - current) / current) * 100).toFixed(1)}%)` : ""}. ${t("Storage costs and quality loss reduce the gain.")}`
        : t("Hold if prices are expected to rise and the crop stores well."),
    },
    {
      tag: "SPLIT",
      body: `${t("Sell half")} (${kg(Math.round(lot.quantity / 2))}) ${t("now to cover costs and hold the rest for a better price.")}`,
    },
  ];

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="AI decision engine"
        title="Decision breakdown"
        description={`${t("Live mandi prices in")} ${signals.data?.state ?? location.state}, ${t("open buyer demand, shelf life and freight for this lot.")}`}
      />

      <div className="flex flex-wrap gap-2">
        {openLots.map((l) => (
          <button
            key={l.id}
            onClick={() => setLotId(l.id)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm transition-colors",
              lot.id === l.id
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
              {kg(lot.quantity)} · {lot.grade}.{" "}
              {current
                ? `${t("Today")}: ${inrKg(current)} (${t(signals.data?.current_price_source ?? "")}).`
                : signals.isLoading
                  ? t("Checking today's mandi prices…")
                  : t("No live mandi price for this crop today.")}
              {expected && current
                ? ` ${t("Expected in")} ${horizon} ${t("days")}: ${inrKg(expected)}.`
                : ""}
            </p>
          </div>
          <StatusTag status={displayStatus} />
        </div>

        {/* Run advisor — result renders right below the button */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            id="run-advisor-btn"
            onClick={runAdvisor}
            disabled={advising || !inputs}
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
          {!inputs && !signals.isLoading && (
            <span className="text-xs text-primary-foreground/70">
              {t("Needs a live or stored mandi price for this crop.")}
            </span>
          )}
          {liveAdvice && !advising && (
            <span className="text-xs text-primary-foreground/60">{t("Updated just now")}</span>
          )}
        </div>

        <div id="advisor-result" aria-live="polite">
          {advising && !liveAdvice && (
            <div className="mt-4 h-28 animate-pulse rounded-2xl bg-primary-foreground/10" />
          )}

          {adviceError?.lotId === lot.id && !advising && (
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
                  [t("Net if sold now"), inrAmount(liveAdvice.immediate_net_realisation)],
                  [t("Net if held"), inrAmount(liveAdvice.future_net_realisation)],
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
        <p className="mt-4 text-xs text-primary-foreground/60">
          {t("Trend-based estimate, not a guarantee")}
        </p>
      </Panel>

      <Panel>
        <h2 className="font-serif text-2xl">{t("Offer price vs net realization")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "₹ per kg. Buyer prices are delivered prices; the net bar is what is left after freight.",
          )}
        </p>
        {buyers.isLoading || signals.isLoading ? (
          <Loading />
        ) : chartData.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            {t("No buyer requirement or mandi price to compare for this crop yet.")}
          </p>
        ) : (
          <div className="mt-6 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <Tooltip
                  formatter={(v) => (typeof v === "number" ? `₹${v.toFixed(2)}/kg` : "—")}
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                  }}
                />
                <Bar
                  dataKey="offer"
                  name={t("Price")}
                  fill="var(--color-sage)"
                  radius={[6, 6, 0, 0]}
                />
                <Bar dataKey="net" name={t("After freight")} radius={[6, 6, 0, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill="var(--color-forest)" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel>
        <h2 className="font-serif text-2xl">{t("Decision signals")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "Worked out from live mandi prices, AgriSense buyer demand, the crop's shelf life and freight rates.",
          )}
        </p>
        {signals.isLoading ? (
          <Loading />
        ) : signals.error ? (
          <p className="mt-4 text-sm text-destructive">{signals.error.message}</p>
        ) : (
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {(signals.data?.drivers ?? []).map((d) => {
              const imp = IMPACT[d.impact];
              const Icon = imp.icon;
              return (
                <div key={d.key} className="rounded-2xl border border-border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{t(d.label)}</p>
                    <Pill tone={imp.tone}>
                      <Icon className="h-3.5 w-3.5" /> {t(imp.label)}
                    </Pill>
                  </div>
                  <p className="mt-2 font-serif text-lg">{d.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{d.detail}</p>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <div className="grid gap-5 md:grid-cols-3">
        {cards.map((c) => (
          <Panel key={c.tag} className={cn(c.tag === displayStatus && "border-primary")}>
            <StatusTag status={c.tag} />
            <p className="mt-4 text-sm text-muted-foreground">{c.body}</p>
            {c.tag === displayStatus ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-primary">
                <CheckCircle2 className="h-4 w-4" /> {t("Recommended")}
              </p>
            ) : null}
          </Panel>
        ))}
      </div>

      <Panel>
        <h2 className="font-serif text-2xl">{t("Act on this decision")}</h2>
        {lotOffers.length === 0 ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {t("No pending offers on this lot yet. Send an offer to a matching buyer.")}
            </p>
            <Link
              to="/buyers"
              search={{ lot: lot.id }}
              className="rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
            >
              {t("Find buyers")}
            </Link>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {lotOffers.map((o) => (
              <div
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4"
              >
                <div>
                  <p className="font-medium">{o.buyer_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {inrKg(o.price_offered)} · {inrAmount(o.price_offered * qtyQ)}{" "}
                    {t("for the lot")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <OfferActions offer={o} myRole="farmer" compact />
                  <MessageLink userId={o.buyer_id} className="px-3 py-1.5 text-xs" />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </PortalLayout>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Brain, Send, ShieldCheck, TrendingUp, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { getLiveMandiPrices } from "@/services/api-client";
import { fpoApi, type Advice } from "@/services/fpo-api";
import { useFpoQuery } from "@/hooks/use-fpo";
import { SendOfferModal, TrustLine } from "@/components/fpo/offer-ui";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorNote,
  inputCls,
  Input,
  Loading,
  Meter,
  PageTitle,
  quintals,
  rupees,
  Select,
  shortDate,
  Table,
  VerifiedBadge,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/fpo/market")({
  component: MarketPage,
});

const STRATEGY: Record<
  Advice["advice"]["strategy"],
  { label: string; tone: "green" | "amber" | "olive" }
> = {
  SELL_NOW: { label: "Sell now", tone: "green" },
  WAIT: { label: "Hold", tone: "amber" },
  PARTIAL_SELL: { label: "Split: sell part now", tone: "olive" },
};

function MarketPage() {
  const { t } = useI18n();
  const lots = useFpoQuery(["lots"], fpoApi.lots);
  const org = useFpoQuery(["org"], fpoApi.org);
  const sellable = lots.data?.filter((l) => l.available_quintals > 0) ?? [];
  const [lotId, setLotId] = useState("");
  const lot = sellable.find((l) => l.id === Number(lotId)) ?? sellable[0];

  return (
    <>
      <PageTitle
        title="Market Intelligence"
        subtitle="Live mandi prices, selling advice, buyer matching and demand for your bulk lots. Estimates are labelled."
      />
      {lots.isLoading ? (
        <Loading />
      ) : sellable.length === 0 ? (
        <Card>
          <Empty
            icon={<TrendingUp className="h-6 w-6" />}
            title="No unsold lots"
            body="Create a bulk lot to get selling advice and buyer matches."
          />
        </Card>
      ) : (
        <>
          <div className="max-w-xl">
            <Select
              id="mi-lot"
              label="Choose lot"
              value={lot ? String(lot.id) : ""}
              onChange={(e) => setLotId(e.target.value)}
            >
              {sellable.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.lot_code} · {t(l.crop_name)} · {quintals(l.available_quintals)}{" "}
                  {t("available")}
                </option>
              ))}
            </Select>
          </div>
          {lot && (
            <div className="grid gap-5 xl:grid-cols-2">
              <AdviceCard lotId={lot.id} key={`a-${lot.id}`} />
              <MandiCard crop={lot.crop_name} state={org.data?.state ?? "Maharashtra"} />
              <div className="xl:col-span-2">
                <MatchesCard lotId={lot.id} key={`m-${lot.id}`} />
              </div>
            </div>
          )}
        </>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        <DemandCard />
        <ProfitCalculator />
      </div>
      <TrustCard />
    </>
  );
}

function AdviceCard({ lotId }: { lotId: number }) {
  const { t } = useI18n();
  const advice = useMutation<Advice, Error>({ mutationFn: () => fpoApi.advice(lotId) });
  const a = advice.data;
  return (
    <Card
      title="AI Bulk Selling"
      subtitle="Sell now, hold or split — based on live mandi prices, price trend, storage cost and buyer demand."
    >
      <Btn
        icon={<Brain className="h-5 w-5" />}
        size="lg"
        busy={advice.isPending}
        onClick={() => advice.mutate()}
      >
        {a ? t("Refresh advice") : t("Get selling advice")}
      </Btn>
      {advice.error && (
        <p className="mt-4 flex gap-2 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {advice.error.message}
        </p>
      )}
      {a && (
        <div className="mt-5 space-y-4">
          <div className="fpo-hero rounded-2xl p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[var(--fpo-gold)] px-3 py-1 text-sm font-bold text-[var(--fpo-gold-ink)]">
                {t(STRATEGY[a.advice.strategy].label)}
              </span>
              <span className="text-xs text-white/70">
                {t("Estimate")} · {a.crop}, {a.state}
              </span>
            </div>
            <p className="mt-3 text-base text-white/90">{a.advice.reason}</p>
            {a.advice.strategy === "PARTIAL_SELL" && (
              <p className="mt-2 text-sm text-white/80">
                {t("Sell now")}: {quintals(a.available_quintals * a.advice.suggested_sell_ratio)} ·{" "}
                {t("Hold")}: {quintals(a.available_quintals * (1 - a.advice.suggested_sell_ratio))}
              </p>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {[
              ["Mandi price today (median)", `${rupees(a.current_price)}/q`],
              ["Mandis reporting", String(a.markets_reporting)],
              ["Best open offer", a.best_open_offer ? `${rupees(a.best_open_offer)}/q` : "—"],
              ["Expected price", `${rupees(a.expected_price)}/q`],
              [
                "Price trend",
                a.trend_available
                  ? `${a.trend_per_day >= 0 ? "+" : ""}${rupees(a.trend_per_day)}/q ${t("per day")}`
                  : t("Not available"),
              ],
              ["Open buyer demand", quintals(a.open_demand_quintals)],
            ].map(([l, v]) => (
              <div key={l} className="rounded-xl bg-secondary p-3">
                <dt className="text-xs text-muted-foreground">{t(l!)}</dt>
                <dd className="mt-0.5 font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {a.best_market && (
            <p className="text-sm">
              {t("Highest mandi today")}: <strong>{a.best_market.market}</strong>{" "}
              {a.best_market.district && `(${a.best_market.district})`} ·{" "}
              {rupees(a.best_market.modal_price)}/q
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {t("How this is calculated")}: {a.basis}
          </p>
        </div>
      )}
    </Card>
  );
}

function MandiCard({ crop, state }: { crop: string; state: string }) {
  const { t } = useI18n();
  const prices = useQuery({
    queryKey: ["fpo", "mandi", state, crop],
    queryFn: () => getLiveMandiPrices({ state, commodity: crop }),
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const rows = [...(prices.data ?? [])].sort((a, b) => b.modal_price - a.modal_price).slice(0, 8);
  return (
    <Card
      title={`${t("Live mandi prices")} · ${t(crop)}`}
      subtitle={`${state} · ${t("Source: Mandi API (data.gov.in)")}`}
    >
      {prices.isLoading ? (
        <Loading />
      ) : prices.error ? (
        <p className="text-sm text-destructive">
          {t("Mandi prices are unavailable right now")}: {prices.error.message}
        </p>
      ) : rows.length === 0 ? (
        <Empty title="No mandi reported this crop today" />
      ) : (
        <Table head={["Mandi", "District", "Min", "Modal", "Max", "Date"]}>
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="font-medium">{p.market}</td>
              <td>{p.district ?? "—"}</td>
              <td className="tabular-nums">{rupees(p.min_price)}</td>
              <td className="font-semibold tabular-nums">{rupees(p.modal_price)}</td>
              <td className="tabular-nums">{rupees(p.max_price)}</td>
              <td className="text-sm">{p.date}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function MatchesCard({ lotId }: { lotId: number }) {
  const { t } = useI18n();
  const m = useFpoQuery(["matches", lotId], () => fpoApi.matches(lotId));
  const [sending, setSending] = useState<{ buyerId: number; price: number } | null>(null);
  return (
    <Card title="Smart Buyer Matching" subtitle={m.data?.basis}>
      <ErrorNote error={m.error} />
      {m.isLoading ? (
        <Loading />
      ) : !m.data?.matches.length ? (
        <Empty
          icon={<Users className="h-6 w-6" />}
          title="No buyer requirements for this crop right now"
          body="You can still send offers to any buyer from the Buyer Marketplace."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {m.data.matches.map((x) => (
            <div key={x.demand.id} className="rounded-2xl border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-semibold">{x.demand.buyer_name}</p>
                    <VerifiedBadge verified={x.buyer_verified} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {quintals(x.demand.min_quantity)}+ · {t("up to")} {rupees(x.demand.max_price)}/q
                    · {x.demand.required_quality} · {x.demand.delivery_location} · {t("by")}{" "}
                    {shortDate(x.demand.required_by)}
                  </p>
                </div>
                <span className="text-right">
                  <span className="font-serif text-3xl tabular-nums">{x.score}</span>
                  <span className="block text-xs text-muted-foreground">{t("match score")}</span>
                </span>
              </div>
              <div className="mt-3 grid grid-cols-5 gap-2 text-center text-xs">
                {(
                  [
                    ["quantity", "Quantity"],
                    ["price", "Price"],
                    ["quality", "Quality"],
                    ["reliability", "Payment record"],
                    ["location", "Location"],
                  ] as const
                ).map(([k, l]) => (
                  <div key={k}>
                    <Meter
                      value={x.parts[k]}
                      max={100}
                      tone={x.parts[k] >= 70 ? "primary" : "gold"}
                    />
                    <p className="mt-1 text-muted-foreground">{t(l)}</p>
                  </div>
                ))}
              </div>
              <Btn
                className="mt-4"
                variant="outline"
                icon={<Send className="h-4 w-4" />}
                onClick={() =>
                  setSending({ buyerId: x.demand.buyer_id, price: x.demand.max_price })
                }
              >
                {t("Send offer")}
              </Btn>
            </div>
          ))}
        </div>
      )}
      {sending && (
        <SendOfferModal
          lotId={lotId}
          buyerId={sending.buyerId}
          suggestedPrice={sending.price}
          onClose={() => setSending(null)}
        />
      )}
    </Card>
  );
}

function DemandCard() {
  const { t } = useI18n();
  const d = useFpoQuery(["demand"], fpoApi.demand);
  return (
    <Card title="Demand Forecasting" subtitle={d.data?.basis}>
      <ErrorNote error={d.error} />
      {d.isLoading ? (
        <Loading />
      ) : !d.data?.requirements.length ? (
        <Empty
          title="No upcoming buyer requirements"
          body="Demand appears here when buyers post requirements on AgriSense."
        />
      ) : (
        <Table head={["Month", "Crop", "Quantity needed", "Buyers", "Avg max price", "Your stock"]}>
          {d.data.requirements.map((r) => {
            const stock =
              d.data!.your_stock.find((s) => s.crop === r.crop)?.available_quintals ?? 0;
            return (
              <tr key={`${r.month}-${r.crop}`}>
                <td>{r.month}</td>
                <td className="font-medium">{t(r.crop)}</td>
                <td className="tabular-nums">{quintals(r.quantity_quintals)}</td>
                <td className="tabular-nums">{r.buyers}</td>
                <td className="tabular-nums">{rupees(r.avg_max_price)}/q</td>
                <td
                  className={cn(
                    "tabular-nums",
                    stock >= r.quantity_quintals
                      ? "text-[var(--fpo-good)]"
                      : "text-muted-foreground",
                  )}
                >
                  {quintals(stock)}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
      {d.data && d.data.recent_offers.length > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("Offers on FPO lots in the last 30 days")}:{" "}
          {d.data.recent_offers
            .map((o) => `${t(o.crop)} ${quintals(o.quantity_quintals)} @ ${rupees(o.avg_price)}/q`)
            .join(" · ")}
        </p>
      )}
    </Card>
  );
}

function ProfitCalculator() {
  const { t } = useI18n();
  const members = useFpoQuery(["members", "", "active"], () => fpoApi.members("", "active"));
  const org = useFpoQuery(["org"], fpoApi.org);
  const [f, setF] = useState({
    member: "",
    qty: "20",
    price: "2400",
    transport: "40",
    storage: "15",
    handling: "10",
    cost: "1200",
  });
  const n = (k: keyof typeof f) => Number(f[k] || 0);
  const pct = org.data?.commission_pct ?? 2;
  const gross = n("qty") * n("price");
  const fees = n("qty") * (n("transport") + n("storage") + n("handling")) + (gross * pct) / 100;
  const net = gross - fees;
  const profit = net - n("qty") * n("cost");
  return (
    <Card
      title="Farmer Profit Calculator"
      subtitle="What a farmer takes home after FPO expenses and their own cost of growing."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="pc-member"
          label="Farmer (optional)"
          value={f.member}
          onChange={(e) => {
            const m = members.data?.find((x) => x.id === Number(e.target.value));
            setF({
              ...f,
              member: e.target.value,
              qty: m && m.contributed_quintals > 0 ? String(m.contributed_quintals) : f.qty,
            });
          }}
        >
          <option value="">{t("Any farmer")}</option>
          {members.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} · {quintals(m.contributed_quintals)}
            </option>
          ))}
        </Select>
        <Input
          id="pc-qty"
          label="Quantity (quintals)"
          type="number"
          min={0}
          value={f.qty}
          onChange={(e) => setF({ ...f, qty: e.target.value })}
        />
        <Input
          id="pc-price"
          label="Sale price (₹ per quintal)"
          type="number"
          min={0}
          value={f.price}
          onChange={(e) => setF({ ...f, price: e.target.value })}
        />
        <Input
          id="pc-cost"
          label="Cost of growing (₹ per quintal)"
          type="number"
          min={0}
          value={f.cost}
          onChange={(e) => setF({ ...f, cost: e.target.value })}
        />
        <Input
          id="pc-tr"
          label="Transport (₹ per quintal)"
          type="number"
          min={0}
          value={f.transport}
          onChange={(e) => setF({ ...f, transport: e.target.value })}
        />
        <Input
          id="pc-st"
          label="Storage (₹ per quintal)"
          type="number"
          min={0}
          value={f.storage}
          onChange={(e) => setF({ ...f, storage: e.target.value })}
        />
        <Input
          id="pc-hd"
          label="Handling (₹ per quintal)"
          type="number"
          min={0}
          value={f.handling}
          onChange={(e) => setF({ ...f, handling: e.target.value })}
        />
        <div className="flex flex-col justify-end text-sm text-muted-foreground">
          {t("FPO service charge")}: {pct}%
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-secondary p-4">
          <p className="text-sm text-muted-foreground">{t("Sale value")}</p>
          <p className="font-serif text-2xl">{rupees(gross)}</p>
        </div>
        <div className="rounded-2xl bg-secondary p-4">
          <p className="text-sm text-muted-foreground">{t("Farmer receives")}</p>
          <p className="font-serif text-2xl">{rupees(net)}</p>
        </div>
        <div
          className={cn(
            "rounded-2xl p-4",
            profit >= 0 ? "bg-[var(--fpo-good-soft)]" : "bg-destructive/10",
          )}
        >
          <p className="text-sm text-muted-foreground">{t("Profit after growing cost")}</p>
          <p className="font-serif text-2xl">{rupees(profit)}</p>
          {n("qty") > 0 && (
            <p className="text-xs text-muted-foreground">{rupees(profit / n("qty"))}/q</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function TrustCard() {
  const { t } = useI18n();
  const buyers = useFpoQuery(["buyers"], fpoApi.buyers);
  const [q, setQ] = useState("");
  const list = (buyers.data ?? []).filter((b) => b.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Card
      title="Buyer Trust Score"
      subtitle="Calculated only from deals recorded on AgriSense: verification 20%, paid in full 50%, disputes 30%. Buyers without delivered deals get no score."
      action={
        <input
          id="trust-q"
          aria-label={t("Search buyers")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("Search buyers")}
          className={`${inputCls} w-56`}
        />
      }
    >
      {buyers.isLoading ? (
        <Loading />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((b) => (
            <div key={b.id} className="rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{b.name}</p>
                <VerifiedBadge verified={b.verified} />
              </div>
              <div className="mt-2 flex items-start gap-2">
                <ShieldCheck className="mt-1 h-4 w-4 text-primary" />
                <TrustLine b={b} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {b.deals.fpo} {t("FPO deals")} · {b.deals.marketplace} {t("marketplace deals")}
              </p>
              {b.trust.dispute_count > 0 && (
                <Badge label={`${b.trust.dispute_count} disputes`} tone="red" />
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

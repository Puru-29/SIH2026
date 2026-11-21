import { createFileRoute, Link } from "@tanstack/react-router";
import type { Lot } from "@/lib/agri";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  ClipboardList,
  Gavel,
  IndianRupee,
  MapPin,
  Package,
  Pause,
  Play,
  Plus,
  Search,
} from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { ConfirmDistrict } from "@/components/agri/confirm-district";
import { Metric, Panel, Pill, StatusTag } from "@/components/agri/ui-bits";
import { useFarmLocation } from "@/lib/location-context";
import { placeLabel } from "@/lib/places";
import { inr, kg, type LotStatus } from "@/lib/agri";
import { normaliseCropName } from "@/lib/crop-catalog";
import { pickHeroLot, rankOpenLots, useMyLots } from "@/hooks/use-my-lots";
import { getSession } from "@/services/session";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useOffers } from "@/hooks/use-offers";
import { useLots, useMatchingBuyers } from "@/hooks/use-lots";
import { useTransactions } from "@/hooks/use-transactions";
import { useLotSignals } from "@/hooks/use-market";
import { useAllMarketPrices } from "@/hooks/use-market-prices";
import {
  evaluateSmartSale,
  getBuyerDemands,
  getLotSignals,
  getMatchingBuyers,
} from "@/services/api-client";
import { ErrorNote, Loading, shortDate } from "@/components/fpo/fpo-ui";
import {
  LotDealsModal,
  LotStatusPill,
  MessageLink,
  OfferActions,
  OrderStatusPill,
  PaymentStatusPill,
} from "@/components/agri/deal-ui";
import { inrAmount, inrKg, qtl } from "@/lib/deal-format";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Farmer Dashboard — AgriSense" },
      {
        name: "description",
        content: "Active lots, AI market decisions, mandi opportunities and buyer offers.",
      },
      { property: "og:title", content: "Farmer Dashboard — AgriSense" },
      { property: "og:description", content: "Your crop lots and today's best selling decision." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const session = getSession();
  if (session?.role === "admin") return <AdminRedirect />;
  return session?.role === "buyer" ? <BuyerDashboard /> : <FarmerDashboard />;
}

function AdminRedirect() {
  const navigate = Route.useNavigate();
  useEffect(() => {
    void navigate({ to: "/admin" });
  }, [navigate]);
  return null;
}

const STRATEGY: Record<string, LotStatus> = {
  SELL_NOW: "SELL NOW",
  WAIT: "HOLD",
  PARTIAL_SELL: "SPLIT",
};

function FarmerDashboard() {
  const session = getSession();
  const { location } = useFarmLocation();
  const { t } = useI18n();
  const firstName = (session?.name || "").split(" ")[0] || t("farmer");
  const { lots, openLots, isLoading, error } = useMyLots();
  const hero = pickHeroLot(lots);
  const buyers = useMatchingBuyers(hero?.backendId);
  const prices = useAllMarketPrices(location.state);
  const { data: transactions = [] } = useTransactions();
  const [dealsLot, setDealsLot] = useState<number | null>(null);

  const openKg = openLots.reduce((s, l) => s + l.quantity, 0);
  const openValue = openLots.reduce((s, l) => s + l.quantity * l.price, 0);
  const waitingOffers = openLots.reduce((s, l) => s + (l.pendingOffers ?? 0), 0);
  const runningOrders = transactions.filter(
    (tx) => tx.order_status !== "delivered" || tx.payment_status !== "paid",
  );
  const balanceDue = runningOrders.reduce((s, tx) => s + (tx.balance_due ?? 0), 0);

  // Today's best mandis for the crops I grow (or all crops if I have none listed).
  const myCrops = new Set(lots.map((l) => normaliseCropName(l.crop)));
  const markets = [...(prices.data ?? [])]
    .filter((p) => myCrops.size === 0 || myCrops.has(normaliseCropName(p.crop_name)))
    .sort((a, b) => b.modal_price - a.modal_price)
    .slice(0, 4);

  return (
    <PortalLayout>
      <div>
        <p className="eyebrow">{new Date().toDateString()}</p>
        <h1 className="mt-2 font-serif text-4xl">{t("Namaste, {name} 🙏", { name: firstName })}</h1>
        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4" /> {placeLabel(location)}
        </p>
      </div>

      <ConfirmDistrict />

      {/* AI decision hero */}
      <Panel className="bg-primary text-primary-foreground">
        {isLoading ? (
          <p className="text-primary-foreground/80">{t("Loading your lots…")}</p>
        ) : !hero ? (
          <div>
            <Pill className="bg-primary-foreground/15 text-primary-foreground">
              {t("AI market decision")}
            </Pill>
            <h2 className="mt-4 font-serif text-3xl">
              {lots.length === 0
                ? t("You have no lots yet — add your first lot")
                : t("You have no open lots right now")}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-primary-foreground/75">
              {t(
                "List a crop with its quantity and quality. AgriSense then compares live mandi prices, buyer requirements and freight to tell you whether to sell now or hold.",
              )}
            </p>
            <Link
              to="/crops"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary-foreground px-5 py-2.5 text-sm font-medium text-primary"
            >
              <Plus className="h-4 w-4" /> {t("Add a lot")}
            </Link>
          </div>
        ) : (
          <HeroCarousel lots={rankOpenLots(lots)} />
        )}
      </Panel>

      <ErrorNote error={error} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Active lots"
          value={openLots.length}
          hint={kg(openKg)}
          icon={<Boxes className="h-4 w-4" />}
        />
        <Metric
          label="Portfolio value"
          value={inr(openValue)}
          hint={t("At today's mandi prices")}
          icon={<IndianRupee className="h-4 w-4" />}
        />
        <Metric
          label="Offers waiting"
          value={waitingOffers}
          hint={t("Answer them on My Crops")}
          icon={<Gavel className="h-4 w-4" />}
        />
        <Metric
          label="Orders in progress"
          value={runningOrders.length}
          hint={
            balanceDue > 0
              ? `${inrAmount(balanceDue)} ${t("still to be paid")}`
              : t("Nothing pending")
          }
          icon={<Package className="h-4 w-4" />}
        />
      </div>

      {/* Crop lots */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl">{t("Your crop lots")}</h2>
          <Link to="/crops" className="text-sm underline underline-offset-4">
            {t("View all")}
          </Link>
        </div>
        {isLoading ? (
          <Loading />
        ) : lots.length === 0 ? (
          <Panel>
            <p className="text-sm text-muted-foreground">
              {t("You have no lots yet — add your first lot")}{" "}
              <Link to="/crops" className="text-primary underline underline-offset-4">
                {t("on My Crops")}
              </Link>
              .
            </p>
          </Panel>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {lots.slice(0, 6).map((lot) => (
              <Panel key={lot.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{lot.emoji}</span>
                    <div>
                      <p className="font-serif text-xl">{t(lot.crop)}</p>
                      <p className="text-xs text-muted-foreground">
                        {lot.id} · {lot.grade}
                      </p>
                    </div>
                  </div>
                  <LotStatusPill status={lot.displayStatus} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">{t("Quantity")}</p>
                    <p>{kg(lot.quantity)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t(lot.priceSource === "live" ? "Mandi price" : "Typical price")}
                    </p>
                    <p>{inr(lot.price)}/kg</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("Offers")}</p>
                    {lot.backendId ? (
                      <button
                        className="text-primary underline-offset-4 hover:underline"
                        onClick={() => setDealsLot(lot.backendId!)}
                      >
                        {lot.pendingOffers ?? 0} {t("waiting")}
                      </button>
                    ) : (
                      <p>—</p>
                    )}
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </section>

      {/* Market and buyer opportunities */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <h2 className="font-serif text-2xl">{t("Market opportunities")}</h2>
          {prices.isLoading ? (
            <Loading label="Loading live mandi prices…" />
          ) : prices.error ? (
            <Panel>
              <p className="text-sm text-muted-foreground">
                {t("Live mandi prices are unavailable right now.")}
              </p>
            </Panel>
          ) : markets.length === 0 ? (
            <Panel>
              <p className="text-sm text-muted-foreground">
                {t("No mandi in your state reported prices for your crops today.")} (
                {location.state})
              </p>
            </Panel>
          ) : (
            markets.map((m) => (
              <Panel key={m.id} className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="font-medium">{m.market}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(m.crop_name)} · {m.district ?? m.state} · {shortDate(m.date)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-serif text-xl">{inr(m.price_per_kg)}/kg</p>
                  <p className="text-xs text-muted-foreground">
                    {inr(m.min_price / 100)}–{inr(m.max_price / 100)}
                  </p>
                </div>
              </Panel>
            ))
          )}
        </div>
        <div className="space-y-4">
          <h2 className="font-serif text-2xl">{t("Buyer opportunities")}</h2>
          {!hero ? (
            <Panel>
              <p className="text-sm text-muted-foreground">
                {t("Add a lot to see buyers who want your crop.")}
              </p>
            </Panel>
          ) : buyers.isLoading ? (
            <Loading />
          ) : (buyers.data ?? []).length === 0 ? (
            <Panel>
              <p className="text-sm text-muted-foreground">
                {t("No open buyer requirement for")} {t(hero.crop)} {t("right now.")}
              </p>
            </Panel>
          ) : (
            (buyers.data ?? []).slice(0, 4).map((b) => (
              <Panel key={b.id} className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="flex items-center gap-1.5 font-medium">
                    {b.buyer_name ?? `Buyer #${b.buyer_id}`}
                    {b.verified && <BadgeCheck className="h-4 w-4 text-primary" />}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(hero.crop)} · {b.min_quantity} q · {b.delivery_location} · {t("by")}{" "}
                    {shortDate(b.required_by)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-serif text-xl">{inrKg(b.max_price)}</p>
                  {b.score !== undefined && (
                    <Pill tone="green">
                      {Math.round(b.score)}/100 {t("match")}
                    </Pill>
                  )}
                </div>
              </Panel>
            ))
          )}
        </div>
      </section>

      <LotDealsModal lotId={dealsLot} onClose={() => setDealsLot(null)} myRole="farmer" />
    </PortalLayout>
  );
}

const ROTATE_MS = 5000;
const BUYERS_PER_LOT = 3;

/**
 * The AI decision card. With several open lots it shows each lot's suggestion
 * in turn (most urgent first); with one lot it cycles through its top buyers.
 * Changes every 5 seconds, pauses while hovered or focused.
 */
function HeroCarousel({ lots }: { lots: Lot[] }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const single = lots.length === 1;
  const firstId = lots[0]?.backendId;
  const buyerCount = useMatchingBuyers(single ? firstId : undefined).data?.length ?? 0;
  const slides = single ? Math.min(BUYERS_PER_LOT, Math.max(1, buyerCount)) : lots.length;
  const index = tick % Math.max(1, slides);
  const lot = single ? lots[0]! : lots[index]!;
  const buyerIndex = single ? index : 0;

  // Load every lot's prices and buyers up front so each slide appears filled in.
  useEffect(() => {
    for (const l of lots.slice(0, 8)) {
      if (!l.backendId) continue;
      const id = l.backendId;
      void qc.prefetchQuery({
        queryKey: ["lot-signals", id],
        queryFn: () => getLotSignals(id),
        staleTime: 5 * 60_000,
      });
      void qc.prefetchQuery({
        queryKey: ["matching-buyers", id],
        queryFn: () => getMatchingBuyers(id),
        staleTime: 60_000,
      });
    }
  }, [lots, qc]);

  // Auto-advance. Keyed on `tick`, so picking a slide restarts the 5-second wait.
  useEffect(() => {
    if (paused || slides < 2) return;
    const timer = setTimeout(() => setTick((n) => n + 1), ROTATE_MS);
    return () => clearTimeout(timer);
  }, [paused, slides, tick]);

  return (
    <div className="overflow-hidden">
      <div
        key={`${lot.id}-${buyerIndex}`}
        className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-8 duration-500"
      >
        <HeroDecision lot={lot} buyerIndex={buyerIndex} />
      </div>
      {slides > 1 && (
        <div className="mt-4 flex items-center gap-2" role="tablist" aria-label={t("Suggestion")}>
          {Array.from({ length: slides }, (_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === index}
              aria-label={`${t("Suggestion")} ${i + 1}`}
              onClick={() => setTick(i)}
              className={cn(
                "relative h-2 overflow-hidden rounded-full transition-all",
                i === index ? "w-8 bg-primary-foreground/40" : "w-2 bg-primary-foreground/40",
              )}
            >
              {i === index && (
                // Fills up until the next slide; stops while paused.
                <span
                  key={tick}
                  className="hero-progress absolute inset-y-0 left-0 rounded-full bg-primary-foreground"
                  style={{
                    animationDuration: `${ROTATE_MS}ms`,
                    animationPlayState: paused ? "paused" : "running",
                  }}
                />
              )}
            </button>
          ))}
          <button
            onClick={() => setTick((n) => n + 1)}
            className="ml-2 text-xs text-primary-foreground/70 underline-offset-4 hover:underline"
          >
            {t("Next suggestion")}
          </button>
          <button
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            aria-label={paused ? t("Play suggestions") : t("Pause suggestions")}
            title={paused ? t("Play") : t("Pause")}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
    </div>
  );
}

function HeroDecision({ lot, buyerIndex }: { lot: Lot; buyerIndex: number }) {
  const { t } = useI18n();
  const signals = useLotSignals(lot.backendId);
  const buyers = useMatchingBuyers(lot.backendId);
  const inputs = signals.data?.smart_sale_inputs;
  const advice = useQuery({
    queryKey: ["smart-sale", lot.backendId, inputs],
    queryFn: () => evaluateSmartSale(inputs!),
    enabled: Boolean(inputs),
    staleTime: 5 * 60_000,
  });
  const list = buyers.data ?? [];
  const best = list[Math.min(buyerIndex, Math.max(0, list.length - 1))];
  const q = lot.quantityQuintals ?? 0;
  const decision: LotStatus | undefined = advice.data ? STRATEGY[advice.data.strategy] : lot.status;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Pill className="bg-primary-foreground/15 text-primary-foreground">
            {t("AI market decision")} · {lot.id}
          </Pill>
          <h2 className="mt-4 font-serif text-3xl">
            {t(decision === "HOLD" ? "Hold" : decision === "SPLIT" ? "Split" : "Sell now")} ·{" "}
            {kg(lot.quantity)} {t(lot.crop)}
            {best ? ` ${t("at")} ${inrKg(best.max_price)}` : ""}
          </h2>
          <p className="mt-2 max-w-xl text-sm text-primary-foreground/75">
            {advice.data?.reason ??
              (signals.isLoading
                ? t("Checking today's mandi prices and buyer demand…")
                : signals.error
                  ? t("Live prices are unavailable right now; the advice uses shelf life only.")
                  : t("Not enough price data yet for a full recommendation."))}
          </p>
          <p className="mt-2 max-w-xl text-sm text-primary-foreground/75">
            {best
              ? `${best.buyer_name ?? t("A buyer")} ${t("wants")} ${best.min_quantity} q ${t("delivered to")} ${best.delivery_location} ${t("by")} ${shortDate(best.required_by)}.`
              : buyers.isLoading
                ? ""
                : t("No buyer requirement matches this lot yet.")}
          </p>
        </div>
        {decision && <StatusTag status={decision} />}
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {(
          [
            [
              best ? "Best buyer price" : "Mandi price today",
              best
                ? inrKg(best.max_price)
                : signals.data?.current_price
                  ? inrKg(signals.data.current_price)
                  : "—",
            ],
            [
              "Freight",
              best?.freight_per_quintal != null
                ? `${inrKg(best.freight_per_quintal)} · ${best.delivery_location}`
                : t("Not known for this route"),
            ],
            [
              "Net realization",
              best?.net_price_per_quintal
                ? inrAmount(best.net_price_per_quintal * q)
                : signals.data?.current_price
                  ? inrAmount(signals.data.current_price * q)
                  : "—",
            ],
          ] as const
        ).map(([l, v]) => (
          <div key={l} className="rounded-2xl bg-primary-foreground/10 p-4">
            <p className="text-xs text-primary-foreground/70">{t(l)}</p>
            <p className="mt-1 font-serif text-2xl">{v}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-primary-foreground/60">
        {t("Trend-based estimate, not a guarantee")}
      </p>
      <Link
        to="/decision"
        search={{ lot: lot.id }}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary-foreground px-5 py-2.5 text-sm font-medium text-primary"
      >
        {t("View full breakdown")} <ArrowRight className="h-4 w-4" />
      </Link>
    </>
  );
}

function BuyerDashboard() {
  const { t } = useI18n();
  const session = getSession();
  const buyerName = session?.name || t("Buyer");
  const { data: offers = [] } = useOffers();
  const waitingForMe = offers.filter(
    (offer) => offer.status === "pending" && offer.created_by_role === "farmer",
  );
  const demands = useQuery({ queryKey: ["buyer-demands"], queryFn: getBuyerDemands });
  const openDemands = (demands.data ?? []).filter((d) => d.status === "open");
  const lots = useLots();
  const { data: transactions = [], isLoading: ordersLoading } = useTransactions();
  const wantedCrops = new Set(openDemands.map((d) => d.crop_id));
  const matched = (lots.data ?? []).filter((l) => wantedCrops.has(l.crop_id));
  const activeOrders = transactions.filter((tx) => tx.status !== "completed");

  return (
    <PortalLayout>
      <div>
        <p className="eyebrow">{new Date().toDateString()}</p>
        <h1 className="mt-2 font-serif text-4xl">{t("Source with confidence")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("Find verified produce, manage procurement, and track every order in one place.")}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("Buyer account")} · {buyerName}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Active requirements"
          value={openDemands.length}
          hint={t("Open sourcing needs")}
          icon={<ClipboardList className="h-4 w-4" />}
        />
        <Metric
          label="Matched lots"
          value={matched.length}
          hint={t("Open lots of the crops you need")}
          icon={<Search className="h-4 w-4" />}
        />
        <Metric
          label="Active orders"
          value={activeOrders.length}
          hint={t("Not yet delivered and paid")}
          icon={<Boxes className="h-4 w-4" />}
        />
        <Metric
          label="Completed orders"
          value={transactions.filter((tx) => tx.status === "completed").length}
          hint={t("Delivered and paid")}
          icon={<IndianRupee className="h-4 w-4" />}
        />
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl">{t("Active requirements")}</h2>
          <Link to="/requirements" className="text-sm underline underline-offset-4">
            {t("Manage requirements")}
          </Link>
        </div>
        <Panel className="p-0">
          {demands.isLoading ? (
            <div className="p-6">
              <Loading />
            </div>
          ) : openDemands.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {t("You have no open requirements — post one so farmers can find you.")}{" "}
              <Link to="/requirements" className="text-primary underline underline-offset-4">
                {t("Post a requirement")}
              </Link>
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    {[
                      "Crop",
                      "Quantity",
                      "Target price",
                      "Location",
                      "Required by",
                      "Matching lots",
                    ].map((heading) => (
                      <th key={heading} className="px-6 py-3 font-medium">
                        {t(heading)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {openDemands.map((requirement) => (
                    <tr key={requirement.id} className="border-b border-border/60 last:border-0">
                      <td className="px-6 py-4 font-medium">{t(requirement.crop_name)}</td>
                      <td className="px-6 py-4">{qtl(requirement.min_quantity_quintals)}</td>
                      <td className="px-6 py-4">{inrKg(requirement.price_per_quintal)}</td>
                      <td className="px-6 py-4">{requirement.delivery_location}</td>
                      <td className="px-6 py-4">{shortDate(requirement.required_by)}</td>
                      <td className="px-6 py-4">
                        <Pill tone={(requirement.matching_lots ?? 0) > 0 ? "green" : "muted"}>
                          {requirement.matching_lots ?? 0}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl">{t("Farmer offers")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Offers and counter offers waiting for you")}
          </p>
        </div>
        <Panel className="p-0">
          {waitingForMe.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {t("No farmer offers are waiting for your response.")}
            </p>
          ) : (
            <div className="divide-y divide-border">
              {waitingForMe.map((offer) => (
                <div
                  key={offer.id}
                  className="flex flex-wrap items-center justify-between gap-4 p-5"
                >
                  <div>
                    <p className="font-medium">
                      {t(offer.crop_name ?? "Lot")} · {qtl(offer.quantity_quintals ?? 0)} ·{" "}
                      {offer.farmer_name}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {offer.parent_offer_id ? t("Counter offer") : t("Offer")}:{" "}
                      {inrKg(offer.price_offered)} · {offer.expected_quality}
                    </p>
                  </div>
                  <OfferActions offer={offer} myRole="buyer" compact />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl">{t("Matched produce")}</h2>
          <Link to="/browse-produce" className="text-sm underline underline-offset-4">
            {t("Browse all produce")}
          </Link>
        </div>
        {lots.isLoading ? (
          <Loading />
        ) : matched.length === 0 ? (
          <Panel>
            <p className="text-sm text-muted-foreground">
              {openDemands.length === 0
                ? t("Post a requirement to see matching lots here.")
                : t(
                    "No open lots match your requirements yet. You will be notified when one is listed.",
                  )}
            </p>
          </Panel>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {matched.slice(0, 4).map((lot) => (
              <Panel key={lot.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-serif text-xl">{t(lot.crop_name ?? "Lot")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {lot.expected_quality} · {lot.farmer_location} · {lot.farmer_name}
                    </p>
                  </div>
                  <LotStatusPill status={lot.display_status} />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">{t("Available")}</p>
                    <p>{qtl(lot.quantity_quintals)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("Best offer")}</p>
                    <p>{lot.best_offer ? inrKg(lot.best_offer) : t("None yet")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("Your offer")}</p>
                    <p>
                      {lot.my_offer_price
                        ? `${inrKg(lot.my_offer_price)} · ${t(lot.my_offer_status ?? "")}`
                        : "—"}
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    to="/browse-produce"
                    className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground"
                  >
                    {t("Make an offer")}
                  </Link>
                  <MessageLink userId={lot.farmer_id} label="Message farmer" />
                </div>
              </Panel>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl">{t("Active orders")}</h2>
          <Link to="/orders" className="text-sm underline underline-offset-4">
            {t("View all orders")}
          </Link>
        </div>
        <Panel className="p-0">
          {ordersLoading ? (
            <div className="p-6">
              <Loading />
            </div>
          ) : activeOrders.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {t("No active orders. An order appears here after an offer is accepted.")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    {["Produce", "Quantity", "Agreed price", "Delivery", "Payment"].map(
                      (heading) => (
                        <th key={heading} className="px-6 py-3 font-medium">
                          {t(heading)}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {activeOrders.map((tx) => (
                    <tr key={tx.id} className="border-b border-border/60 last:border-0">
                      <td className="px-6 py-4 font-medium">
                        {t(tx.crop_name)} · {tx.farmer_name}
                      </td>
                      <td className="px-6 py-4">{qtl(tx.quantity_quintals)}</td>
                      <td className="px-6 py-4">{inrKg(tx.final_price)}</td>
                      <td className="px-6 py-4">
                        <OrderStatusPill status={tx.order_status} />
                      </td>
                      <td className="px-6 py-4">
                        <PaymentStatusPill status={tx.payment_status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>
    </PortalLayout>
  );
}

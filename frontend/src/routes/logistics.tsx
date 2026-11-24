import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Circle,
  ClipboardCheck,
  MapPin,
  Package,
  PackageCheck,
  Search,
  Truck,
  Wallet,
} from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, PageHeader, Panel } from "@/components/agri/ui-bits";
import { ContactCard } from "@/components/agri/trust-ui";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { cropEmoji } from "@/lib/crop-catalog";
import { getSession } from "@/services/session";
import type { BackendTransaction } from "@/services/api-client";
import { useOrderDetail, useTransactions } from "@/hooks/use-transactions";
import { ErrorNote, Loading, shortDate } from "@/components/fpo/fpo-ui";
import { MessageLink, OrderStatusPill } from "@/components/agri/deal-ui";
import { inrAmount, inrKg, ORDER_LABEL, qtl } from "@/lib/deal-format";
import { OrderTimeline, RouteSummary } from "@/components/agri/order-ui";

export const Route = createFileRoute("/logistics")({
  head: () => ({
    meta: [
      { title: "Logistics — AgriSense" },
      {
        name: "description",
        content: "Order tracking from pickup to delivery, with route and freight for each order.",
      },
      { property: "og:title", content: "Logistics — AgriSense" },
      { property: "og:description", content: "Follow each order from farm gate to buyer dock." },
    ],
  }),
  component: Logistics,
});

const STEPS = [
  { id: "accepted", label: "Accepted", icon: ClipboardCheck },
  { id: "picked_up", label: "Picked up", icon: Package },
  { id: "in_transit", label: "In transit", icon: Truck },
  { id: "delivered", label: "Delivered", icon: PackageCheck },
] as const;

const stepIndex = (s: string | null | undefined) =>
  Math.max(
    0,
    STEPS.findIndex((x) => x.id === s),
  );

type Filter = "active" | "delivered" | "all";
const PAGE = 12;

function Logistics() {
  const { t } = useI18n();
  const isBuyer = getSession()?.role === "buyer";
  const { data: orders = [], isLoading, error } = useTransactions();
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [picked, setPicked] = useState<number | undefined>();

  const delivered = orders.filter((o) => o.order_status === "delivered");
  const active = orders.filter((o) => o.order_status !== "delivered");
  const inTransit = orders.filter((o) => o.order_status === "in_transit").length;
  const due = orders.reduce((s, o) => s + (o.balance_due ?? 0), 0);

  const list = useMemo(() => {
    const base = filter === "active" ? active : filter === "delivered" ? delivered : orders;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((o) =>
      [`#${o.id}`, o.crop_name, o.buyer_name, o.farmer_name, o.delivery_location, o.pickup_location]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [filter, query, orders, active, delivered]);

  const selectedId = picked ?? list[0]?.id ?? orders[0]?.id;
  const detail = useOrderDetail(selectedId);
  const d = detail.data;

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Logistics"
        title="Order tracking"
        description={
          isBuyer
            ? "Follow each order from pickup to your dock, and confirm delivery when it arrives."
            : "Mark each order picked up and in transit; the buyer confirms delivery."
        }
      />

      <ErrorNote error={error} />
      {isLoading ? (
        <Loading />
      ) : orders.length === 0 ? (
        <Panel className="flex flex-col items-center gap-3 py-12 text-center">
          <Truck className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t("No orders to track yet. An order appears here once an offer is accepted.")}
          </p>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric
              label="Active orders"
              value={String(active.length)}
              icon={<Package className="h-4 w-4" />}
            />
            <Metric
              label="In transit"
              value={String(inTransit)}
              icon={<Truck className="h-4 w-4" />}
            />
            <Metric
              label="Delivered"
              value={String(delivered.length)}
              icon={<PackageCheck className="h-4 w-4" />}
            />
            <Metric
              label={isBuyer ? "Still to pay" : "Still to receive"}
              value={inrAmount(due)}
              icon={<Wallet className="h-4 w-4" />}
            />
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
            {/* Order list */}
            <Panel className="space-y-4 p-4 lg:sticky lg:top-20">
              <label className="flex items-center gap-2 rounded-xl border border-border bg-background px-3">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setLimit(PAGE);
                  }}
                  placeholder={t("Search order, crop, buyer or farmer")}
                  aria-label={t("Search orders")}
                  className="w-full bg-transparent py-2.5 text-sm outline-none"
                />
              </label>
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary p-1" role="tablist">
                {(
                  [
                    ["active", "Active", active.length],
                    ["delivered", "Delivered", delivered.length],
                    ["all", "All", orders.length],
                  ] as const
                ).map(([id, label, n]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={filter === id}
                    onClick={() => {
                      setFilter(id);
                      setLimit(PAGE);
                      setPicked(undefined);
                    }}
                    className={cn(
                      "rounded-lg px-2 py-2 text-xs font-medium transition-colors",
                      filter === id
                        ? "bg-card shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(label)} <span className="opacity-60">{n}</span>
                  </button>
                ))}
              </div>

              {list.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t("No orders match.")}
                </p>
              ) : (
                <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1 lg:max-h-[calc(100vh-18rem)]">
                  {list.slice(0, limit).map((o) => (
                    <li key={o.id}>
                      <OrderCard
                        o={o}
                        isBuyer={isBuyer}
                        selected={o.id === selectedId}
                        onClick={() => setPicked(o.id)}
                      />
                    </li>
                  ))}
                  {list.length > limit && (
                    <li>
                      <button
                        onClick={() => setLimit((l) => l + PAGE)}
                        className="w-full rounded-xl border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:text-foreground"
                      >
                        {t("Show more")} ({list.length - limit})
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </Panel>

            {/* Selected order */}
            <div className="min-w-0 space-y-6">
              {detail.isLoading && <Loading />}
              {d && (
                <>
                  <Panel className="space-y-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-3xl">
                          {cropEmoji(d.order.crop_name)}
                        </span>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            {t("Order")} #{d.order.id} · {shortDate(d.order.completed_at)}
                          </p>
                          <h2 className="font-serif text-3xl">{t(d.order.crop_name)}</h2>
                          <p className="text-sm text-muted-foreground">
                            {qtl(d.order.quantity_quintals)} · {d.order.expected_quality} ·{" "}
                            {inrAmount(d.order.total_amount)}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <OrderStatusPill status={d.current_step} />
                        <MessageLink
                          userId={d.counterpart.id}
                          label={isBuyer ? "Message farmer" : "Message buyer"}
                        />
                      </div>
                    </div>

                    <Stepper current={d.current_step} />

                    <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                      <Place label="Pickup" value={d.order.pickup_location} />
                      <div className="hidden items-center gap-2 text-muted-foreground sm:flex">
                        <span className="h-px w-10 bg-border" />
                        <Truck className="h-4 w-4" />
                        <span className="h-px w-10 bg-border" />
                      </div>
                      <Place label="Drop" value={d.order.delivery_location} />
                    </div>

                    <ContactCard contact={d.counterpart} />
                  </Panel>

                  <div className="grid gap-6 xl:grid-cols-2">
                    <Panel>
                      <h2 className="font-serif text-2xl">{t("Consignment details")}</h2>
                      <div className="mt-5">
                        <RouteSummary detail={d} />
                      </div>
                      <dl className="mt-5 space-y-3 text-sm">
                        {(
                          [
                            ["Farmer", d.order.farmer_name],
                            ["Buyer", d.order.buyer_name],
                            ["Agreed price", inrKg(d.order.final_price)],
                            ["Order value", inrAmount(d.order.total_amount)],
                          ] as const
                        ).map(([k, v]) => (
                          <div
                            key={k}
                            className="flex justify-between gap-4 border-b border-border pb-3 last:border-0"
                          >
                            <dt className="text-muted-foreground">{t(k)}</dt>
                            <dd className="text-right">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    </Panel>

                    <Panel>
                      <h2 className="font-serif text-2xl">{t("Tracking events")}</h2>
                      <div className="mt-5">
                        <OrderTimeline detail={d} />
                      </div>
                    </Panel>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </PortalLayout>
  );
}

function OrderCard({
  o,
  isBuyer,
  selected,
  onClick,
}: {
  o: BackendTransaction;
  isBuyer: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const step = stepIndex(o.order_status);
  return (
    <button
      onClick={onClick}
      aria-current={selected}
      className={cn(
        "w-full rounded-2xl border p-3 text-left transition-colors",
        selected ? "border-primary bg-accent" : "border-border bg-card hover:bg-secondary",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-xl">
          {cropEmoji(o.crop_name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-medium">
              {t(o.crop_name)} <span className="text-xs text-muted-foreground">#{o.id}</span>
            </p>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                o.order_status === "delivered"
                  ? "bg-emerald-100 text-emerald-900"
                  : o.order_status === "in_transit"
                    ? "bg-sky-100 text-sky-900"
                    : "bg-amber-100 text-amber-900",
              )}
            >
              {t(ORDER_LABEL[o.order_status] ?? o.order_status)}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {isBuyer ? o.farmer_name : o.buyer_name} · {qtl(o.quantity_quintals)} ·{" "}
            {inrAmount(o.total_amount)}
          </p>
          <div className="mt-2 flex items-center gap-1" aria-hidden>
            {STEPS.map((s, i) => (
              <span
                key={s.id}
                className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-secondary")}
              />
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{shortDate(o.completed_at)}</p>
        </div>
      </div>
    </button>
  );
}

function Stepper({ current }: { current: string }) {
  const { t } = useI18n();
  const at = stepIndex(current);
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label={t("Delivery progress")}>
      {STEPS.map((s, i) => {
        const done = i < at || (i === at && current === "delivered");
        const now = i === at && current !== "delivered";
        const Icon = s.icon;
        return (
          <li key={s.id} className="relative flex flex-col items-center text-center">
            {i > 0 && (
              <span
                className={cn(
                  "absolute right-1/2 top-5 h-0.5 w-full -translate-y-1/2",
                  i <= at ? "bg-primary" : "bg-border",
                )}
                aria-hidden
              />
            )}
            <span
              className={cn(
                "relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2",
                done
                  ? "border-primary bg-primary text-primary-foreground"
                  : now
                    ? "border-primary bg-card text-primary ring-4 ring-primary/15"
                    : "border-border bg-card text-muted-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span
              className={cn(
                "mt-2 flex items-center gap-1 text-xs",
                done || now ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {done ? (
                <CheckCircle2 className="hidden h-3 w-3 text-primary sm:inline" />
              ) : (
                <Circle className="hidden h-3 w-3 sm:inline" />
              )}
              {t(s.label)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Place({ label, value }: { label: string; value: string | null | undefined }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-secondary p-3">
      <MapPin className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t(label)}</p>
        <p className="truncate text-sm font-medium">{value || t("Not set")}</p>
      </div>
    </div>
  );
}

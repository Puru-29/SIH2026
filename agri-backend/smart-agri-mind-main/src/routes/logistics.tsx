import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MapPin, Package, Truck } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, PageHeader, Panel } from "@/components/agri/ui-bits";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { getSession } from "@/services/session";
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

const PROGRESS: Record<string, number> = {
  accepted: 0,
  picked_up: 33,
  in_transit: 66,
  delivered: 100,
};

function Logistics() {
  const { t } = useI18n();
  const isBuyer = getSession()?.role === "buyer";
  const { data: orders = [], isLoading, error } = useTransactions();
  const moving = orders.filter((o) => o.order_status !== "delivered");
  const [picked, setPicked] = useState<number | undefined>();
  const selectedId = picked ?? moving[0]?.id ?? orders[0]?.id;
  const detail = useOrderDetail(selectedId);
  const d = detail.data;
  const progress = PROGRESS[d?.current_step ?? "accepted"] ?? 0;

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
        <Panel>
          <p className="text-sm text-muted-foreground">
            {t("No orders to track yet. An order appears here once an offer is accepted.")}
          </p>
        </Panel>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {orders.map((o) => (
              <button
                key={o.id}
                onClick={() => setPicked(o.id)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm",
                  o.id === selectedId
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                #{o.id} · {t(o.crop_name)} · {t(ORDER_LABEL[o.order_status] ?? o.order_status)}
              </button>
            ))}
          </div>

          {detail.isLoading && <Loading />}
          {d && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="Route"
                  value={d.order.delivery_location || "—"}
                  hint={`${t("from")} ${d.order.pickup_location || "—"}`}
                  icon={<MapPin className="h-4 w-4" />}
                />
                <Metric
                  label="Freight"
                  value={
                    d.net_realisation.freight_known
                      ? inrKg(d.net_realisation.freight_per_quintal)
                      : "—"
                  }
                  hint={
                    d.net_realisation.freight_known
                      ? `${inrAmount(d.net_realisation.transport)} ${t("total")}`
                      : t("Not known for this route")
                  }
                  icon={<Truck className="h-4 w-4" />}
                />
                <Metric
                  label="Status"
                  value={t(ORDER_LABEL[d.current_step] ?? d.current_step)}
                  hint={`${t("Order")} #${d.order.id} · ${shortDate(d.order.completed_at)}`}
                />
                <Metric
                  label="Load"
                  value={qtl(d.order.quantity_quintals)}
                  hint={`${t(d.order.crop_name)} · ${d.order.expected_quality}`}
                  icon={<Package className="h-4 w-4" />}
                />
              </div>

              <Panel>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="font-serif text-2xl">{t("Route progress")}</h2>
                    <p className="text-sm text-muted-foreground">
                      {t("Based on the steps recorded by the farmer and buyer.")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <OrderStatusPill status={d.current_step} />
                    <MessageLink
                      userId={d.counterpart.id}
                      label={isBuyer ? "Message farmer" : "Message buyer"}
                    />
                  </div>
                </div>
                <div className="mt-8">
                  <div className="relative h-2 w-full rounded-full bg-secondary">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all"
                      style={{ width: `${progress}%` }}
                    />
                    <span
                      className="absolute -top-3 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground"
                      style={{ left: `${Math.max(progress, 3)}%` }}
                    >
                      <Truck className="h-4 w-4" />
                    </span>
                  </div>
                  <div className="mt-4 flex justify-between text-xs text-muted-foreground">
                    <span>{d.order.pickup_location || t("Pickup")}</span>
                    <span>{d.order.delivery_location || t("Drop")}</span>
                  </div>
                </div>
              </Panel>

              <div className="grid gap-5 lg:grid-cols-2">
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
        </>
      )}
    </PortalLayout>
  );
}

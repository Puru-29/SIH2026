import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { FileText } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, PageHeader, Panel } from "@/components/agri/ui-bits";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { getSession } from "@/services/session";
import { FpoPayoutsPanel } from "@/components/fpo/farmer-fpo";
import { useOrderDetail, useTransactions } from "@/hooks/use-transactions";
import { ErrorNote, Loading, shortDate } from "@/components/fpo/fpo-ui";
import { OrderStatusPill, PaymentStatusPill } from "@/components/agri/deal-ui";
import { inrAmount, inrKg, qtl } from "@/lib/deal-format";
import { NetRealisationCard, OrderPayments } from "@/components/agri/order-ui";

export const Route = createFileRoute("/payments")({
  validateSearch: (search: Record<string, unknown>): { order?: number } => {
    const order = Number(search["order"]);
    return Number.isFinite(order) && order > 0 ? { order } : {};
  },
  head: () => ({
    meta: [
      { title: "Settlements & Payments — AgriSense" },
      {
        name: "description",
        content: "Order value, payments made and received, and net realisation for every deal.",
      },
      { property: "og:title", content: "Settlements & Payments — AgriSense" },
      {
        property: "og:description",
        content: "Track payments, confirmations and invoices in one place.",
      },
    ],
  }),
  component: Payments,
});

function Payments() {
  const { t } = useI18n();
  const isBuyer = getSession()?.role === "buyer";
  const search = Route.useSearch();
  const { data: orders = [], isLoading, error } = useTransactions();
  const [picked, setPicked] = useState<number | undefined>(search.order);
  // Default to the first order that still needs attention.
  const attention = orders.find((o) => o.payment_status !== "paid") ?? orders[0];
  const selectedId = picked ?? attention?.id;
  const detail = useOrderDetail(selectedId);

  const invoiced = orders.reduce((s, o) => s + o.total_amount, 0);
  const received = orders.reduce((s, o) => s + o.paid_confirmed, 0);
  const awaiting = orders.reduce((s, o) => s + o.paid_awaiting, 0);
  const openCount = orders.filter((o) => o.payment_status !== "paid").length;

  return (
    <PortalLayout>
      <PageHeader
        eyebrow={isBuyer ? "Payments & invoices" : "Settlements"}
        title="Payments"
        description={
          isBuyer
            ? "Record each payment to the farmer; they confirm when it arrives. Download an invoice for every order."
            : "Payments buyers have made on your orders. Confirm each one when it reaches your account."
        }
      />

      {!isBuyer && <FpoPayoutsPanel />}

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric
          label={isBuyer ? "Total order value" : "Total invoiced"}
          value={inrAmount(invoiced)}
          hint={`${orders.length} ${t("orders")}`}
        />
        <Metric
          label={isBuyer ? "Paid and confirmed" : "Received"}
          value={inrAmount(received)}
          hint={
            awaiting > 0
              ? `${inrAmount(awaiting)} ${t("waiting for confirmation")}`
              : t("Confirmed by the farmer")
          }
        />
        <Metric
          label="Outstanding"
          value={inrAmount(Math.max(0, invoiced - received))}
          hint={`${openCount} ${t("orders not fully paid")}`}
        />
      </div>

      <ErrorNote error={error} />
      {isLoading ? (
        <Loading />
      ) : orders.length === 0 ? (
        <Panel>
          <p className="text-sm text-muted-foreground">
            {t("No orders yet. Payments appear here once an offer is accepted.")}
          </p>
        </Panel>
      ) : (
        <>
          {detail.data && (
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel>
                <h2 className="font-serif text-2xl">
                  {t("Order")} #{detail.data.order.id} · {t(detail.data.order.crop_name)}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {qtl(detail.data.order.quantity_quintals)} ·{" "}
                  {inrKg(detail.data.order.final_price)} ·{" "}
                  {isBuyer ? detail.data.order.farmer_name : detail.data.order.buyer_name}
                </p>
                <div className="mt-5">
                  <OrderPayments detail={detail.data} />
                </div>
              </Panel>
              <Panel>
                <h2 className="font-serif text-2xl">
                  {isBuyer ? t("What the farmer receives") : t("Net realisation")}
                </h2>
                <div className="mt-5">
                  <NetRealisationCard detail={detail.data} />
                </div>
              </Panel>
            </div>
          )}
          {detail.isLoading && <Loading />}

          <Panel className="p-0">
            <h2 className="border-b border-border p-6 font-serif text-2xl">{t("All orders")}</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    {[
                      "Order",
                      isBuyer ? "Farmer" : "Buyer",
                      "Value",
                      "Received",
                      "Payment",
                      "Delivery",
                      "Date",
                      "",
                    ].map((h) => (
                      <th key={h} className="px-6 py-3 font-medium">
                        {h ? t(h) : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr
                      key={o.id}
                      onClick={() => setPicked(o.id)}
                      className={cn(
                        "cursor-pointer border-b border-border/60 hover:bg-secondary/50",
                        o.id === selectedId && "bg-secondary/70",
                      )}
                    >
                      <td className="px-6 py-4 font-medium">
                        #{o.id} · {t(o.crop_name)}
                      </td>
                      <td className="px-6 py-4">{isBuyer ? o.farmer_name : o.buyer_name}</td>
                      <td className="px-6 py-4">{inrAmount(o.total_amount)}</td>
                      <td className="px-6 py-4">{inrAmount(o.paid_confirmed)}</td>
                      <td className="px-6 py-4">
                        <PaymentStatusPill status={o.payment_status} />
                      </td>
                      <td className="px-6 py-4">
                        <OrderStatusPill status={o.order_status} />
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {shortDate(o.completed_at)}
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          to="/invoice/$id"
                          params={{ id: String(o.id) }}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                        >
                          <FileText className="h-4 w-4" /> {t("Invoice")}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </PortalLayout>
  );
}

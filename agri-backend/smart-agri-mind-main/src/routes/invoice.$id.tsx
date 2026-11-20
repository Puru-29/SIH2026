import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Printer } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useRequireRole } from "@/hooks/use-require-role";
import { useOrderDetail } from "@/hooks/use-transactions";
import { ErrorNote, Loading, shortDate } from "@/components/fpo/fpo-ui";
import { inrAmount, inrQ, ORDER_LABEL, PAYMENT_LABEL } from "@/lib/deal-format";

export const Route = createFileRoute("/invoice/$id")({
  head: () => ({ meta: [{ title: "Invoice — AgriSense" }] }),
  component: InvoicePage,
});

const METHOD: Record<string, string> = {
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cash: "Cash",
  cheque: "Cheque",
};

function InvoicePage() {
  const { t } = useI18n();
  const session = useRequireRole(["farmer", "buyer"]);
  const { id } = Route.useParams();
  const detail = useOrderDetail(Number(id));
  if (!session) return null;
  const d = detail.data;
  const o = d?.order;
  const confirmed = d?.payments.filter((p) => p.status === "confirmed") ?? [];

  return (
    <div className="min-h-screen bg-background px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link
            to="/payments"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> {t("Back to payments")}
          </Link>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
          >
            <Printer className="h-4 w-4" /> {t("Print / Save as PDF")}
          </button>
        </div>

        {detail.isLoading ? (
          <Loading />
        ) : detail.error ? (
          <ErrorNote error={detail.error} />
        ) : o && d ? (
          <article className="rounded-3xl border border-border bg-card p-8 print:rounded-none print:border-0 print:p-0">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
              <div>
                <p className="font-serif text-3xl">AgriSense</p>
                <p className="text-sm text-muted-foreground">{t("Farmer-to-buyer sale")}</p>
              </div>
              <div className="text-right text-sm">
                <p className="font-serif text-2xl">{t("Invoice")}</p>
                <p>INV-{String(o.id).padStart(5, "0")}</p>
                <p className="text-muted-foreground">
                  {t("Order date")}: {shortDate(o.completed_at)}
                </p>
              </div>
            </header>

            <section className="grid gap-6 border-b border-border py-6 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("Seller (farmer)")}
                </p>
                <p className="mt-1 font-medium">{o.farmer_name}</p>
                <p className="text-muted-foreground">{o.pickup_location || "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("Buyer")}
                </p>
                <p className="mt-1 font-medium">{o.buyer_name}</p>
                <p className="text-muted-foreground">
                  {t("Deliver to")}: {o.delivery_location || "—"}
                </p>
              </div>
            </section>

            <table className="mt-6 w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 font-medium">{t("Item")}</th>
                  <th className="py-2 font-medium">{t("Quantity")}</th>
                  <th className="py-2 font-medium">{t("Rate")}</th>
                  <th className="py-2 text-right font-medium">{t("Amount")}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/60">
                  <td className="py-3">
                    {t(o.crop_name)} · {o.expected_quality}
                    <span className="block text-xs text-muted-foreground">
                      LOT-{o.lot_id} · {t("Order")} #{o.id}
                    </span>
                  </td>
                  <td className="py-3">{o.quantity_quintals} q</td>
                  <td className="py-3">{inrQ(o.final_price)}</td>
                  <td className="py-3 text-right">{inrAmount(o.total_amount)}</td>
                </tr>
              </tbody>
            </table>

            <dl className="ml-auto mt-4 max-w-xs space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t("Total")}</dt>
                <dd className="font-medium">{inrAmount(o.total_amount)}</dd>
              </div>
              {confirmed.map((p) => (
                <div key={p.id} className="flex justify-between text-muted-foreground">
                  <dt>
                    {t("Paid")} {shortDate(p.paid_at)} · {t(METHOD[p.method] ?? p.method)}
                    {p.reference ? ` (${p.reference})` : ""}
                  </dt>
                  <dd>− {inrAmount(p.amount)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-border pt-2">
                <dt className="font-medium">{t("Balance due")}</dt>
                <dd className="font-serif text-xl">{inrAmount(o.balance_due)}</dd>
              </div>
            </dl>

            <footer className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">
              <p>
                {t("Payment status")}: {t(PAYMENT_LABEL[o.payment_status] ?? o.payment_status)} ·{" "}
                {t("Delivery")}: {t(ORDER_LABEL[o.order_status] ?? o.order_status)}
              </p>
              <p className="mt-1">
                {t(
                  "Generated by AgriSense from the order record. Payments marked by the buyer appear only after the farmer confirms them.",
                )}
              </p>
            </footer>
          </article>
        ) : null}
      </div>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { inr, PAYMENTS, roadKm, transportPerKg, BUYERS } from "@/services";
import { useFarmLocation } from "@/lib/location-context";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/payments")({
  head: () => ({
    meta: [
      { title: "Settlements & Payments — AgriSense" },
      { name: "description", content: "Invoiced, received and outstanding amounts across your consignments." },
      { property: "og:title", content: "Settlements & Payments — AgriSense" },
      { property: "og:description", content: "Track advances, balances and payment references in one place." },
    ],
  }),
  component: Payments,
});

function Payments() {
  const { location } = useFarmLocation();
  const { t } = useI18n();
  const invoiced = PAYMENTS.reduce((s, p) => s + p.value, 0);
  const received = PAYMENTS.reduce((s, p) => s + p.paid, 0);
  const buyer = BUYERS[0]!;
  const km = roadKm(location, buyer);
  const freight = transportPerKg(km) * 5000;

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Settlements"
        title="Payments"
        description="Every invoice, advance and balance against your consignments."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Total invoiced" value={inr(invoiced)} hint={t("3 consignments")} />
        <Metric label="Received" value={inr(received)} hint={t("Credited to your account")} />
        <Metric label="Outstanding" value={inr(invoiced - received)} hint={t("2 payments pending")} />
      </div>

      <Panel>
        <h2 className="font-serif text-2xl">{t("Consignment breakdown · ORD-8841")}</h2>
        <p className="text-sm text-muted-foreground">
          5,000 kg {t("Tomato")} {t("to")} {buyer.name} · {km} km {t("from")} {location.name}
        </p>
        <dl className="mt-5 space-y-3 text-sm">
          {[
            ["Gross value (5,000 kg × ₹30)", inr(150000)],
            ["Freight", "− " + inr(freight)],
            ["Mandi commission", "− " + inr(3000)],
            ["Advance received (50%)", inr(75000)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-border pb-3">
              <dt className="text-muted-foreground">{t(k!)}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 pt-2">
            <dt className="font-medium">{t("Net payable to you")}</dt>
            <dd className="font-serif text-2xl">{inr(150000 - freight - 3000)}</dd>
          </div>
        </dl>
      </Panel>

      <Panel className="p-0">
        <h2 className="border-b border-border p-6 font-serif text-2xl">{t("Payment history")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                {["Payment", "Order", "Invoiced", "Received", "Status", "Reference", "Date"].map((h) => (
                  <th key={h} className="px-6 py-3 font-medium">
                    {t(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PAYMENTS.map((p) => (
                <tr key={p.id} className="border-b border-border/60">
                  <td className="px-6 py-4 font-medium">{p.id}</td>
                  <td className="px-6 py-4">{p.order}</td>
                  <td className="px-6 py-4">{inr(p.value)}</td>
                  <td className="px-6 py-4">{inr(p.paid)}</td>
                  <td className="px-6 py-4">
                    <Pill tone={p.status === "Paid" ? "green" : p.status === "Pending" ? "amber" : "slate"}>
                      {t(p.status)}
                    </Pill>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">{p.ref}</td>
                  <td className="px-6 py-4 text-muted-foreground">{p.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </PortalLayout>
  );
}

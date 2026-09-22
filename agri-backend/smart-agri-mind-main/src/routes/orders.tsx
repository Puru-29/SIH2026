import { createFileRoute } from "@tanstack/react-router";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { inr } from "@/services";
import { useI18n } from "@/lib/i18n";
import { useTransactions } from "@/hooks/use-transactions";

export const Route = createFileRoute("/orders")({
  head: () => ({
    meta: [
      { title: "Order Tracking — AgriSense" },
      { name: "description", content: "Track every consignment from accepted offer to released payment." },
      { property: "og:title", content: "Order Tracking — AgriSense" },
      { property: "og:description", content: "Follow pickup, transit, delivery and settlement in one timeline." },
    ],
  }),
  component: Orders,
});

function Orders() {
  const { t } = useI18n();

  const { data: liveTransactions = [] } = useTransactions();

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Orders"
        title="Order tracking"
        description="Live status for every accepted offer, with distance and delivery windows from your farm."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Orders" value={liveTransactions.length} hint="Accepted offers" />
        <Metric label="Accepted value" value={inr(liveTransactions.reduce((sum, tx) => sum + tx.final_price / 100 * tx.quantity_quintals * 100, 0))} hint="Based on agreed prices" />
        <Metric label="Completed" value={liveTransactions.filter((tx) => tx.status === "completed").length} hint="Accepted and settled" />
      </div>

      {liveTransactions.map((liveTx) => (
        <Panel key={liveTx.id} className="border-primary bg-accent/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Accepted offer</p>
              <h2 className="mt-1 font-serif text-2xl">
                {liveTx.crop_name} · {liveTx.quantity_quintals * 100} kg
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {inr(liveTx.final_price / 100)}/kg · Buyer: {liveTx.buyer_name} · Farmer: {liveTx.farmer_name}
              </p>
            </div>
            <Pill tone="green">Completed</Pill>
          </div>
        </Panel>
      ))}

      <Panel className="p-0">
        <h2 className="border-b border-border p-6 font-serif text-2xl">Accepted produce</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                {["Produce", "Quantity", "Agreed price", "Status", "Accepted"].map((h) => (
                  <th key={h} className="px-6 py-3 font-medium">
                    {t(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {liveTransactions.map((tx) => (
                <tr key={tx.id} className="border-b border-border/60">
                  <td className="px-6 py-4 font-medium">{tx.crop_name}</td>
                  <td className="px-6 py-4">{tx.quantity_quintals * 100} kg</td>
                  <td className="px-6 py-4">{inr(tx.final_price / 100)} / kg</td>
                  <td className="px-6 py-4">
                    <Pill tone="green">Completed</Pill>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">{tx.completed_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {liveTransactions.length === 0 && <p className="p-6 text-sm text-muted-foreground">No completed orders yet. An order appears here after an offer is accepted.</p>}
      </Panel>
    </PortalLayout>
  );
}

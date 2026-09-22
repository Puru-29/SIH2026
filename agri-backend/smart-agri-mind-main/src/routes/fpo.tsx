import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Boxes, Handshake, Layers, Users } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Bar, Metric, PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { aggregateLots, getFpoPools } from "@/services";
import { inr, kg } from "@/services";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/fpo")({
  head: () => ({
    meta: [
      { title: "FPO aggregation workspace — AgriSense" },
      {
        name: "description",
        content:
          "Pool member farmer lots into bulk consignments, unlock bulk tier prices, lower freight and track pooled payouts.",
      },
      { property: "og:title", content: "FPO aggregation workspace — AgriSense" },
      {
        property: "og:description",
        content: "Small lots, serious contracts — aggregate, bid and settle in one place.",
      },
    ],
  }),
  component: FpoPage,
});

function FpoPage() {
  const { t } = useI18n();
  const pools = getFpoPools();
  const [poolId, setPoolId] = useState(pools[0]!.id);
  const pool = pools.find((p) => p.id === poolId)!;
  const [selected, setSelected] = useState<string[]>(pool.members.map((m) => m.id));
  const [aggregated, setAggregated] = useState(false);

  const result = useMemo(() => aggregateLots(pool.id, selected), [pool.id, selected]);
  const pooledKg = result?.pooledKg ?? 0;
  const progress = Math.round((pooledKg / pool.targetKg) * 100);

  const switchPool = (id: string) => {
    const next = pools.find((p) => p.id === id)!;
    setPoolId(id);
    setSelected(next.members.map((m) => m.id));
    setAggregated(false);
  };

  const grades = pool.members.reduce<Record<string, number>>((acc, m) => {
    acc[m.grade] = (acc[m.grade] ?? 0) + m.quantity;
    return acc;
  }, {});

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="FPO aggregation"
        title="Small lots, serious contracts"
        description="Combine member produce into one consignment to reach bulk buyer tiers and cheaper consolidated freight."
        action={
          <div className="flex flex-wrap gap-2">
            {pools.map((p) => (
              <button
                key={p.id}
                onClick={() => switchPool(p.id)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm transition-colors",
                  p.id === poolId
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                {p.emoji} {t(p.crop)} {t("pool")}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Registered members"
          value={pool.members.length}
          hint={`${t(pool.crop)} · ${t(pool.contractStatus)}`}
          icon={<Users className="h-4 w-4" />}
        />
        <Metric
          label="Pooled quantity"
          value={kg(pooledKg)}
          hint={`${t("Target")} ${kg(pool.targetKg)}`}
          icon={<Boxes className="h-4 w-4" />}
        />
        <Metric
          label="Bulk tier price"
          value={`${inr(pool.bulkPrice)}/kg`}
          hint={`${t("Solo price")} ${inr(pool.basePrice)}/kg`}
          icon={<Layers className="h-4 w-4" />}
        />
        <Metric
          label="Consolidated freight"
          value={`${inr(pool.pooledFreight)}/kg`}
          hint={`${t("Individual trucks")} ${inr(pool.soloFreight)}/kg`}
          icon={<Handshake className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-serif text-2xl">{t("Member lot contributions")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("Select the lots to include in this consignment.")}
              </p>
            </div>
            <Pill tone={progress >= 80 ? "green" : "amber"}>{progress}% {t("of target")}</Pill>
          </div>

          <Bar value={progress} tone={progress >= 80 ? "primary" : "amber"} />

          <div className="space-y-2">
            {pool.members.map((m) => {
              const on = selected.includes(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    setAggregated(false);
                    setSelected((prev) =>
                      prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id],
                    );
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left transition-colors",
                    on ? "border-primary bg-accent/40" : "border-border bg-background",
                  )}
                >
                  <span>
                    <span className="block text-sm font-medium">{m.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {m.village} · {m.grade}
                    </span>
                  </span>
                  <span className="text-sm font-medium">{kg(m.quantity)}</span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {Object.entries(grades).map(([grade, qty]) => (
              <div key={grade} className="rounded-2xl border border-border bg-background p-4">
                <p className="eyebrow">{grade}</p>
                <p className="mt-1 font-serif text-xl">{kg(qty)}</p>
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              setAggregated(true);
              toast.success(`${t("Consignment aggregated")} · ${kg(pooledKg)} ${t(pool.crop)}`, {
                description:
                  result && result.gainPerKg > 0
                    ? `Bulk tier unlocked · +${inr(result.gainPerKg)}/kg`
                    : "Add more member lots to reach the bulk tier.",
              });
            }}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm text-primary-foreground"
          >
            <Layers className="h-4 w-4" /> {t("Aggregate lots")}
          </button>

          {aggregated && result ? (
            <div className="rounded-2xl bg-secondary p-5">
              <p className="eyebrow">{t("Aggregation result")}</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">{t("Selling individually")}</p>
                  <p className="font-serif text-2xl">{inr(result.soloNetPerKg)}/kg</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("As one pooled lot")}</p>
                  <p className="font-serif text-2xl">{inr(result.pooledNetPerKg)}/kg</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("Extra for the pool")}</p>
                  <p className="font-serif text-2xl">{inr(result.totalGain)}</p>
                </div>
              </div>
            </div>
          ) : null}
        </Panel>

        <div className="space-y-6">
          <Panel className="space-y-4">
            <h2 className="font-serif text-2xl">{t("Bulk buyer bids")}</h2>
            {pool.bids.map((b) => (
              <div key={b.id} className="rounded-2xl border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{b.buyer}</p>
                  <Pill tone={b.status === "Accepted" ? "green" : b.status === "Negotiating" ? "amber" : "muted"}>
                    {t(b.status)}
                  </Pill>
                </div>
                <p className="mt-2 font-serif text-2xl">{inr(b.pricePerKg)}/kg</p>
                <p className="text-xs text-muted-foreground">
                  {t("Minimum")} {kg(b.minQuantity)} · {b.terms}
                </p>
                <button
                  onClick={() =>
                    toast.success(`${t("Bid response sent to")} ${b.buyer}`, {
                      description: `${inr(b.pricePerKg)}/kg for ${kg(pooledKg)}`,
                    })
                  }
                  className="mt-3 w-full rounded-full border border-border px-4 py-2 text-xs"
                >
                  {t("Respond to bid")}
                </button>
              </div>
            ))}
          </Panel>

          <Panel className="space-y-3">
            <h2 className="font-serif text-2xl">{t("Payout distribution")}</h2>
            {pool.payouts.map((p) => (
              <div
                key={p.member}
                className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
              >
                <div>
                  <p className="text-sm">{p.member}</p>
                  <p className="text-xs text-muted-foreground">{kg(p.quantity)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{inr(p.amount)}</p>
                  <Pill tone={p.status === "Paid" ? "green" : "amber"}>{t(p.status)}</Pill>
                </div>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </PortalLayout>
  );
}

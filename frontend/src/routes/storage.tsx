import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BadgeCheck, Calculator, Info, Snowflake, Warehouse } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { estimateFreight } from "@/services";
import { inr } from "@/lib/agri";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useStorageOptions } from "@/hooks/use-market";
import { ErrorNote, Loading } from "@/components/fpo/fpo-ui";
import { MessageLink } from "@/components/agri/deal-ui";

export const Route = createFileRoute("/storage")({
  head: () => ({
    meta: [
      { title: "Cold Chain & Storage | AgriSense" },
      {
        name: "description",
        content:
          "Storage rates at mandis and warehouses run by verified FPOs, with a freight and storage cost calculator.",
      },
      { property: "og:title", content: "Storage & Transport | AgriSense" },
      {
        property: "og:description",
        content: "Real storage rates and verified FPO warehouses, plus a cost calculator.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: StoragePage,
});

/** Typical tempo rate used only when the farmer has no quote yet. */
const TYPICAL_RATE_PER_KM = 42;

type Option = { key: string; label: string; perQuintalPerDay: number };

function StoragePage() {
  const { t } = useI18n();
  const storage = useStorageOptions();
  const rates = storage.data?.rates ?? [];
  const warehouses = storage.data?.warehouses ?? [];
  const options: Option[] = [
    { key: "none", label: t("No storage"), perQuintalPerDay: 0 },
    ...warehouses.map((w) => ({
      key: `w${w.id}`,
      label: `${w.name} (${w.fpo_name})`,
      perQuintalPerDay: w.rate_per_quintal_month / 30,
    })),
    ...rates.map((r) => ({
      key: `m${r.market_id}`,
      label: `${r.market}, ${r.location}`,
      perQuintalPerDay: r.cost_per_quintal_per_day,
    })),
  ];
  const [choice, setChoice] = useState("none");
  const [quintals, setQuintals] = useState(50);
  const [km, setKm] = useState(120);
  const [ratePerKm, setRatePerKm] = useState(TYPICAL_RATE_PER_KM);
  const [days, setDays] = useState(15);
  const picked = options.find((o) => o.key === choice) ?? options[0]!;
  const result = estimateFreight({
    km,
    quintals,
    ratePerKm,
    storageDays: picked.perQuintalPerDay > 0 ? days : 0,
    storagePerQuintalPerDay: picked.perQuintalPerDay,
  });
  const capacity = warehouses.reduce((s, w) => s + w.capacity_quintals, 0);
  const lowest = Math.min(
    ...warehouses.map((w) => w.rate_per_quintal_month),
    ...rates.map((r) => r.cost_per_quintal_per_month),
  );

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Cold chain & storage"
        title="Storage and transport"
        description="Warehouses run by verified FPOs, storage rates at mandis, and a calculator for freight and storage costs."
      />

      <ErrorNote error={storage.error} />
      {storage.isLoading ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="FPO warehouses"
              value={warehouses.length}
              hint={t("Run by verified FPOs")}
              icon={<Warehouse className="h-4 w-4" />}
            />
            <Metric
              label="Warehouse capacity"
              value={`${capacity.toLocaleString("en-IN")} q`}
              hint={t("Total across listed warehouses")}
              icon={<BadgeCheck className="h-4 w-4" />}
            />
            <Metric
              label="Mandi storage rates"
              value={rates.length}
              hint={t("From AgriSense master data")}
              icon={<Snowflake className="h-4 w-4" />}
            />
            <Metric
              label="Lowest storage rate"
              value={Number.isFinite(lowest) ? `${inr(lowest)}/q` : "—"}
              hint={t("per quintal per month")}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
            <div className="space-y-5">
              <h2 className="font-serif text-2xl">{t("Warehouses run by verified FPOs")}</h2>
              {warehouses.length === 0 ? (
                <Panel>
                  <p className="text-sm text-muted-foreground">
                    {t("No verified FPO has listed a warehouse yet.")}
                  </p>
                </Panel>
              ) : (
                warehouses.map((w) => (
                  <Panel key={w.id} className={cn(choice === `w${w.id}` && "border-primary")}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="font-serif text-2xl">{w.name}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {w.location} · {[w.district, w.state].filter(Boolean).join(", ")}
                        </p>
                        <p className="mt-2 text-sm">
                          <span className="text-muted-foreground">{t("Run by")}: </span>
                          {w.fpo_name}
                        </p>
                      </div>
                      <Pill tone="green">
                        <BadgeCheck className="h-3.5 w-3.5" /> {t("Verified FPO")}
                      </Pill>
                    </div>
                    <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl bg-secondary p-4 text-sm">
                      <p>
                        <span className="text-muted-foreground">{t("Capacity")}: </span>
                        {w.capacity_quintals.toLocaleString("en-IN")} q
                      </p>
                      <p>
                        <span className="text-muted-foreground">{t("Rate")}: </span>
                        {inr(w.rate_per_quintal_month)} / q / {t("month")}
                      </p>
                    </div>
                    <div className="mt-5 flex flex-wrap gap-3">
                      <button
                        onClick={() => setChoice(`w${w.id}`)}
                        className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
                      >
                        {t("Use in calculator")}
                      </button>
                      <MessageLink userId={w.fpo_user_id} label="Ask the FPO" />
                    </div>
                  </Panel>
                ))
              )}

              <Panel className="p-0">
                <h2 className="border-b border-border p-6 font-serif text-2xl">
                  {t("Storage rates at mandis")}
                </h2>
                {rates.length === 0 ? (
                  <p className="p-6 text-sm text-muted-foreground">{t("No rates recorded yet.")}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          {[
                            "Market",
                            "Location",
                            "Per quintal per day",
                            "Per quintal per month",
                          ].map((h) => (
                            <th key={h} className="px-6 py-3 font-medium">
                              {t(h)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rates.map((r) => (
                          <tr key={r.market_id} className="border-b border-border/60 last:border-0">
                            <td className="px-6 py-3 font-medium">{r.market}</td>
                            <td className="px-6 py-3">{r.location}</td>
                            <td className="px-6 py-3">{inr(r.cost_per_quintal_per_day)}</td>
                            <td className="px-6 py-3">{inr(r.cost_per_quintal_per_month)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>

            <Panel className="h-fit lg:sticky lg:top-24">
              <h2 className="flex items-center gap-2 font-serif text-2xl">
                <Calculator className="h-5 w-5" /> {t("Freight & storage calculator")}
              </h2>
              <div className="mt-5 space-y-4 text-sm">
                <label className="block">
                  <span className="text-muted-foreground">{t("Storage")}</span>
                  <select
                    value={choice}
                    onChange={(e) => setChoice(e.target.value)}
                    className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-2.5 outline-none focus:border-primary"
                  >
                    {options.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                        {o.perQuintalPerDay > 0
                          ? ` — ${inr(o.perQuintalPerDay)}/q/${t("day")}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label={t("Volume (Quintals)")}
                    value={quintals}
                    min={1}
                    onChange={setQuintals}
                  />
                  <NumberField label={t("Distance (km)")} value={km} min={1} onChange={setKm} />
                  <NumberField
                    label={t("Transport rate (₹/km)")}
                    value={ratePerKm}
                    min={1}
                    onChange={setRatePerKm}
                  />
                  {picked.perQuintalPerDay > 0 && (
                    <NumberField
                      label={t("Storage days")}
                      value={days}
                      min={0}
                      onChange={setDays}
                    />
                  )}
                </div>
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {t(
                    "The transport rate starts at a typical tempo rate of ₹42/km. Replace it with your transporter's quote.",
                  )}
                </p>
              </div>

              <div className="mt-5 space-y-2 rounded-2xl bg-secondary p-4 text-sm">
                <p className="eyebrow">{t("Estimate")}</p>
                <Row label={t("Trips required")} value={String(result.trips)} />
                <Row label={t("Freight")} value={inr(result.freight)} />
                {result.storage > 0 && <Row label={t("Storage")} value={inr(result.storage)} />}
                <div className="flex justify-between border-t border-border pt-2 font-medium">
                  <span>{t("Total")}</span>
                  <span>{inr(result.total)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {inr(result.perKg)} / kg · {t("one trip carries up to 180 q")}
                </p>
              </div>
            </Panel>
          </div>
        </>
      )}
    </PortalLayout>
  );
}

function NumberField({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
        className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-2.5 outline-none focus:border-primary"
      />
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

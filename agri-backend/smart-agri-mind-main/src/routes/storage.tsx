import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BadgeCheck, Phone, Snowflake, Star, Thermometer, Truck, Warehouse } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { COLD_CHAIN_FACILITIES, estimateFreight, inr } from "@/services";
import { useFarmLocation } from "@/lib/location-context";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

export const Route = createFileRoute("/storage")({
  head: () => ({
    meta: [
      { title: "Cold Chain & Storage Network | AgriSense" },
      {
        name: "description",
        content:
          "Book verified reefer trucks, dry storage silos and WDRA accredited warehouses across Maharashtra, with an instant freight and storage calculator.",
      },
      { property: "og:title", content: "Certified Cold Chain & Transport Network" },
      {
        property: "og:description",
        content: "Verified reefer transport, silos and WDRA warehouses with instant fare estimates.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StoragePage,
});

function StoragePage() {
  const { t } = useI18n();
  const { location } = useFarmLocation();
  const [selected, setSelected] = useState(COLD_CHAIN_FACILITIES[0]!.id);
  const [pickup, setPickup] = useState(`${location.name} farm gate, ${location.district}`);
  const [destination, setDestination] = useState("Vashi APMC packhouse, Navi Mumbai");
  const [quintals, setQuintals] = useState(120);
  const [km, setKm] = useState(168);
  const [days, setDays] = useState(0);
  const [result, setResult] = useState<ReturnType<typeof estimateFreight> | null>(null);

  const facility = useMemo(
    () => COLD_CHAIN_FACILITIES.find((f) => f.id === selected)!,
    [selected],
  );

  const calculate = () => {
    setResult(
      estimateFreight({
        km,
        quintals,
        ratePerKm: facility.ratePerKm ?? 42,
        storageDays: days,
        storagePerQuintalPerDay: facility.storagePerQuintalPerDay ?? 0,
      }),
    );
  };

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Cold chain & storage"
        title="Certified Cold Chain & Transport Network"
        description="Book verified reefer trucks, dry storage silos and WDRA accredited warehouses across Maharashtra."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Verified facilities"
          value={COLD_CHAIN_FACILITIES.length}
          hint={t("Within Nashik belt")}
          icon={<Warehouse className="h-4 w-4" />}
        />
        <Metric
          label="WDRA accredited"
          value={COLD_CHAIN_FACILITIES.filter((f) => f.wdra).length}
          hint={t("Warehouse receipts accepted")}
          icon={<BadgeCheck className="h-4 w-4" />}
        />
        <Metric
          label="Reefer partners"
          value={COLD_CHAIN_FACILITIES.filter((f) => f.kind === "Reefer transport").length}
          hint={t("GPS & temperature logged")}
          icon={<Truck className="h-4 w-4" />}
        />
        <Metric
          label="Lowest freight rate"
          value={`${inr(Math.min(...COLD_CHAIN_FACILITIES.map((f) => f.ratePerKm ?? 99)))}/km`}
          hint={t("Shared load pricing")}
          icon={<Snowflake className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          {COLD_CHAIN_FACILITIES.map((f) => (
            <Panel key={f.id} className={f.id === selected ? "border-primary" : ""}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-serif text-2xl">{f.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {f.place}, {f.district}
                  </p>
                  <p className="mt-2 text-sm">
                    <span className="text-muted-foreground">{t("Category")}: </span>
                    {t(f.kind)}
                    <span className="text-muted-foreground"> · {t("Contact")}: </span>
                    {f.contact} ({f.phone})
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Pill tone="green">
                    <Star className="h-3.5 w-3.5" /> {f.rating.toFixed(2)} {t("Verified")}
                  </Pill>
                  {f.wdra ? <Pill tone="slate">WDRA</Pill> : null}
                </div>
              </div>

              <div className="mt-5 space-y-2 rounded-2xl bg-secondary p-4 text-sm">
                <p className="flex items-center gap-2">
                  <Thermometer className="h-4 w-4 text-primary" />
                  <span className="text-muted-foreground">{t("Temperature")}:</span> {f.tempRange}
                </p>
                <p className="flex items-center gap-2">
                  <Warehouse className="h-4 w-4 text-primary" />
                  <span className="text-muted-foreground">{t("Capacity")}:</span> {f.capacity}
                </p>
                <p className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-primary" />
                  <span className="text-muted-foreground">{t("Freight rate")}:</span>{" "}
                  {inr(f.ratePerKm ?? 0)} / km
                  {f.storagePerQuintalPerDay
                    ? ` · ${inr(f.storagePerQuintalPerDay)} / quintal / day`
                    : ""}
                </p>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    setSelected(f.id);
                    setResult(null);
                    toast.success(`${f.name} ${t("selected for booking")}`);
                  }}
                  className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
                >
                  {t("Select for booking")}
                </button>
                <a
                  href={`tel:${f.phone.replace(/\s/g, "")}`}
                  className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm"
                >
                  <Phone className="h-4 w-4" /> {t("Call facility")}
                </a>
              </div>
            </Panel>
          ))}
        </div>

        <Panel className="h-fit lg:sticky lg:top-24">
          <h2 className="font-serif text-2xl">{t("Instant Fare & Storage Calculator")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {facility.name} · {inr(facility.ratePerKm ?? 0)}/km
          </p>

          <div className="mt-5 space-y-4 text-sm">
            <label className="block">
              <span className="text-muted-foreground">{t("Pickup Location (Village/Mandi)")}</span>
              <input
                value={pickup}
                onChange={(e) => setPickup(e.target.value)}
                className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-2.5 outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="text-muted-foreground">{t("Destination Facility")}</span>
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-2.5 outline-none focus:border-primary"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-muted-foreground">{t("Distance (km)")}</span>
                <input
                  type="number"
                  min={1}
                  value={km}
                  onChange={(e) => setKm(Math.max(1, Number(e.target.value) || 0))}
                  className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-2.5 outline-none focus:border-primary"
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground">{t("Volume (Quintals)")}</span>
                <input
                  type="number"
                  min={1}
                  value={quintals}
                  onChange={(e) => setQuintals(Math.max(1, Number(e.target.value) || 0))}
                  className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-2.5 outline-none focus:border-primary"
                />
              </label>
            </div>
            {facility.storagePerQuintalPerDay ? (
              <label className="block">
                <span className="text-muted-foreground">{t("Storage days")}</span>
                <input
                  type="number"
                  min={0}
                  value={days}
                  onChange={(e) => setDays(Math.max(0, Number(e.target.value) || 0))}
                  className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-2.5 outline-none focus:border-primary"
                />
              </label>
            ) : null}

            <button
              onClick={calculate}
              className="w-full rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground"
            >
              {t("Calculate Estimated Freight")} →
            </button>
          </div>

          {result ? (
            <div className="mt-5 space-y-2 rounded-2xl bg-secondary p-4 text-sm">
              <p className="eyebrow">{t("Estimate")}</p>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("Trips required")}</span>
                <span>{result.trips}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("Freight")}</span>
                <span>{inr(result.freight)}</span>
              </div>
              {result.storage > 0 ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("Storage")}</span>
                  <span>{inr(result.storage)}</span>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-border pt-2 font-medium">
                <span>{t("Total")}</span>
                <span>{inr(result.total)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {inr(result.perKg)} / kg · {pickup} → {destination}
              </p>
            </div>
          ) : null}
        </Panel>
      </div>
    </PortalLayout>
  );
}

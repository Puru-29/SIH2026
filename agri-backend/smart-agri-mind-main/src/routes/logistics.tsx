import { createFileRoute } from "@tanstack/react-router";
import { Clock, MapPin, Phone, Truck } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { BUYERS, inr, kg, roadKm, TRACKING_EVENTS, transportPerKg } from "@/services";
import { useFarmLocation } from "@/lib/location-context";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/logistics")({
  head: () => ({
    meta: [
      { title: "Logistics — AgriSense" },
      { name: "description", content: "Live consignment tracking, route progress and freight cost per kg." },
      { property: "og:title", content: "Logistics — AgriSense" },
      { property: "og:description", content: "Follow your tempo from farm gate to buyer dock." },
    ],
  }),
  component: Logistics,
});

const PROGRESS = 62;

function Logistics() {
  const { location } = useFarmLocation();
  const { t } = useI18n();
  const buyer = BUYERS[0]!;
  const km = roadKm(location, buyer);
  const freight = transportPerKg(km);
  const done = Math.round((km * PROGRESS) / 100);

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Logistics"
        title={t("Consignment CN-3391")}
        description={`Tata 407 tempo · 6 tonne capacity · ${location.name} to ${buyer.city}`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Distance" value={`${km} km`} hint={`${location.name} → ${buyer.city}`} icon={<MapPin className="h-4 w-4" />} />
        <Metric label="Freight" value={`${inr(freight)}/kg`} hint={inr(freight * 5000) + " " + t("total")} icon={<Truck className="h-4 w-4" />} />
        <Metric label="ETA" value="13:00" hint={t("On schedule")} icon={<Clock className="h-4 w-4" />} />
        <Metric label="Load" value={kg(5000)} hint={`${t("Grade A")} ${t("Tomato")}`} />
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-serif text-2xl">{t("Live route progress")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("{done} km covered of {km} km", { done, km })}
            </p>
          </div>
          <Pill tone="green">{t("Moving")} · 46 km/h</Pill>
        </div>

        <div className="mt-8">
          <div className="relative h-2 w-full rounded-full bg-secondary">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary"
              style={{ width: `${PROGRESS}%` }}
            />
            <span
              className="absolute -top-3 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground"
              style={{ left: `${PROGRESS}%` }}
            >
              <Truck className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-4 flex justify-between text-xs text-muted-foreground">
            <span>{location.name} ({t("farm gate")})</span>
            <span>{buyer.city}</span>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <h2 className="font-serif text-2xl">{t("Consignment details")}</h2>
          <dl className="mt-5 space-y-3 text-sm">
            {[
              ["Vehicle", "Tata 407 · MH 15 GJ 4482"],
              ["Driver", "Sanjay Kale"],
              ["Crates", "250 crates · 20 kg each"],
              ["Pickup", "13 Sep · 08:00 from farm gate"],
              ["Drop", "Buyer dock, " + buyer.city],
              ["Freight basis", `${inr(freight)}/kg over ${km} km`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-border pb-3 last:border-0">
                <dt className="text-muted-foreground">{t(k!)}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>
          <button className="mt-5 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm">
            <Phone className="h-4 w-4" /> {t("Call driver")}
          </button>
        </Panel>

        <Panel>
          <h2 className="font-serif text-2xl">{t("Tracking events")}</h2>
          <ol className="mt-5 space-y-4">
            {TRACKING_EVENTS.map((e, i) => (
              <li key={e.time} className="flex gap-4">
                <span className="w-14 shrink-0 text-sm text-muted-foreground">{e.time}</span>
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <p className={i === TRACKING_EVENTS.length - 1 ? "text-sm text-muted-foreground" : "text-sm"}>
                  {t(e.text)}
                </p>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </PortalLayout>
  );
}

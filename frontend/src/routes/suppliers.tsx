import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BadgeCheck, MapPin, Search, Users } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { useI18n } from "@/lib/i18n";
import { useSuppliers } from "@/hooks/use-market";
import { ErrorNote, Loading } from "@/components/fpo/fpo-ui";
import { MessageLink } from "@/components/agri/deal-ui";
import { qtl } from "@/lib/deal-format";

export const Route = createFileRoute("/suppliers")({
  head: () => ({ meta: [{ title: "Suppliers — AgriSense" }] }),
  component: Suppliers,
});

/** Waits until typing pauses before searching. */
function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function Suppliers() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [crop, setCrop] = useState("");
  const [location, setLocation] = useState("");
  const query = useDebounced(q);
  // Unfiltered list feeds the crop and location menus.
  const all = useSuppliers({});
  const list = useSuppliers({ q: query, crop, location });
  const crops = [...new Set((all.data ?? []).flatMap((s) => s.crops))].sort();
  const places = [
    ...new Set(
      (all.data ?? []).map((s) => s.location.split(",").pop()?.trim() ?? "").filter(Boolean),
    ),
  ].sort();
  const suppliers = list.data ?? [];

  return (
    <PortalLayout roles={["buyer"]}>
      <PageHeader
        eyebrow="Buyer procurement"
        title="Suppliers"
        description="Farmers and verified FPOs with produce listed on AgriSense right now."
      />
      <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
        <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 focus-within:border-primary">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Search suppliers or crops...")}
            aria-label={t("Search suppliers")}
            className="w-full bg-transparent py-3 text-sm outline-none"
          />
        </label>
        <select
          value={crop}
          onChange={(e) => setCrop(e.target.value)}
          aria-label={t("Crop")}
          className="rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none"
        >
          <option value="">{t("All crops")}</option>
          {crops.map((c) => (
            <option key={c} value={c}>
              {t(c)}
            </option>
          ))}
        </select>
        <select
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          aria-label={t("Location")}
          className="rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none"
        >
          <option value="">{t("All locations")}</option>
          {places.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <ErrorNote error={list.error} />
      {list.isLoading ? (
        <Loading />
      ) : suppliers.length === 0 ? (
        <Panel>
          <p className="text-sm text-muted-foreground">
            {all.data?.length
              ? t("No supplier matches these filters.")
              : t("No farmer or FPO has produce listed right now.")}
          </p>
        </Panel>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((s) => (
            <Panel key={s.key}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-serif text-xl">{s.name}</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" /> {s.location || t("Location not set")} ·{" "}
                    {s.kind === "fpo" ? "FPO" : t("Farmer")}
                  </p>
                </div>
                {s.verified ? (
                  <Pill tone="green">
                    <BadgeCheck className="h-3.5 w-3.5" />{" "}
                    {s.kind === "fpo" ? t("Verified FPO") : t("FPO member")}
                  </Pill>
                ) : (
                  <Pill>{t("Individual farmer")}</Pill>
                )}
              </div>
              <p className="mt-5 text-sm">{s.crops.map((c) => t(c)).join(", ")}</p>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-[11px] text-muted-foreground">{t("Open lots")}</dt>
                  <dd>{s.open_lots}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">{t("Available")}</dt>
                  <dd>{qtl(s.open_quantity).split(" (")[0]}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">{t("Completed deals")}</dt>
                  <dd>{s.completed_deals}</dd>
                </div>
              </dl>
              {s.kind === "farmer" && s.fpo_name && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("Member of")} {s.fpo_name}
                </p>
              )}
              {s.kind === "fpo" && s.members != null && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" /> {s.members} {t("member farmers")}
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  to="/suppliers/$kind/$id"
                  params={{ kind: s.kind, id: String(s.id) }}
                  className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground"
                >
                  {t("View profile")}
                </Link>
                <MessageLink userId={s.user_id} />
              </div>
            </Panel>
          ))}
        </div>
      )}
    </PortalLayout>
  );
}

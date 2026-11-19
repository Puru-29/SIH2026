import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CalendarDays, Loader2, MapPin, Plus, Search, Truck } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { PageHeader, Panel, Pill, StatusTag } from "@/components/agri/ui-bits";
import { useFarmLocation } from "@/lib/location-context";
import { inr, kg, LOTS, roadKm, transportPerKg } from "@/services";
import { useCreateLot } from "@/hooks/use-lots";
import { useCropOptions, useEnsureCrop, useMyLots } from "@/hooks/use-my-lots";
import { cropEmoji } from "@/lib/crop-catalog";
import { getSession } from "@/services/session";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/crops")({
  head: () => ({
    meta: [
      { title: "My Crops — AgriSense" },
      {
        name: "description",
        content: "Every registered crop lot with its sell, hold or split status.",
      },
      { property: "og:title", content: "My Crops — AgriSense" },
      {
        property: "og:description",
        content: "Track quantity, grade, price and distance for each lot.",
      },
    ],
  }),
  component: Crops,
});

const FILTERS = ["All lots", "SELL NOW", "HOLD", "SPLIT"] as const;

function Crops() {
  const { location } = useFarmLocation();
  const { t } = useI18n();
  const signedIn = Boolean(getSession());
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All lots");
  const { lots: myLots, isLoading: lotsLoading, error: lotsError } = useMyLots();
  // Signed-in users see their own lots; visitors see the sample portfolio.
  const allLots = signedIn ? myLots : LOTS;
  const lots = filter === "All lots" ? allLots : allLots.filter((l) => l.status === filter);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formCrop, setFormCrop] = useState("Tomato");
  const [cropSearch, setCropSearch] = useState("");
  const [formQuantity, setFormQuantity] = useState("5000");
  const [formQuality, setFormQuality] = useState("Grade A");

  const { options: cropOptions, isLive: cropListLive } = useCropOptions();
  const filteredCrops = useMemo(() => {
    const q = cropSearch.trim().toLowerCase();
    const list = q ? cropOptions.filter((c) => c.toLowerCase().includes(q)) : cropOptions;
    // Let the farmer add a crop that is not in any list yet.
    if (q && !cropOptions.some((c) => c.toLowerCase() === q)) return [cropSearch.trim(), ...list];
    return list;
  }, [cropOptions, cropSearch]);

  const ensureCrop = useEnsureCrop();
  const createLot = useCreateLot();
  const submitting = ensureCrop.isPending || createLot.isPending;

  async function handleRegisterLot(e: React.FormEvent) {
    e.preventDefault();
    if (!signedIn) {
      toast.error(t("Please sign in to register a lot"));
      return;
    }
    const qtyNum = Number(formQuantity);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      toast.error(t("Enter a valid quantity"));
      return;
    }

    try {
      // Resolve the crop name to a backend crop id (creating it if needed).
      const crop = await ensureCrop.mutateAsync(formCrop);
      const backendLot = await createLot.mutateAsync({
        crop_id: crop.id,
        quantity_quintals: qtyNum / 100, // API expects quintals
        expected_quality: formQuality,
      });
      toast.success(`Lot #${backendLot.id} registered!`, {
        description: `${kg(qtyNum)} of ${crop.name} (${formQuality}) added successfully.`,
      });
      setFilter("All lots");
      setCropSearch("");
      setIsModalOpen(false);
    } catch (err) {
      toast.error("Could not register lot", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Portfolio"
        title="My crops"
        description={`${t("All lots priced from")} ${location.name}, ${location.district}. ${t("Distance and freight update when you change your farm location.")}`}
        action={
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> {t("Register lot")}
          </button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm transition-colors",
              filter === f
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            {t(f)}
          </button>
        ))}
      </div>

      {!signedIn && (
        <p className="text-sm text-muted-foreground">
          {t("Showing sample lots. Sign in to see and register your own lots.")}
        </p>
      )}
      {signedIn && lotsLoading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("Loading your lots…")}
        </p>
      )}
      {signedIn && lotsError && (
        <Panel className="border-destructive/40 text-sm text-destructive">
          {t("Could not load your lots")}: {lotsError.message}
        </Panel>
      )}
      {signedIn && !lotsLoading && !lotsError && lots.length === 0 && (
        <Panel className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="text-4xl">🌾</span>
          <p className="font-serif text-2xl">
            {allLots.length === 0 ? t("No lots registered yet") : t("No lots match this filter")}
          </p>
          {allLots.length === 0 && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> {t("Register lot")}
            </button>
          )}
        </Panel>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {lots.map((lot) => {
          const km = roadKm(location, lot.place);
          const freight = transportPerKg(km);
          const net = Math.round((lot.price - freight - lot.storagePerKg) * 10) / 10;
          return (
            <Panel key={lot.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-2xl">
                    {lot.emoji}
                  </span>
                  <div>
                    <p className="font-serif text-2xl">{t(lot.crop)}</p>
                    <p className="text-xs text-muted-foreground">
                      {lot.id} · {lot.grade} · {lot.stateLabel}
                    </p>
                  </div>
                </div>
                <StatusTag status={lot.status} />
              </div>

              <div className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                {[
                  ["Quantity", kg(lot.quantity)],
                  [
                    lot.priceSource === "live"
                      ? "Mandi price"
                      : lot.priceSource === "estimate"
                        ? "Est. price"
                        : "Offer",
                    `${inr(lot.price)}/kg`,
                  ],
                  ["Freight", `${inr(freight)}/kg`],
                  ["Net", `${inr(net)}/kg`],
                ].map(([l, v]) => (
                  <div key={l}>
                    <p className="text-xs text-muted-foreground">{t(l!)}</p>
                    <p className="mt-0.5">{v}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
                <Pill>
                  <MapPin className="h-3.5 w-3.5" /> {lot.place.name} · {km} km
                </Pill>
                <Pill>
                  <CalendarDays className="h-3.5 w-3.5" /> {t("Harvest")} {lot.harvest}
                </Pill>
                <Pill>
                  <Truck className="h-3.5 w-3.5" /> {lot.confidence}% {t("confidence")}
                </Pill>
              </div>

              <div className="mt-5 flex gap-3">
                <Link
                  to="/decision"
                  search={{ lot: lot.id }}
                  className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground"
                >
                  {t("View decision")}
                </Link>
                <Link to="/buyers" className="rounded-full border border-border px-4 py-2 text-sm">
                  {t("Find buyers")}
                </Link>
              </div>
            </Panel>
          );
        })}
      </div>

      {/* Modal Overlay */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-[2rem] border border-border bg-card p-6 shadow-xl">
            <h2 className="font-serif text-2xl">{t("Register a new lot")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("Enter the details of your harvest.")}
            </p>

            <form onSubmit={handleRegisterLot} className="mt-6 space-y-4">
              <div>
                <div className="flex items-baseline justify-between">
                  <label className="text-sm text-muted-foreground">{t("Crop type")}</label>
                  <span className="text-[11px] text-muted-foreground">
                    {cropOptions.length} {t("crops")} ·{" "}
                    {cropListLive ? t("live Mandi list") : t("offline list")}
                  </span>
                </div>
                <div className="mt-1 rounded-xl border border-border bg-background focus-within:border-primary">
                  <div className="flex items-center gap-2 border-b border-border px-3">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <input
                      value={cropSearch}
                      onChange={(e) => setCropSearch(e.target.value)}
                      placeholder={t("Search crops, e.g. wheat, cotton, mango")}
                      aria-label={t("Search crops")}
                      className="w-full bg-transparent py-2.5 text-sm outline-none"
                    />
                  </div>
                  <ul
                    role="listbox"
                    aria-label={t("Crop type")}
                    className="max-h-48 overflow-y-auto p-1"
                  >
                    {filteredCrops.slice(0, 200).map((c) => (
                      <li key={c}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={formCrop === c}
                          onClick={() => setFormCrop(c)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm",
                            formCrop === c
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-secondary",
                          )}
                        >
                          <span>{cropEmoji(c)}</span>
                          <span className="flex-1">{t(c)}</span>
                          {!cropOptions.includes(c) && (
                            <span className="text-[11px] opacity-75">{t("add new")}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t("Selected")}: {cropEmoji(formCrop)}{" "}
                  <strong className="text-foreground">{formCrop}</strong>
                </p>
              </div>

              <div>
                <label className="text-sm text-muted-foreground">{t("Quantity (kg)")}</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={formQuantity}
                  onChange={(e) => setFormQuantity(e.target.value)}
                  required
                  className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="text-sm text-muted-foreground">{t("Expected quality")}</label>
                <select
                  value={formQuality}
                  onChange={(e) => setFormQuality(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
                >
                  <option value="Grade A">Grade A (Export quality)</option>
                  <option value="Grade B">Grade B (Standard)</option>
                  <option value="Grade C">Grade C (Processing)</option>
                </select>
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="w-full rounded-xl border border-border px-4 py-3 text-sm transition-colors hover:bg-secondary"
                >
                  {t("Cancel")}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("Register lot")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}

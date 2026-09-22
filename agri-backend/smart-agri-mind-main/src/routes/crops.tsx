import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarDays, MapPin, Plus, Truck } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { PageHeader, Panel, Pill, StatusTag } from "@/components/agri/ui-bits";
import { useFarmLocation } from "@/lib/location-context";
import { inr, kg, LOTS, roadKm, transportPerKg } from "@/services";
import { useCreateLot } from "@/hooks/use-lots";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/crops")({
  head: () => ({
    meta: [
      { title: "My Crops — AgriSense" },
      { name: "description", content: "Every registered crop lot with its sell, hold or split status." },
      { property: "og:title", content: "My Crops — AgriSense" },
      { property: "og:description", content: "Track quantity, grade, price and distance for each lot." },
    ],
  }),
  component: Crops,
});

const FILTERS = ["All lots", "SELL NOW", "HOLD", "SPLIT"] as const;

function Crops() {
  const { location } = useFarmLocation();
  const { t } = useI18n();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All lots");
  const [lotsState, setLotsState] = useState(LOTS);
  const lots = filter === "All lots" ? lotsState : lotsState.filter((l) => l.status === filter);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formCrop, setFormCrop] = useState("Tomato");
  const [formQuantity, setFormQuantity] = useState("5000");
  const [formQuality, setFormQuality] = useState("Grade A");

  const createLot = useCreateLot();

  function handleRegisterLot(e: React.FormEvent) {
    e.preventDefault();
    
    // Map selected crop to an ID for the backend
    const cropIdMap: Record<string, number> = {
      Tomato: 1,
      Onion: 2,
      Potato: 3,
    };
    
    const qtyNum = parseInt(formQuantity) || 5000;
    const cropId = cropIdMap[formCrop] || 1;

    createLot.mutate(
      {
        crop_id: cropId,
        quantity_quintals: qtyNum / 100, // API expects quintals
        expected_quality: formQuality,
      },
      {
        onSuccess: (backendLot) => {
          toast.success(`Lot #${backendLot.id} registered!`, {
            description: `${qtyNum} kg of ${formCrop} (${formQuality}) added successfully.`,
          });
          
          const emojis: Record<string, string> = { Tomato: "🍅", Onion: "🧅", Potato: "🥔" };
          
          setLotsState([
            {
              id: `T${backendLot.id}`,
              crop: formCrop,
              emoji: emojis[formCrop] || "🌾",
              quantity: qtyNum,
              grade: formQuality,
              status: "HOLD",
              price: formCrop === "Tomato" ? 25 : formCrop === "Onion" ? 35 : 20,
              storagePerKg: 0.5,
              confidence: 90,
              harvest: "Today",
              stateLabel: "Fresh",
              place: location,
            },
            ...lotsState,
          ]);
          setIsModalOpen(false);
        },
        onError: (err) => {
          toast.error("Could not register lot", { description: err.message });
        },
      }
    );
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
                  ["Offer", `${inr(lot.price)}/kg`],
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
          <div className="w-full max-w-md rounded-[2rem] border border-border bg-card p-6 shadow-xl">
            <h2 className="font-serif text-2xl">{t("Register a new lot")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("Enter the details of your harvest.")}
            </p>
            
            <form onSubmit={handleRegisterLot} className="mt-6 space-y-4">
              <div>
                <label className="text-sm text-muted-foreground">{t("Crop type")}</label>
                <select
                  value={formCrop}
                  onChange={(e) => setFormCrop(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
                >
                  <option value="Tomato">{t("Tomato")} 🍅</option>
                  <option value="Onion">{t("Onion")} 🧅</option>
                  <option value="Potato">{t("Potato")} 🥔</option>
                </select>
              </div>
              
              <div>
                <label className="text-sm text-muted-foreground">{t("Quantity (kg)")}</label>
                <input
                  type="number"
                  min="100"
                  step="100"
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
                  disabled={createLot.isPending}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                >
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

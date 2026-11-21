import { createFileRoute } from "@tanstack/react-router";
import { MapPin, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PortalLayout } from "@/components/agri/portal-layout";
import { PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { useCreateOffer, useOffers } from "@/hooks/use-offers";
import { useLots } from "@/hooks/use-lots";
import { BuyerFpoMarket } from "@/components/fpo/buyer-fpo-market";
import { FarmerRating, LotPhotos } from "@/components/agri/quality-ui";
import { useI18n } from "@/lib/i18n";
import { FormActions, Input, Loading, Modal, shortDate } from "@/components/fpo/fpo-ui";
import {
  LotDealsModal,
  LotStatusPill,
  MessageLink,
  OfferActions,
  OfferStatusPill,
} from "@/components/agri/deal-ui";
import { inrKg, qtl } from "@/lib/deal-format";
import type { BackendLot } from "@/services/api-client";

export const Route = createFileRoute("/browse-produce")({
  head: () => ({ meta: [{ title: "Browse Produce — AgriSense" }] }),
  component: BrowseProduce,
});

function BrowseProduce() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [crop, setCrop] = useState("");
  const [selectedLot, setSelectedLot] = useState<BackendLot | null>(null);
  const [historyLot, setHistoryLot] = useState<number | null>(null);
  const [offerPrice, setOfferPrice] = useState("");
  const createOffer = useCreateOffer();
  const lots = useLots();
  const { data: offers = [] } = useOffers();
  const all = lots.data ?? [];
  const crops = [...new Set(all.map((l) => l.crop_name ?? ""))].filter(Boolean).sort();
  const filtered = all.filter(
    (lot) =>
      (!crop || lot.crop_name === crop) &&
      `${lot.crop_name} ${lot.expected_quality} ${lot.farmer_location} ${lot.farmer_name}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const negotiating = offers.filter((o) => o.status === "pending");

  function submitOffer(event: FormEvent) {
    event.preventDefault();
    if (!selectedLot || Number(offerPrice) <= 0) return;
    createOffer.mutate(
      // The form takes ₹/kg; the API stores ₹/quintal.
      { lot_id: selectedLot.id, price_offered: Math.round(Number(offerPrice) * 100 * 100) / 100 },
      {
        onSuccess: () => {
          toast.success(t("Offer sent to farmer"), {
            description: t("The farmer can accept, counter or decline it."),
          });
          setSelectedLot(null);
          setOfferPrice("");
        },
        onError: (error) => toast.error(t("Could not send offer"), { description: error.message }),
      },
    );
  }

  return (
    <PortalLayout roles={["buyer"]}>
      <PageHeader
        eyebrow="Buyer procurement"
        title="Browse produce"
        description="Find crop lots, make offers, and negotiate directly with farmers and FPOs."
      />

      {negotiating.length > 0 && (
        <Panel>
          <h2 className="font-serif text-2xl">{t("Your open negotiations")}</h2>
          <div className="mt-4 space-y-3">
            {negotiating.map((o) => (
              <div
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4"
              >
                <div>
                  <p className="font-medium">
                    {t(o.crop_name ?? "Lot")} · LOT-{o.lot_id} · {o.farmer_name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {o.created_by_role === "buyer"
                      ? t("You offered")
                      : o.parent_offer_id
                        ? t("Farmer countered with")
                        : t("Farmer offered")}{" "}
                    {inrKg(o.price_offered)} · {qtl(o.quantity_quintals ?? 0)} ·{" "}
                    <button
                      className="text-primary underline-offset-4 hover:underline"
                      onClick={() => setHistoryLot(o.lot_id)}
                    >
                      {t("History")}
                    </button>
                  </p>
                </div>
                <OfferActions offer={o} myRole="buyer" compact />
              </div>
            ))}
          </div>
        </Panel>
      )}

      <BuyerFpoMarket />

      <h2 className="font-serif text-2xl">{t("Individual farmer lots")}</h2>
      <div className="grid gap-3 md:grid-cols-[1fr_180px]">
        <label className="relative">
          <Search className="absolute left-4 top-3.5 h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search crop, place or farmer...")}
            className="w-full rounded-xl border border-border bg-card py-3 pl-11 pr-4 text-sm outline-none focus:border-primary"
          />
        </label>
        <select
          value={crop}
          onChange={(event) => setCrop(event.target.value)}
          className="rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none"
        >
          <option value="">{t("All crops")}</option>
          {crops.map((c) => (
            <option key={c} value={c}>
              {t(c)}
            </option>
          ))}
        </select>
      </div>
      {lots.isLoading ? (
        <Loading />
      ) : (
        <p className="text-sm text-muted-foreground">
          {filtered.length} {t("produce lots available")}
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        {filtered.map((lot) => {
          const mine = lot.my_offer_status;
          return (
            <Panel key={lot.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-serif text-xl">{t(lot.crop_name ?? "Lot")}</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />{" "}
                    {lot.farmer_location || t("Location not set")} · LOT-
                    {lot.id}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <Pill>{t("Farmer lot")}</Pill>
                  <LotStatusPill status={lot.display_status} />
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">{t("Available")}</p>
                  <p>{qtl(lot.quantity_quintals)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("Quality")}</p>
                  <p>{lot.expected_quality}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("Farmer")}</p>
                  <p>{lot.farmer_name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("Best offer")}</p>
                  <p>{lot.best_offer ? inrKg(lot.best_offer) : t("None yet")}</p>
                </div>
              </div>
              <FarmerRating lot={lot} />
              <LotPhotos lotId={lot.id} count={lot.photo_count} />
              <p className="mt-4 text-xs text-muted-foreground">
                {t("Listed")} {shortDate(lot.created_at)}
                {lot.my_offer_price
                  ? ` · ${t("your last offer")} ${inrKg(lot.my_offer_price)}`
                  : ""}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                {mine === "pending" ? (
                  <OfferStatusPill status="pending" />
                ) : (
                  <button
                    onClick={() => {
                      setSelectedLot(lot);
                      setOfferPrice(lot.best_offer ? String(lot.best_offer / 100) : "");
                    }}
                    className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground"
                  >
                    {mine ? t("Make a new offer") : t("Make offer")}
                  </button>
                )}
                {mine && (
                  <button
                    onClick={() => setHistoryLot(lot.id)}
                    className="rounded-full border border-border px-4 py-2 text-sm"
                  >
                    {t("History")}
                  </button>
                )}
                <MessageLink userId={lot.farmer_id} label="Message farmer" />
              </div>
            </Panel>
          );
        })}
      </div>
      {!lots.isLoading && filtered.length === 0 && (
        <Panel>
          <p className="text-sm text-muted-foreground">
            {all.length === 0
              ? t(
                  "No farmer has an open lot right now. Post a requirement and you will be notified.",
                )
              : t("No produce lots match your search.")}
          </p>
        </Panel>
      )}

      <Modal
        open={selectedLot !== null}
        onClose={() => setSelectedLot(null)}
        title={`${t("Make offer for")} ${t(selectedLot?.crop_name ?? "")}`}
        subtitle={
          selectedLot
            ? `${qtl(selectedLot.quantity_quintals)} · ${selectedLot.expected_quality} · ${selectedLot.farmer_name}`
            : undefined
        }
      >
        <form onSubmit={submitOffer}>
          <Input
            label="Your offer (₹/kg)"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={offerPrice}
            onChange={(event) => setOfferPrice(event.target.value)}
            hint={
              Number(offerPrice) > 0 && selectedLot
                ? `₹${Math.round(Number(offerPrice) * 100).toLocaleString("en-IN")}/q · ₹${Math.round(Number(offerPrice) * 100 * selectedLot.quantity_quintals).toLocaleString("en-IN")} ${t("for the lot")}`
                : undefined
            }
          />
          <FormActions
            onCancel={() => setSelectedLot(null)}
            submitLabel="Send offer"
            busy={createOffer.isPending}
          />
        </form>
      </Modal>

      <LotDealsModal lotId={historyLot} onClose={() => setHistoryLot(null)} myRole="buyer" />
    </PortalLayout>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BadgeCheck, Loader2, MapPin } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { inr, kg, LOTS } from "@/services";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAcceptOffer, useCreateOffer, useOffers } from "@/hooks/use-offers";
import { useLots } from "@/hooks/use-lots";
import { getBuyerPrices } from "@/services/api-client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

export const Route = createFileRoute("/buyers")({
  head: () => ({
    meta: [
      { title: "Buyers — AgriSense" },
      { name: "description", content: "Verified buyers with reliability scores, payment terms and expected net earnings." },
      { property: "og:title", content: "Buyers — AgriSense" },
      { property: "og:description", content: "Discover processors, exporters and retail chains buying near you." },
    ],
  }),
  component: Buyers,
});

const SORTS = ["Net earning", "Distance", "Reliability"] as const;

// Demo lot id=1 is the seeded farmer lot in the Rust DB.
function Buyers() {
  const { t } = useI18n();
  const [sort, setSort] = useState<(typeof SORTS)[number]>("Net earning");
  const lot = LOTS[0]!;

  // Tracks which buyer card is currently submitting
  const [submittingBuyerId, setSubmittingBuyerId] = useState<string | null>(null);
  const [submittedRequirementIds, setSubmittedRequirementIds] = useState<Set<number>>(
    () => new Set(),
  );
  const createOffer = useCreateOffer();
  const {
    data: buyerPrices = [],
    isLoading: buyerPricesLoading,
    isError: buyerPricesError,
    refetch: refetchBuyerPrices,
  } = useQuery({ queryKey: ["buyer-prices"], queryFn: getBuyerPrices });
  const { data: backendLots = [] } = useLots();
  const { data: offers = [] } = useOffers();
  const acceptOffer = useAcceptOffer();
  const liveLotId = backendLots[0]?.id ?? 0;

  const uniqueBuyerPrices = Array.from(
    new Map(
      buyerPrices.map((buyer) => [
        [
          buyer.buyer_id,
          buyer.crop_id,
          buyer.price_per_quintal,
          buyer.min_quantity_quintals,
          buyer.quality,
          buyer.delivery_location,
          buyer.required_by,
        ].join("|"),
        buyer,
      ]),
    ).values(),
  );
  const sortedBuyerPrices = [...uniqueBuyerPrices].sort((a, b) =>
    sort === "Reliability"
      ? a.buyer_name.localeCompare(b.buyer_name)
      : sort === "Distance"
        ? a.delivery_location.localeCompare(b.delivery_location)
        : b.price_per_kg - a.price_per_kg,
  );

  function handleSendOffer(requirementId: number, buyerId: number, pricePerKg: number) {
    if (!liveLotId) {
      toast.error("Register a crop lot before sending a buyer offer.");
      return;
    }
    setSubmittingBuyerId(String(buyerId));
    createOffer.mutate(
      {
        lot_id: liveLotId,
        buyer_id: buyerId,
        // Backend expects price per quintal (1 quintal = 100 kg)
        price_offered: pricePerKg * 100,
      },
      {
        onSuccess: (offer) => {
          toast.success("Offer submitted", {
            description: `₹${offer.price_offered / 100}/kg — awaiting the buyer's confirmation.`,
          });
          setSubmittedRequirementIds((current) => new Set(current).add(requirementId));
          setSubmittingBuyerId(null);
        },
        onError: (err) => {
          toast.error("Could not submit offer", { description: err.message });
          setSubmittingBuyerId(null);
        },
      },
    );
  }

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Buyer directory"
        title="Buyers near your farm"
        description={`${t("Buyer requirements for")} ${t(lot.crop)} ${lot.grade}.`}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Active buyer requirements" value={uniqueBuyerPrices.length} hint="Open requests" />
        <Metric label="Total requirement" value={kg(uniqueBuyerPrices.reduce((s, b) => s + b.min_quantity_quintals * 100, 0))} hint="Across buyers" />
        <Metric label="Highest offer" value={uniqueBuyerPrices.length ? `${inr(Math.max(...uniqueBuyerPrices.map((b) => b.price_per_kg)))}/kg` : "—"} hint="Current requests" />
      </div>

      <div className="flex flex-wrap gap-2">
        {SORTS.map((s) => (
          <button
            key={s}
            onClick={() => setSort(s)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm",
              sort === s
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            {t(`Sort: ${s}`)}
          </button>
        ))}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {sortedBuyerPrices.map((b) => {
          const offerSent = submittedRequirementIds.has(b.id);
          return (
          <Panel key={b.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-serif text-xl">{b.buyer_name}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" /> {b.delivery_location} · {b.quality}
                </p>
              </div>
              <Pill tone="green"><BadgeCheck className="h-3.5 w-3.5" /> Buyer requirement</Pill>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              {[
                ["Offer", `${inr(b.price_per_kg)}/kg`],
                ["Requirement", kg(b.min_quantity_quintals * 100)],
                ["Quality", b.quality],
                ["Required by", b.required_by],
              ].map(([l, v]) => (
                <div key={l}>
                  <p className="text-xs text-muted-foreground">{t(l!)}</p>
                  <p className="mt-0.5">{v}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 flex gap-3">
              <button
                id={`send-offer-${b.id}`}
                onClick={() => handleSendOffer(b.id, b.buyer_id, b.price_per_kg)}
                disabled={submittingBuyerId === String(b.id) || offerSent}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
              >
                {submittingBuyerId === String(b.id) && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {offerSent ? "Offer sent" : "Send offer"}
              </button>
              <button className="rounded-full border border-border px-4 py-2 text-sm">
                {t("Message buyer")}
              </button>
            </div>
          </Panel>
          );
        })}
      </div>
      {buyerPricesLoading && <Panel><p className="text-sm text-muted-foreground">Loading buyer requirements...</p></Panel>}
      {buyerPricesError && <Panel><p className="text-sm text-muted-foreground">Could not load buyer requirements.</p><button onClick={() => refetchBuyerPrices()} className="mt-3 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground">Retry</button></Panel>}
      {!buyerPricesLoading && !buyerPricesError && buyerPrices.length === 0 && <Panel><p className="text-sm text-muted-foreground">No buyer requirements have been created yet.</p></Panel>}

      <Panel>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl">Offers on your lots</h2>
            <p className="mt-1 text-sm text-muted-foreground">Review buyer offers and accept one to create an order.</p>
          </div>
          <Pill>{offers.length} offers</Pill>
        </div>
        <div className="mt-5 space-y-3">
          {offers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No buyer offers have been received yet.</p>
          ) : offers.map((offer) => (
            <div key={offer.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4">
              <div>
                <p className="font-medium">Buyer offer for your produce</p>
                <p className="mt-1 text-sm text-muted-foreground">
                Buyer offer · ₹{(offer.price_offered / 100).toFixed(2)}/kg · {offer.status}
                </p>
              </div>
              {offer.status === "pending" ? (
                <button
                  onClick={() => acceptOffer.mutate(offer.id, {
                    onSuccess: () => toast.success("Offer accepted", { description: "Settlement has been created for this lot." }),
                    onError: (error) => toast.error("Could not accept offer", { description: error.message }),
                  })}
                  disabled={acceptOffer.isPending}
                  className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
                >
                  Accept & settle
                </button>
              ) : (
                <Pill tone="green">{offer.status}</Pill>
              )}
            </div>
          ))}
        </div>
      </Panel>
    </PortalLayout>
  );
}

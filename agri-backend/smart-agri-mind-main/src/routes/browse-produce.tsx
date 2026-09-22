import { createFileRoute } from "@tanstack/react-router";
import { BadgeCheck, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PortalLayout } from "@/components/agri/portal-layout";
import { PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { useCreateOffer, useOffers } from "@/hooks/use-offers";
import { useLots } from "@/hooks/use-lots";

export const Route = createFileRoute("/browse-produce")({
  head: () => ({ meta: [{ title: "Browse Produce — AgriSense" }] }),
  component: BrowseProduce,
});

const CROP_NAMES: Record<number, string> = { 1: "Tomato", 2: "Wheat", 3: "Onion" };

function BrowseProduce() {
  const [query, setQuery] = useState("");
  const [crop, setCrop] = useState("All crops");
  const [selectedLot, setSelectedLot] = useState<{
    lotId: number;
    crop: string;
    quantity: number;
    price: number;
    grade: string;
    location: string;
    supplier: string;
  } | null>(null);
  const [offerPrice, setOfferPrice] = useState("");
  const createOffer = useCreateOffer();
  const { data: backendLots = [] } = useLots();
  const { data: offers = [] } = useOffers();
  const liveLots = backendLots.map((lot) => ({
    lotId: lot.id,
    crop: CROP_NAMES[lot.crop_id] ?? `Crop ${lot.crop_id}`,
    quantity: lot.quantity_quintals * 100,
    price: 0,
    grade: lot.expected_quality,
    location: `Farmer lot #${lot.id}`,
    supplier: `Farmer #${lot.farmer_id}`,
  }));
  const filtered = liveLots.filter((lot) =>
    (crop === "All crops" || lot.crop === crop) &&
    `${lot.crop} ${lot.grade} ${lot.location} ${lot.supplier}`.toLowerCase().includes(query.toLowerCase()),
  );

  function submitOffer(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLot || Number(offerPrice) <= 0) return;
    const backendLot = backendLots.find((lot) => lot.id === selectedLot.lotId) ?? backendLots[0];
    if (!backendLot) {
      toast.error("This produce lot is no longer available.");
      return;
    }
    createOffer.mutate(
      { lot_id: backendLot.id, price_offered: Number(offerPrice) * 100 },
      {
        onSuccess: (offer) => {
          toast.success("Offer sent to farmer", { description: "Your offer is waiting for the farmer's approval." });
          setSelectedLot(null);
          setOfferPrice("");
        },
        onError: (error) => toast.error("Could not send offer", { description: error.message }),
      },
    );
  }

  return (
    <PortalLayout>
      <PageHeader eyebrow="Buyer procurement" title="Browse produce" description="Find verified crop lots, compare prices, and contact suppliers." />
      <div className="grid gap-3 md:grid-cols-[1fr_180px]">
        <label className="relative"><Search className="absolute left-4 top-3.5 h-4 w-4 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search crop, variety or supplier..." className="w-full rounded-xl border border-border bg-card py-3 pl-11 pr-4 text-sm outline-none focus:border-primary" /></label>
        <select value={crop} onChange={(event) => setCrop(event.target.value)} className="rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none"><option>All crops</option><option>Tomato</option><option>Onion</option><option>Wheat</option></select>
      </div>
      <p className="text-sm text-muted-foreground">{filtered.length} produce lots available</p>
      <div className="grid gap-5 md:grid-cols-2">
        {filtered.map((lot) => {
          const existingOffer = offers.find((offer) => offer.lot_id === lot.lotId);
          return <Panel key={lot.lotId}>
          <div className="flex items-start justify-between gap-3"><div><p className="font-serif text-xl">{lot.crop}</p><p className="mt-1 text-xs text-muted-foreground">{lot.grade} · {lot.location}</p></div><Pill tone="green"><BadgeCheck className="h-3.5 w-3.5" /> Verified</Pill></div>
          <div className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">Available</p><p>{lot.quantity.toLocaleString()} kg</p></div><div><p className="text-xs text-muted-foreground">Quality</p><p>{lot.grade}</p></div><div><p className="text-xs text-muted-foreground">Supplier</p><p>{lot.supplier}</p></div><div><p className="text-xs text-muted-foreground">Availability</p><p>Available now</p></div></div>
          <p className="mt-4 text-sm text-muted-foreground">Fresh produce available from a verified farmer</p>
          <div className="mt-5 flex gap-3"><button onClick={() => toast.info("Lot details", { description: `${lot.quantity.toLocaleString()} kg of ${lot.crop} at ₹${lot.price}/kg from ${lot.location}.` })} className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground">View details</button><button onClick={() => setSelectedLot(lot)} className="rounded-full border border-border px-4 py-2 text-sm">Send request</button><button onClick={() => setSelectedLot(lot)} disabled={Boolean(existingOffer)} className="rounded-full border border-border px-4 py-2 text-sm disabled:opacity-60">{existingOffer ? `Offer ${existingOffer.status}` : "Make offer"}</button></div>
        </Panel>;
        })}
      </div>
      {filtered.length === 0 && <Panel><p className="text-sm text-muted-foreground">No produce lots match your search.</p></Panel>}
      {selectedLot && <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
        <Panel className="w-full max-w-md">
          <h2 className="font-serif text-2xl">Make offer for {selectedLot.crop}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{selectedLot.quantity.toLocaleString()} kg · {selectedLot.location}</p>
          <form onSubmit={submitOffer} className="mt-5 space-y-4">
            <label className="block text-sm"><span className="text-muted-foreground">Your offer (₹/kg)</span><input type="number" min="0.01" step="0.01" value={offerPrice} onChange={(event) => setOfferPrice(event.target.value)} placeholder={String(selectedLot.price)} required className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 outline-none focus:border-primary" /></label>
            <div className="flex justify-end gap-3"><button type="button" onClick={() => setSelectedLot(null)} className="rounded-full border border-border px-4 py-2 text-sm">Cancel</button><button disabled={createOffer.isPending} className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60">{createOffer.isPending ? "Sending..." : "Send offer"}</button></div>
          </form>
        </Panel>
      </div>}
    </PortalLayout>
  );
}

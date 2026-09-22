import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { createBuyerDemand, deleteBuyerDemand, getBuyerDemands } from "@/services/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type RequirementRow = {
  crop: string;
  variety: string;
  quantity: string;
  target: string;
  location: string;
  due: string;
  status: string;
};

export const Route = createFileRoute("/requirements")({
  head: () => ({ meta: [{ title: "My Requirements — AgriSense" }] }),
  component: Requirements,
});

function Requirements() {
  const [showForm, setShowForm] = useState(false);
  const [cropId, setCropId] = useState("1");
  const [quantity, setQuantity] = useState("6000");
  const [price, setPrice] = useState("3200");
  const [location, setLocation] = useState("Nashik");
  const [requiredBy, setRequiredBy] = useState("2026-09-20");
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const { data: buyerDemands = [], isLoading } = useQuery({
    queryKey: ["buyer-demands"],
    queryFn: getBuyerDemands,
  });

  async function submitRequirement(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await createBuyerDemand({
        crop_id: Number(cropId),
        min_quantity: Number(quantity) / 100,
        max_price: Number(price),
        required_quality: "Grade A",
        delivery_location: location,
        required_by: requiredBy,
      });
      await queryClient.invalidateQueries({ queryKey: ["buyer-demands"] });
      setShowForm(false);
      toast.success("Requirement listed", { description: "Farmers can now see and respond to your sourcing requirement." });
    } catch (error) {
      toast.error("Could not list requirement", { description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setSaving(false);
    }

  }

  async function removeRequirement(id: number) {
    if (!window.confirm("Remove this requirement permanently?")) return;
    try {
      await deleteBuyerDemand(id);
      toast.success("Requirement removed");
      await queryClient.invalidateQueries({ queryKey: ["buyer-demands"] });
      await queryClient.invalidateQueries({ queryKey: ["buyer-prices"] });
    } catch (error) {
      toast.error("Could not update requirement", { description: error instanceof Error ? error.message : "Please try again." });
    }
  }

  return (
    <PortalLayout>
      <PageHeader eyebrow="Buyer procurement" title="My requirements" description="Create and manage sourcing requirements for your business." />
      <div className="grid gap-4 sm:grid-cols-3"><Metric label="Open" value={buyerDemands.length} hint="Accepting offers" /><Metric label="Matching" value={0} hint="Finding suppliers" /><Metric label="Fulfilled" value={0} hint="This season" /></div>
      <button onClick={() => setShowForm((value) => !value)} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"><Plus className="h-4 w-4" /> Create requirement</button>
      {showForm && <Panel><form onSubmit={submitRequirement} className="grid gap-4 sm:grid-cols-2">
        <select value={cropId} onChange={(event) => setCropId(event.target.value)} className="rounded-xl border border-border bg-background px-4 py-3 text-sm"><option value="1">Tomato</option><option value="2">Wheat</option><option value="3">Onion</option></select>
        <input value={quantity} onChange={(event) => setQuantity(event.target.value)} type="number" min="1" placeholder="Quantity (kg)" className="rounded-xl border border-border bg-background px-4 py-3 text-sm" required />
        <input value={price} onChange={(event) => setPrice(event.target.value)} type="number" min="1" placeholder="Maximum price (₹/quintal)" className="rounded-xl border border-border bg-background px-4 py-3 text-sm" required />
        <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Delivery location" className="rounded-xl border border-border bg-background px-4 py-3 text-sm" required />
        <input value={requiredBy} onChange={(event) => setRequiredBy(event.target.value)} type="date" className="rounded-xl border border-border bg-background px-4 py-3 text-sm" required />
        <button disabled={saving} className="rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground disabled:opacity-60">{saving ? "Listing..." : "List requirement"}</button>
      </form></Panel>}
      <Panel className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground">{["Crop", "Quality", "Quantity", "Target price", "Location", "Required by", "Status", "Actions"].map((heading) => <th key={heading} className="px-6 py-3 font-medium">{heading}</th>)}</tr></thead><tbody>{buyerDemands.map((requirement) => <tr key={requirement.id} className="border-b border-border/60 last:border-0"><td className="px-6 py-4 font-medium">{requirement.crop_name}</td><td className="px-6 py-4">{requirement.quality}</td><td className="px-6 py-4">{requirement.min_quantity_quintals * 100} kg</td><td className="px-6 py-4">Up to ₹{requirement.price_per_kg}/kg</td><td className="px-6 py-4">{requirement.delivery_location}</td><td className="px-6 py-4">{requirement.required_by}</td><td className="px-6 py-4"><Pill tone="green">Open</Pill></td><td className="px-6 py-4"><button onClick={() => void removeRequirement(requirement.id)} className="inline-flex items-center gap-1 text-destructive underline"><Trash2 className="h-3.5 w-3.5" /> Remove</button></td></tr>)}</tbody></table></div>{!isLoading && buyerDemands.length === 0 && <p className="p-6 text-sm text-muted-foreground">No requirements have been created for this buyer account yet.</p>}</Panel>
    </PortalLayout>
  );
}

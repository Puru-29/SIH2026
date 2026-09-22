import { createFileRoute } from "@tanstack/react-router";
import { BadgeCheck, MapPin } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { PageHeader, Panel, Pill } from "@/components/agri/ui-bits";

export const Route = createFileRoute("/suppliers")({
  head: () => ({ meta: [{ title: "Suppliers — AgriSense" }] }),
  component: Suppliers,
});

const SUPPLIERS = [
  { name: "Sahyadri supplier network", type: "FPO", location: "Nashik", crops: "Tomato, Onion", reliability: 94, orders: 18 },
  { name: "Verified farmer network", type: "Farmer", location: "Pune", crops: "Wheat, Tomato", reliability: 91, orders: 11 },
  { name: "Green Valley growers", type: "FPO", location: "Ahmednagar", crops: "Onion, Wheat", reliability: 88, orders: 9 },
];

function Suppliers() {
  return (
    <PortalLayout>
      <PageHeader eyebrow="Buyer procurement" title="Suppliers" description="Discover verified farmers and FPOs you can source from with confidence." />
      <div className="grid gap-3 md:grid-cols-[1fr_180px]"><input placeholder="Search suppliers or crops..." className="rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-primary" /><select className="rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none"><option>All locations</option><option>Nashik</option><option>Pune</option><option>Ahmednagar</option></select></div>
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{SUPPLIERS.map((supplier) => <Panel key={supplier.name}><div className="flex items-start justify-between gap-3"><div><p className="font-serif text-xl">{supplier.name}</p><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5" /> {supplier.location} · {supplier.type}</p></div><Pill tone="green"><BadgeCheck className="h-3.5 w-3.5" /> Verified</Pill></div><p className="mt-5 text-sm">{supplier.crops}</p><div className="mt-4 flex justify-between text-sm"><span className="text-muted-foreground">Reliability</span><span>{supplier.reliability}/100</span></div><div className="mt-2 h-2 rounded-full bg-secondary"><div className="h-2 rounded-full bg-primary" style={{ width: `${supplier.reliability}%` }} /></div><p className="mt-4 text-xs text-muted-foreground">{supplier.orders} completed orders</p><div className="mt-5 flex gap-3"><button className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground">View profile</button><button className="rounded-full border border-border px-4 py-2 text-sm">Contact</button></div></Panel>)}</div>
    </PortalLayout>
  );
}

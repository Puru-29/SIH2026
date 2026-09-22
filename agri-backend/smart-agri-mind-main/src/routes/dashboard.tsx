import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BadgeCheck, Boxes, ClipboardList, IndianRupee, MapPin, Search, TrendingUp, Truck } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, Panel, Pill, StatusTag } from "@/components/agri/ui-bits";
import { useFarmLocation } from "@/lib/location-context";
import { BUYERS, inr, kg, LOTS, MARKETS, roadKm, transportPerKg } from "@/services";
import { getSession } from "@/services/session";
import { useI18n } from "@/lib/i18n";
import { useAcceptOffer, useOffers } from "@/hooks/use-offers";
import { useTransactions } from "@/hooks/use-transactions";
import { getBuyerDemands } from "@/services/api-client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Farmer Dashboard — AgriSense" },
      {
        name: "description",
        content: "Active lots, AI market decisions, mandi opportunities and buyer offers.",
      },
      { property: "og:title", content: "Farmer Dashboard — AgriSense" },
      { property: "og:description", content: "Your crop lots and today's best selling decision." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const session = getSession();
  if (session?.role === "buyer") {
    return <BuyerDashboard />;
  }

  const { location } = useFarmLocation();
  const { t } = useI18n();
  const firstName = (session?.name || "Ramesh").split(" ")[0];
  
  const hero = LOTS[0]!;
  const bestBuyer = BUYERS[0]!;
  const buyerKm = roadKm(location, bestBuyer);
  const freight = transportPerKg(buyerKm);
  const net = (bestBuyer.offer - freight) * hero.quantity;
  const totalKg = LOTS.reduce((s, l) => s + l.quantity, 0);
  const totalValue = LOTS.reduce((s, l) => s + l.quantity * l.price, 0);

  return (
    <PortalLayout>
      <div>
        <p className="eyebrow">{new Date().toDateString()}</p>
        <h1 className="mt-2 font-serif text-4xl">
          {t("Namaste, Ramesh 🙏").replace("Ramesh", firstName!)}
        </h1>
        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4" /> {location.name}, {location.district}, {location.state} ·{" "}
          {location.belt}
        </p>
      </div>

      {/* AI decision hero */}
      <Panel className="bg-primary text-primary-foreground">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Pill className="bg-primary-foreground/15 text-primary-foreground">
              {t("AI market decision")}
            </Pill>
            <h2 className="mt-4 font-serif text-3xl">
              {t("Sell now")} · {kg(hero.quantity)} {t(hero.crop)} at {inr(bestBuyer.offer)}/kg
            </h2>
            <p className="mt-2 max-w-xl text-sm text-primary-foreground/75">
              {bestBuyer.name} {t("is")} {buyerKm} km {t("from")} {location.name}. {t("After")} {inr(freight)}/kg{" "}
              {t("transport your net realization is")} {inr(net)} — {hero.confidence}% {t("confidence")}.
            </p>
          </div>
          <StatusTag status={hero.status} />
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            ["Offer price", `${inr(bestBuyer.offer)}/kg`],
            ["Transport", `${inr(freight)}/kg · ${buyerKm} km`],
            ["Net realization", inr(net)],
          ].map(([l, v]) => (
            <div key={l} className="rounded-2xl bg-primary-foreground/10 p-4">
              <p className="text-xs text-primary-foreground/70">{t(l!)}</p>
              <p className="mt-1 font-serif text-2xl">{v}</p>
            </div>
          ))}
        </div>
        <Link
          to="/decision"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary-foreground px-5 py-2.5 text-sm font-medium text-primary"
        >
          {t("View full breakdown")} <ArrowRight className="h-4 w-4" />
        </Link>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Active lots" value={LOTS.length} hint={kg(totalKg)} icon={<Boxes className="h-4 w-4" />} />
        <Metric label="Portfolio value" value={inr(totalValue)} hint={t("At current offers")} icon={<IndianRupee className="h-4 w-4" />} />
        <Metric label="Best mandi gain" value="+6.1%" hint="Mumbai Vashi APMC" icon={<TrendingUp className="h-4 w-4" />} />
        <Metric label="Avg transport" value={inr(freight) + "/kg"} hint={`${buyerKm} km ${t("to nearest buyer")}`} icon={<Truck className="h-4 w-4" />} />
      </div>

      {/* Crop lots */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl">{t("Your crop lots")}</h2>
          <Link to="/crops" className="text-sm underline underline-offset-4">
            {t("View all")}
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {LOTS.map((lot) => {
            const km = roadKm(location, lot.place);
            return (
              <Panel key={lot.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{lot.emoji}</span>
                    <div>
                      <p className="font-serif text-xl">{t(lot.crop)}</p>
                      <p className="text-xs text-muted-foreground">
                        {lot.id} · {lot.grade}
                      </p>
                    </div>
                  </div>
                  <StatusTag status={lot.status} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">{t("Quantity")}</p>
                    <p>{kg(lot.quantity)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("Price")}</p>
                    <p>{inr(lot.price)}/kg</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("Distance")}</p>
                    <p>{km} km</p>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      </section>

      {/* Market opportunities */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <h2 className="font-serif text-2xl">{t("Market opportunities")}</h2>
          {MARKETS.slice(0, 4).map((m) => {
            const km = roadKm(location, m);
            const freightKg = transportPerKg(km);
            return (
              <Panel key={m.id} className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {km} km · {inr(freightKg)}/kg freight · {m.demand} demand
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-serif text-xl">{inr(m.price)}/kg</p>
                  <p className={m.trend >= 0 ? "text-xs text-primary" : "text-xs text-clay"}>
                    {m.trend >= 0 ? "+" : ""}
                    {m.trend}%
                  </p>
                </div>
              </Panel>
            );
          })}
        </div>
        <div className="space-y-4">
          <h2 className="font-serif text-2xl">{t("Buyer opportunities")}</h2>
          {BUYERS.map((b) => {
            const km = roadKm(location, b);
            return (
              <Panel key={b.id} className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="font-medium">{b.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {b.type} · {km} km · {b.terms}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-serif text-xl">{inr(b.offer)}/kg</p>
                  <Pill tone="green">{b.reliability}/100</Pill>
                </div>
              </Panel>
            );
          })}
        </div>
      </section>
    </PortalLayout>
  );
}

function BuyerDashboard() {
  const { t } = useI18n();
  const session = getSession();
  const buyerName = session?.name || "Buyer";
  const { data: offers = [] } = useOffers();
  const farmerOffers = offers.filter((offer) => offer.created_by_role === "farmer");
  const acceptOffer = useAcceptOffer();
  const { data: buyerDemands = [] } = useQuery({
    queryKey: ["buyer-demands"],
    queryFn: getBuyerDemands,
  });
  const { data: transactions = [] } = useTransactions();

  const lots = [
    { crop: "Tomato", quantity: "5,000 kg", grade: "Grade A", price: "₹30/kg", supplier: "Verified farmer network", location: "Nashik", match: 96 },
    { crop: "Onion", quantity: "8,000 kg", grade: "Grade A", price: "₹20/kg", supplier: "Verified FPO network", location: "Lasalgaon", match: 89 },
  ];
  return (
    <PortalLayout>
      <div>
        <p className="eyebrow">{new Date().toDateString()}</p>
        <h1 className="mt-2 font-serif text-4xl">{t("Source with confidence")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Find verified produce, manage procurement, and track every order in one place.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">Buyer account · {buyerName}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Active requirements" value={buyerDemands.length} hint="Open sourcing needs" icon={<ClipboardList className="h-4 w-4" />} />
        <Metric label="Matched lots" value={lots.length} hint="Ready to review" icon={<Search className="h-4 w-4" />} />
        <Metric label="Active orders" value={transactions.length} hint="Accepted offers" icon={<Boxes className="h-4 w-4" />} />
        <Metric label="Completed orders" value={transactions.filter((transaction) => transaction.status === "completed").length} hint="Accepted and settled" icon={<IndianRupee className="h-4 w-4" />} />
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl">Active requirements</h2>
          <Link to="/requirements" className="text-sm underline underline-offset-4">Manage requirements</Link>
        </div>
        <Panel className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead><tr className="border-b border-border text-left text-xs text-muted-foreground">
                {["Crop", "Quantity", "Target price", "Location", "Required by", "Status"].map((heading) => <th key={heading} className="px-6 py-3 font-medium">{heading}</th>)}
              </tr></thead>
              <tbody>{buyerDemands.map((requirement) => <tr key={requirement.id} className="border-b border-border/60 last:border-0">
                <td className="px-6 py-4 font-medium">{requirement.crop_name}</td><td className="px-6 py-4">{requirement.min_quantity_quintals * 100} kg</td><td className="px-6 py-4">₹{requirement.price_per_kg}/kg</td><td className="px-6 py-4">{requirement.delivery_location}</td><td className="px-6 py-4">{requirement.required_by}</td><td className="px-6 py-4"><Pill tone="green">Open</Pill></td>
              </tr>)}</tbody>
            </table>
          </div>
        </Panel>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl">Farmer offers</h2>
          <p className="text-sm text-muted-foreground">Offers received from your suppliers</p>
        </div>
        <Panel className="p-0">
          {farmerOffers.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No farmer offers are waiting for your response.</p>
          ) : (
            <div className="divide-y divide-border">
              {farmerOffers.map((offer) => (
                <div key={offer.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div>
                    <p className="font-medium">Farmer offer for your requirement</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      ₹{(offer.price_offered / 100).toFixed(2)}/kg · Status: {offer.status}
                    </p>
                  </div>
                  {offer.status === "pending" ? (
                    <button
                      onClick={() => acceptOffer.mutate(offer.id, {
                        onSuccess: () => toast.success("Offer accepted", { description: "The order is now visible to both parties." }),
                        onError: (error) => toast.error("Could not accept offer", { description: error.message }),
                      })}
                      disabled={acceptOffer.isPending}
                      className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
                    >
                      Accept farmer offer
                    </button>
                  ) : (
                    <Pill tone="green">{offer.status}</Pill>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl">Matched produce</h2>
          <Link to="/browse-produce" className="text-sm underline underline-offset-4">Browse all produce</Link>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {lots.map((lot) => <Panel key={lot.crop}>
            <div className="flex items-start justify-between gap-3"><div><p className="font-serif text-xl">{lot.crop}</p><p className="mt-1 text-xs text-muted-foreground">{lot.grade} · {lot.location} · {lot.supplier}</p></div><Pill tone="green"><BadgeCheck className="h-3.5 w-3.5" /> {lot.match}% match</Pill></div>
            <div className="mt-5 grid grid-cols-3 gap-3 text-sm"><div><p className="text-xs text-muted-foreground">Available</p><p>{lot.quantity}</p></div><div><p className="text-xs text-muted-foreground">Price</p><p>{lot.price}</p></div><div><p className="text-xs text-muted-foreground">Delivery</p><p>3–5 days</p></div></div>
            <div className="mt-5 flex gap-3"><Link to="/browse-produce" className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground">View lot</Link><button className="rounded-full border border-border px-4 py-2 text-sm">Send request</button></div>
          </Panel>)}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between"><h2 className="font-serif text-2xl">Active orders</h2><Link to="/orders" className="text-sm underline underline-offset-4">View all orders</Link></div>
        <Panel className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm">        <thead><tr className="border-b border-border text-left text-xs text-muted-foreground">{["Produce", "Quantity", "Agreed price", "Status", "Accepted"].map((heading) => <th key={heading} className="px-6 py-3 font-medium">{heading}</th>)}</tr></thead><tbody>{transactions.map((transaction) => <tr key={transaction.id} className="border-b border-border/60 last:border-0"><td className="px-6 py-4 font-medium">{transaction.crop_name}</td><td className="px-6 py-4">{transaction.quantity_quintals * 100} kg</td><td className="px-6 py-4">₹{(transaction.final_price / 100).toFixed(2)}/kg</td><td className="px-6 py-4"><Pill tone="green">Completed</Pill></td><td className="px-6 py-4">{transaction.completed_at}</td></tr>)}</tbody></table></div>{transactions.length === 0 && <p className="p-6 text-sm text-muted-foreground">No completed orders yet. An order appears here after an offer is accepted.</p>}</Panel>
      </section>
    </PortalLayout>
  );
}

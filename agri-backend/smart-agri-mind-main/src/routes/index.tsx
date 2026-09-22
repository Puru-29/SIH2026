import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BadgeCheck,
  Brain,
  CircleDollarSign,
  Handshake,
  LineChart,
  MapPin,
  ShieldCheck,
  Sprout,
  Truck,
  Users,
} from "lucide-react";
import heroFarmer from "@/assets/hero-farmer.jpg";
import mandi from "@/assets/mandi.jpg";
import { Panel, Pill } from "@/components/agri/ui-bits";
import {
  FaqSection,
  FarmerStories,
  NetCalculator,
  PriceTicker,
  TrustMetrics,
} from "@/components/agri/landing-extras";
import { LanguageSelector } from "@/components/agri/language-selector";
import { FontSizeControl } from "@/components/agri/font-size-control";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AgriSense — Sell at the right price, to the right buyer" },
      {
        name: "description",
        content:
          "AgriSense combines mandi prices, buyer demand, transport cost and reliability into one decision for every crop lot.",
      },
      { property: "og:title", content: "AgriSense — Market intelligence for Indian farmers" },
      {
        property: "og:description",
        content: "Sell now, hold or split — backed by six weighted market signals.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { t: tr } = useI18n();
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sprout className="h-4 w-4" />
          </span>
          <span className="font-serif text-xl">AgriSense</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <a href="#gap">{tr("The gap")}</a>
          <a href="#engine">{tr("Decision engine")}</a>
          <a href="#intelligence">{tr("Market intelligence")}</a>
          <a href="#trust">{tr("Buyer trust")}</a>
        </nav>
        <div className="flex items-center gap-3">
          <FontSizeControl className="hidden sm:flex" />
          <LanguageSelector className="hidden sm:flex" />
          <Link to="/auth" className="hidden text-sm text-muted-foreground sm:block">
            {tr("Sign in")}
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
          >
            {tr("Open portal")} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <PriceTicker />

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-2 lg:py-20">
        <div>
          <Pill tone="green">
            <MapPin className="h-3.5 w-3.5" /> {tr("Built for Indian mandis")}
          </Pill>
          <h1 className="mt-6 font-serif text-5xl leading-[1.05] text-foreground md:text-6xl">
            {tr("Know the price.")}
            <br />
            {tr("Know the buyer.")}
            <br />
            <span className="text-primary italic">{tr("Know when to sell.")}</span>
          </h1>
          <p className="mt-6 max-w-md text-base text-muted-foreground">
            {tr("AgriSense reads mandi arrivals, buyer demand, transport cost and payment reliability, then tells you exactly what to do with each crop lot — sell now, hold, or split.")}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground"
            >
              {tr("See a live decision")} <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/markets"
              className="rounded-full border border-border px-6 py-3 text-sm font-medium"
            >
              {tr("Browse markets")}
            </Link>
          </div>
          <div className="mt-10 flex flex-wrap gap-8">
            {[
              ["18%", "Higher net realization"],
              ["6", "Signals per decision"],
              ["1,400+", "Verified buyers"],
            ].map(([v, l]) => (
              <div key={l}>
                <p className="font-serif text-2xl text-foreground">{v}</p>
                <p className="text-xs text-muted-foreground">{tr(l!)}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="relative">
          <img
            src={heroFarmer}
            alt="Farmer holding a basket of freshly harvested tomatoes"
            width={1200}
            height={1408}
            className="w-full rounded-[2rem] object-cover"
          />
          <div className="absolute -bottom-6 left-6 right-16 rounded-3xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="eyebrow">{tr("Today's decision")}</p>
              <Pill tone="solid">{tr("SELL NOW")}</Pill>
            </div>
            <p className="mt-3 font-serif text-2xl">₹30/kg · Buyer A</p>
            <p className="text-xs text-muted-foreground">
              5,000 kg Tomato · net ₹1,45,000 after ₹2/kg transport
            </p>
          </div>
        </div>
      </section>

      {/* The Gap */}
      <section id="gap" className="mx-auto max-w-6xl px-6 py-24">
        <p className="eyebrow">{tr("The gap")}</p>
        <h2 className="mt-3 max-w-2xl font-serif text-4xl">
          {tr("Market information alone isn't enough")}
        </h2>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Farmers already receive prices on SMS. What they lack is the arithmetic that turns a
          price into a profit — and the confidence to act on it in time.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Panel className="bg-secondary">
            <Pill tone="clay">{tr("Today")}</Pill>
            <h3 className="mt-4 font-serif text-2xl">{tr("A price on a screen")}</h3>
            <ul className="mt-5 space-y-3 text-sm text-muted-foreground">
              {[
                "Mandi rate given without transport or commission deducted",
                "No visibility of who is actually buying this week",
                "Storage cost and spoilage risk estimated by guesswork",
                "Payment delays discovered only after the truck has left",
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-clay" />
                  {tr(t)}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel className="bg-primary text-primary-foreground">
            <Pill className="bg-primary-foreground/15 text-primary-foreground">{tr("With AgriSense")}</Pill>
            <h3 className="mt-4 font-serif text-2xl">{tr("A decision you can act on")}</h3>
            <ul className="mt-5 space-y-3 text-sm text-primary-foreground/80">
              {[
                "Net realization per kg after transport, commission and storage",
                "Ranked buyers with reliability scores and payment terms",
                "Four-week price forecast with a confidence band",
                "One tap to accept an offer and schedule pickup",
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-foreground/60" />
                  {tr(t)}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </section>

      {/* Decision engine */}
      <section id="engine" className="border-y border-border bg-secondary/60">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="eyebrow">{tr("AI decision engine")}</p>
              <h2 className="mt-3 max-w-xl font-serif text-4xl">
                {tr("Six weighted signals, one recommendation")}
              </h2>
            </div>
            <Link to="/decision" className="text-sm underline underline-offset-4">
              {tr("See a full breakdown")}
            </Link>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              {
                tag: "SELL NOW",
                tone: "solid" as const,
                title: "When demand peaks",
                body: "Offer is above the 30-day average, buyers are competing and spoilage risk is climbing.",
              },
              {
                tag: "HOLD",
                tone: "amber" as const,
                title: "When patience pays",
                body: "Forecast shows a rising band, storage is cheap and your crop keeps its grade.",
              },
              {
                tag: "SPLIT",
                tone: "slate" as const,
                title: "When you hedge",
                body: "Sell part now to cover input costs, hold the rest for the festival demand window.",
              },
            ].map((c) => (
              <Panel key={c.tag}>
                <Pill tone={c.tone}>{tr(c.tag)}</Pill>
                <h3 className="mt-4 font-serif text-2xl">{tr(c.title)}</h3>
                <p className="mt-3 text-sm text-muted-foreground">{tr(c.body)}</p>
              </Panel>
            ))}
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [CircleDollarSign, "Price analysis", "Live mandi and buyer offers"],
              [Users, "Demand analysis", "Active buyer requirement in your belt"],
              [Handshake, "Buyer matching", "Grade, volume and timing fit"],
              [Truck, "Transport analysis", "Distance-based cost per kg"],
              [Sprout, "Storage analysis", "Spoilage risk and holding cost"],
              [ShieldCheck, "Reliability analysis", "Payment history and disputes"],
            ].map(([Icon, title, sub]) => {
              const I = Icon as typeof Truck;
              return (
                <div
                  key={title as string}
                  className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4"
                >
                  <I className="mt-0.5 h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-medium">{tr(title as string)}</p>
                    <p className="text-xs text-muted-foreground">{tr(sub as string)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Market intelligence */}
      <section id="intelligence" className="mx-auto max-w-6xl px-6 py-24">
        <p className="eyebrow">{tr("Market intelligence")}</p>
        <h2 className="mt-3 max-w-2xl font-serif text-4xl">{tr("Everything priced from your farm gate")}</h2>
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {[
            {
              icon: LineChart,
              title: "Price forecast",
              body: "Four-week outlook with a confidence band and the drivers behind the curve.",
            },
            {
              icon: MapPin,
              title: "Mandi proximity",
              body: "Every mandi ranked by distance from your selected village, not the district HQ.",
            },
            {
              icon: Truck,
              title: "Transport costing",
              body: "Per-kg freight estimated from road distance and shared tempo availability.",
            },
            {
              icon: Users,
              title: "Buyer directory",
              body: "Processors, exporters, retail chains and wholesalers with live requirements.",
            },
            {
              icon: Brain,
              title: "Lot-level guidance",
              body: "Each lot carries its own recommendation, confidence score and next action.",
            },
            {
              icon: BadgeCheck,
              title: "Settlement tracking",
              body: "Invoices, advances and outstanding balances against every consignment.",
            },
          ].map((f) => (
            <Panel key={f.title}>
              <f.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-4 font-serif text-xl">{tr(f.title)}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{tr(f.body)}</p>
            </Panel>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-border bg-secondary/60">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <p className="eyebrow">{tr("How it works")}</p>
          <h2 className="mt-3 font-serif text-4xl">{tr("Three steps to a better price")}</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              ["01", "Register your lot", "Crop, grade, quantity, harvest date and farm location."],
              ["02", "Read the decision", "Six signals scored and weighted into sell, hold or split."],
              ["03", "Accept and track", "Confirm the buyer, schedule pickup, follow payment to settlement."],
            ].map(([n, t, b]) => (
              <Panel key={n}>
                <span className="font-serif text-4xl text-primary/30">{n}</span>
                <h3 className="mt-4 font-serif text-2xl">{tr(t)}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{tr(b)}</p>
              </Panel>
            ))}
          </div>
        </div>
      </section>

      {/* Trust & FPO */}
      <section id="trust" className="mx-auto grid max-w-6xl gap-10 px-6 py-24 lg:grid-cols-2">
        <div>
          <p className="eyebrow">{tr("Buyer trust")}</p>
          <h2 className="mt-3 font-serif text-4xl">{tr("Reliability is a number, not a rumour")}</h2>
          <p className="mt-4 text-muted-foreground">
            {tr("Every buyer carries a score built from on-time payments, honoured offers, rejection rates and dispute history. Small lots get aggregated through your FPO so you reach the volume buyers usually reserve for large traders.")}
          </p>
          <div className="mt-8 space-y-4">
            {[
              ["Verified payment record", "142 settlements tracked for Sahyadri Foods"],
              ["Escrow-backed advances", "50% released at pickup, balance on delivery"],
              ["FPO aggregation", "Pool 12 farmer lots into one 20-tonne consignment"],
            ].map(([t, b]) => (
              <div key={t} className="flex gap-4 rounded-2xl border border-border bg-card p-4">
                <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium">{tr(t)}</p>
                  <p className="text-xs text-muted-foreground">{tr(b)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <img
          src={mandi}
          alt="Farmers loading produce crates at an agricultural market yard"
          loading="lazy"
          width={1104}
          height={1104}
          className="h-full w-full rounded-[2rem] object-cover"
        />
      </section>

      <NetCalculator />
      <FarmerStories />
      <TrustMetrics />
      <FaqSection />

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="rounded-[2.5rem] bg-primary px-8 py-16 text-center text-primary-foreground">
          <h2 className="mx-auto max-w-2xl font-serif text-4xl md:text-5xl">
            {tr("Your next harvest deserves a better decision")}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-primary-foreground/75">
            {tr("Start with a demo farm in Dindori, Nashik and see how the engine prices every buyer and mandi around you.")}
          </p>
          <Link
            to="/auth"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary-foreground px-7 py-3 text-sm font-medium text-primary"
          >
            {tr("Enter the portal")} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground">
          <span className="font-serif text-base text-foreground">AgriSense</span>
          <p>{tr("Market intelligence for farmers, FPOs and buyers.")}</p>
          <p>© 2026 AgriSense</p>
        </div>
      </footer>
    </div>
  );
}

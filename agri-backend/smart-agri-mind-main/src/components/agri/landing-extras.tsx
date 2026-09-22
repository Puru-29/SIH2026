import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Lock, MapPin, TrendingDown, TrendingUp } from "lucide-react";
import { Panel, Pill } from "./ui-bits";
import { cn } from "@/lib/utils";
import { inr, LOCATIONS } from "@/services";
import {
  CALCULATOR_CROPS,
  calculateNetRealization,
  getFaqs,
  getTestimonials,
  getTicker,
  getTrustMetrics,
} from "@/services";
import { useI18n } from "@/lib/i18n";

export function PriceTicker() {
  const { t } = useI18n();
  const quotes = getTicker();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(id);
  }, []);

  const live = quotes.map((q, i) => {
    const wobble = Math.sin((tick + i) / 2) * 0.3;
    return { ...q, price: Math.round((q.price + wobble) * 10) / 10 };
  });

  return (
    <div className="border-y border-border bg-secondary/60">
      <div className="mx-auto flex max-w-6xl items-center gap-3 overflow-hidden px-6 py-2.5">
        <Pill tone="solid" className="shrink-0">
          {t("Live mandi")}
        </Pill>
        <div className="flex flex-1 gap-8 overflow-x-auto whitespace-nowrap text-sm [scrollbar-width:none]">
          {live.map((q) => (
            <span key={`${q.crop}-${q.mandi}`} className="flex items-center gap-2">
              <span className="font-medium">{t(q.crop)}</span>
              <span className="text-muted-foreground">{q.mandi}</span>
              <span className="font-medium">{inr(q.price)}/kg</span>
              <span
                className={cn(
                  "flex items-center gap-1 text-xs",
                  q.change >= 0 ? "text-primary" : "text-clay",
                )}
              >
                {q.change >= 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {q.change > 0 ? "+" : ""}
                {q.change}%
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function NetCalculator() {
  const { t } = useI18n();
  const [crop, setCrop] = useState(CALCULATOR_CROPS[0]!);
  const [quantity, setQuantity] = useState(5000);
  const [placeId, setPlaceId] = useState(LOCATIONS[0]!.id);
  const place = LOCATIONS.find((l) => l.id === placeId)!;

  const result = useMemo(
    () => calculateNetRealization({ crop, quantityKg: quantity, from: place }),
    [crop, quantity, place],
  );

  return (
    <section id="calculator" className="mx-auto max-w-6xl px-6 py-20">
      <p className="eyebrow">{t("Net realization calculator")}</p>
      <h2 className="mt-3 max-w-2xl font-serif text-4xl md:text-5xl">
        {t("See what actually reaches your hand.")}
      </h2>
      <p className="mt-4 max-w-xl text-muted-foreground">
        {t("Pick a crop, a quantity and your village. The headline price is only the start.")}
      </p>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel className="space-y-5">
          <div>
            <p className="eyebrow">{t("Crop")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {CALCULATOR_CROPS.map((c) => (
                <button
                  key={c}
                  onClick={() => setCrop(c)}
                  className={cn(
                    "rounded-full border px-4 py-2 text-sm transition-colors",
                    c === crop
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground",
                  )}
                >
                  {t(c)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="eyebrow">{t("Quantity")}</p>
              <p className="text-sm font-medium">{quantity.toLocaleString("en-IN")} kg</p>
            </div>
            <input
              type="range"
              min={500}
              max={20000}
              step={500}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="mt-3 w-full accent-[oklch(var(--primary))]"
              aria-label={t("Quantity in kilograms")}
            />
          </div>

          <div>
            <p className="eyebrow">{t("Your location")}</p>
            <select
              value={placeId}
              onChange={(e) => setPlaceId(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
              aria-label={t("Farm location")}
            >
              {LOCATIONS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}, {l.district} — {l.state}
                </option>
              ))}
            </select>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" /> {place.belt}
            </p>
          </div>
        </Panel>

        <div className="rounded-[2rem] bg-primary p-8 text-primary-foreground">
          <p className="text-xs uppercase tracking-[0.2em] text-primary-foreground/70">
            {t("Best net realization")}
          </p>
          <p className="mt-3 font-serif text-5xl">{inr(result.netPerKg)}/kg</p>
          <p className="mt-1 text-primary-foreground/75">
            {inr(result.totalNet)} {t("for")} {quantity.toLocaleString("en-IN")} kg
          </p>

          <dl className="mt-8 space-y-3 text-sm">
            <div className="flex justify-between border-b border-primary-foreground/15 pb-3">
              <dt className="text-primary-foreground/70">{t("Headline price")}</dt>
              <dd>{inr(result.headline)}/kg</dd>
            </div>
            <div className="flex justify-between border-b border-primary-foreground/15 pb-3">
              <dt className="text-primary-foreground/70">{t("Transport")} ({result.km} km)</dt>
              <dd>− {inr(result.freightPerKg)}/kg</dd>
            </div>
            <div className="flex justify-between border-b border-primary-foreground/15 pb-3">
              <dt className="text-primary-foreground/70">{t("Storage")}</dt>
              <dd>− {inr(result.storagePerKg)}/kg</dd>
            </div>
            <div className="flex justify-between pt-1">
              <dt className="text-primary-foreground/70">{t("Best option")}</dt>
              <dd className="text-right">{result.destination}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

export function FarmerStories() {
  const { t } = useI18n();
  const stories = getTestimonials();
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <p className="eyebrow">{t("Farmer stories")}</p>
      <h2 className="mt-3 max-w-2xl font-serif text-4xl md:text-5xl">
        {t("From the Nashik, Latur and Solapur belts.")}
      </h2>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {stories.map((s) => (
          <Panel key={s.name} className="flex h-full flex-col justify-between gap-6">
            <p className="font-serif text-xl leading-relaxed">“{t(s.quote)}”</p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  {s.place} · {t(s.crop)}
                </p>
              </div>
              <Pill tone="green">{s.gain}</Pill>
            </div>
          </Panel>
        ))}
      </div>
    </section>
  );
}

export function TrustMetrics() {
  const { t } = useI18n();
  const metrics = getTrustMetrics();
  return (
    <section className="bg-primary py-14 text-primary-foreground">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label}>
            <p className="font-serif text-4xl">{m.value}</p>
            <p className="mt-1 text-sm">{t(m.label)}</p>
            <p className="text-xs text-primary-foreground/65">{t(m.hint)}</p>
          </div>
        ))}
      </div>
      <p className="mx-auto mt-10 flex max-w-6xl items-center gap-2 px-6 text-xs text-primary-foreground/65">
        <Lock className="h-3.5 w-3.5" /> {t("Bank details are stored on your device in this demo — no data leaves the browser.")}
      </p>
    </section>
  );
}

export function FaqSection() {
  const { t } = useI18n();
  const faqs = getFaqs();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-20">
      <p className="eyebrow text-center">{t("Questions")}</p>
      <h2 className="mt-3 text-center font-serif text-4xl md:text-5xl">{t("Good to know.")}</h2>
      <div className="mt-10 space-y-3">
        {faqs.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q} className="rounded-3xl border border-border bg-card">
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
              >
                <span className="font-medium">{t(f.q)}</span>
                <ChevronDown
                  className={cn("h-4 w-4 shrink-0 transition-transform", isOpen && "rotate-180")}
                />
              </button>
              {isOpen ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">{t(f.a)}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

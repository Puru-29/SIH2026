import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { BadgeCheck, Info, MapPin, Plus, Send } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useCreateOffer, useOffers } from "@/hooks/use-offers";
import { useMatchingBuyers } from "@/hooks/use-lots";
import { pickHeroLot, useMyLots } from "@/hooks/use-my-lots";
import { toast } from "sonner";
import {
  ErrorNote,
  FormActions,
  Input,
  Loading,
  Modal,
  priceHint,
  shortDate,
} from "@/components/fpo/fpo-ui";
import { LotDealsModal, MessageLink, OfferActions } from "@/components/agri/deal-ui";
import { inrAmount, inrKg, inrQ, qtl } from "@/lib/deal-format";
import type { BackendBuyerDemand } from "@/services/api-client";

/** Accepts "LOT-12" (from My Crops) or a bare id. */
const lotNumber = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/^LOT-/i, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export const Route = createFileRoute("/buyers")({
  validateSearch: (search: Record<string, unknown>): { lot?: string } =>
    lotNumber(search["lot"]) ? { lot: String(search["lot"]) } : {},
  head: () => ({
    meta: [
      { title: "Buyers — AgriSense" },
      {
        name: "description",
        content: "Buyers who want your crop, ranked by price, freight, trust and quality match.",
      },
      { property: "og:title", content: "Buyers — AgriSense" },
      {
        property: "og:description",
        content: "Discover processors, exporters and retail chains buying your crop.",
      },
    ],
  }),
  component: Buyers,
});

const SORTS = [
  { key: "score", label: "Best match" },
  { key: "net", label: "Net earning" },
  { key: "price", label: "Highest price" },
] as const;

function Buyers() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("score");
  const { lots, openLots, isLoading: lotsLoading } = useMyLots();
  const fromUrl = lotNumber(search.lot);
  const [chosen, setChosen] = useState<number | undefined>(fromUrl);
  const lot =
    openLots.find((l) => l.backendId === (chosen ?? fromUrl)) ?? pickHeroLot(lots) ?? undefined;
  const buyers = useMatchingBuyers(lot?.backendId);
  const { data: offers = [] } = useOffers();
  const createOffer = useCreateOffer();
  const [offerTo, setOfferTo] = useState<BackendBuyerDemand | null>(null);
  const [price, setPrice] = useState("");
  const [dealsLot, setDealsLot] = useState<number | null>(null);

  const list = [...(buyers.data ?? [])].sort((a, b) =>
    sort === "net"
      ? (b.net_price_per_quintal ?? b.max_price) - (a.net_price_per_quintal ?? a.max_price)
      : sort === "price"
        ? b.max_price - a.max_price
        : (b.score ?? 0) - (a.score ?? 0),
  );
  const sentTo = new Set(
    offers
      .filter((o) => o.lot_id === lot?.backendId && o.status === "pending")
      .map((o) => o.buyer_id),
  );
  const waiting = offers.filter((o) => o.status === "pending");

  function openOffer(b: BackendBuyerDemand) {
    setOfferTo(b);
    setPrice(String(Math.round(b.max_price)));
  }

  function sendOffer(e: FormEvent) {
    e.preventDefault();
    if (!lot?.backendId || !offerTo) return;
    createOffer.mutate(
      { lot_id: lot.backendId, buyer_id: offerTo.buyer_id, price_offered: Number(price) },
      {
        onSuccess: () => {
          toast.success(t("Offer sent"), {
            description: `${inrQ(Number(price))} — ${t("waiting for the buyer to reply.")}`,
          });
          setOfferTo(null);
        },
        onError: (err) => toast.error(t("Could not send offer"), { description: err.message }),
      },
    );
  }

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Buyer directory"
        title="Buyers for your crop"
        description="Buyer requirements that match your lot, ranked by price, freight, trust, quality and deadline."
      />

      {lotsLoading ? (
        <Loading />
      ) : openLots.length === 0 ? (
        <Panel className="flex flex-col items-start gap-3">
          <p className="font-serif text-2xl">
            {t("You have no open lots yet — add your first lot")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("Buyers are matched to a lot by crop, quantity and quality.")}
          </p>
          <Link
            to="/crops"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
          >
            <Plus className="h-4 w-4" /> {t("Register lot")}
          </Link>
        </Panel>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("Lot")}:</span>
            {openLots.map((l) => (
              <button
                key={l.id}
                onClick={() => setChosen(l.backendId)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm",
                  lot?.id === l.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                {l.emoji} {t(l.crop)} · {l.id}
              </button>
            ))}
          </div>

          {lot && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Metric
                label="Matching requirements"
                value={buyers.data?.length ?? "…"}
                hint={`${t(lot.crop)} · ${lot.grade}`}
              />
              <Metric
                label="Your lot"
                value={qtl(lot.quantityQuintals ?? 0)}
                hint={`${lot.pendingOffers ?? 0} ${t("offers waiting")}`}
              />
              <Metric
                label="Highest price"
                value={list.length ? inrKg(Math.max(...list.map((b) => b.max_price))) : "—"}
                hint={t("Delivered price asked by the buyer")}
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm",
                  sort === s.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                {t("Sort")}: {t(s.label)}
              </button>
            ))}
          </div>

          <ErrorNote error={buyers.error} />
          {buyers.isLoading ? (
            <Loading label="Finding buyers…" />
          ) : list.length === 0 ? (
            <Panel>
              <p className="text-sm text-muted-foreground">
                {t("No open buyer requirement for")} {t(lot?.crop ?? "")}{" "}
                {t("right now. You will get a notification when a buyer posts one.")}
              </p>
            </Panel>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              {list.map((b) => (
                <Panel key={b.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-1.5 font-serif text-xl">
                        {b.buyer_name ?? `Buyer #${b.buyer_id}`}
                        {b.verified && <BadgeCheck className="h-4 w-4 text-primary" />}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5" /> {b.delivery_location} ·{" "}
                        {b.required_quality}
                        {b.trust_score !== undefined &&
                          ` · ${t("trust")} ${b.trust_score.toFixed(1)}/5`}
                      </p>
                    </div>
                    {b.score !== undefined && (
                      <Pill tone="green">
                        {Math.round(b.score)}/100 {t("match")}
                      </Pill>
                    )}
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                    {(
                      [
                        ["Buyer price", inrKg(b.max_price)],
                        ["Wants", qtl(b.min_quantity)],
                        [
                          "Freight",
                          b.freight_per_quintal != null
                            ? inrKg(b.freight_per_quintal)
                            : t("Not known"),
                        ],
                        [
                          "You keep",
                          b.net_price_per_quintal
                            ? inrAmount(b.net_price_per_quintal * (lot?.quantityQuintals ?? 0))
                            : "—",
                        ],
                      ] as const
                    ).map(([l, v]) => (
                      <div key={l}>
                        <p className="text-xs text-muted-foreground">{t(l)}</p>
                        <p className="mt-0.5">{v}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {t("Needed by")} {shortDate(b.required_by)}
                    {b.reasons?.length ? ` · ${b.reasons.join(" · ")}` : ""}
                  </p>

                  <div className="mt-5 flex flex-wrap gap-3">
                    {sentTo.has(b.buyer_id) ? (
                      <Pill tone="amber">{t("Offer sent — waiting for reply")}</Pill>
                    ) : (
                      <button
                        onClick={() => openOffer(b)}
                        className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground"
                      >
                        <Send className="h-4 w-4" /> {t("Send offer")}
                      </button>
                    )}
                    <MessageLink userId={b.buyer_id} label="Message buyer" />
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </>
      )}

      <Panel>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl">{t("Offers on your lots")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("Accept, counter or decline. Accepting creates an order for both sides.")}
            </p>
          </div>
          <Pill>
            {waiting.length} {t("open")}
          </Pill>
        </div>
        <div className="mt-5 space-y-3">
          {waiting.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("No open offers right now.")}</p>
          ) : (
            waiting.map((offer) => (
              <div
                key={offer.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4"
              >
                <div>
                  <p className="font-medium">
                    {t(offer.crop_name ?? "Lot")} · LOT-{offer.lot_id} · {offer.buyer_name}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {offer.created_by_role === "buyer"
                      ? offer.parent_offer_id
                        ? t("Buyer countered")
                        : t("Buyer offered")
                      : t("You offered")}{" "}
                    {inrQ(offer.price_offered)} ({inrKg(offer.price_offered)}) ·{" "}
                    <button
                      className="text-primary underline-offset-4 hover:underline"
                      onClick={() => setDealsLot(offer.lot_id)}
                    >
                      {t("History")}
                    </button>
                  </p>
                </div>
                <OfferActions offer={offer} myRole="farmer" compact />
              </div>
            ))
          )}
        </div>
      </Panel>

      <Modal
        open={offerTo !== null}
        onClose={() => setOfferTo(null)}
        title={`${t("Send offer to")} ${offerTo?.buyer_name ?? ""}`}
        subtitle={
          lot ? `${t(lot.crop)} · ${lot.id} · ${qtl(lot.quantityQuintals ?? 0)}` : undefined
        }
      >
        <form onSubmit={sendOffer} className="space-y-3">
          <Input
            label="Your price (₹ per quintal)"
            type="number"
            min={1}
            step="any"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            hint={priceHint(price) || (Number(price) > 0 ? inrKg(Number(price)) : undefined)}
          />
          {offerTo && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("This buyer pays up to")} {inrQ(offerTo.max_price)} {t("delivered to")}{" "}
              {offerTo.delivery_location}.
            </p>
          )}
          <FormActions
            onCancel={() => setOfferTo(null)}
            submitLabel="Send offer"
            busy={createOffer.isPending}
          />
        </form>
      </Modal>

      <LotDealsModal lotId={dealsLot} onClose={() => setDealsLot(null)} myRole="farmer" />
    </PortalLayout>
  );
}

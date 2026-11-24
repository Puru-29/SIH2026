/**
 * Buyer-side panel: FPO bulk lots open for offers, plus the buyer's own
 * negotiations with FPOs. Used on the buyer's Browse Produce page.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ContactCard } from "@/components/agri/trust-ui";
import { verificationApi } from "@/services/verification-api";
import { toast } from "sonner";
import { Handshake, Layers } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fpoApi, type FpoLot, type RespondInput } from "@/services/fpo-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import { cropEmoji } from "@/lib/crop-catalog";
import { OfferCard } from "./offer-ui";
import {
  Badge,
  Btn,
  Empty,
  ErrorNote,
  FormActions,
  GradeBadge,
  Input,
  Loading,
  Modal,
  priceHint,
  quintals,
  shortDate,
  TextArea,
  tonnes,
  VerifiedBadge,
} from "./fpo-ui";

export function BuyerFpoMarket() {
  const { t } = useI18n();
  const lots = useFpoQuery(["market-lots"], fpoApi.marketLots);
  const offers = useFpoQuery(["buyer-offers"], fpoApi.buyerOffers);
  const [offering, setOffering] = useState<FpoLot | null>(null);
  const respond = useFpoMutation(
    ({ id, body }: { id: number; body: RespondInput }) => fpoApi.buyerRespond(id, body),
    {
      onSuccess: (r) =>
        toast.success(
          r.status === "accepted"
            ? t("Deal confirmed. The FPO will arrange delivery.")
            : r.status === "rejected"
              ? t("Offer rejected")
              : t("Counter offer sent to FPO"),
        ),
    },
  );
  const openOffers = offers.data?.filter((o) => o.status === "open") ?? [];
  const myTurn = openOffers.filter((o) => o.awaiting === "buyer").length;

  return (
    <section className="fpo-portal space-y-5 rounded-[1.75rem] border border-border p-5 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-primary">
            <Layers className="h-4 w-4" /> {t("FPO bulk lots")}
          </p>
          <h2 className="mt-1 font-serif text-2xl">
            {t("Buy in bulk from Farmer Producer Organisations")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("Consistent volumes pooled from many farmers, with quality grade and Lot ID.")}
          </p>
        </div>
        {myTurn > 0 && <Badge label={`${myTurn} ${t("offers need your reply")}`} tone="amber" />}
      </div>
      <ErrorNote error={lots.error ?? offers.error} />
      {lots.isLoading ? (
        <Loading />
      ) : !lots.data?.length ? (
        <Empty icon={<Layers className="h-6 w-6" />} title="No FPO lots open right now" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {lots.data.map((l) => {
            const mine = openOffers.find((o) => o.lot_id === l.id);
            return (
              <div key={l.id} className="fpo-card p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-serif text-xl">
                      {cropEmoji(l.crop_name)} {t(l.crop_name)}{" "}
                      {l.variety && (
                        <span className="text-base text-muted-foreground">· {l.variety}</span>
                      )}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">{l.lot_code}</p>
                  </div>
                  <GradeBadge grade={l.grade} />
                </div>
                <p className="mt-3 font-serif text-3xl tabular-nums">
                  {tonnes(l.available_quintals)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {quintals(l.available_quintals)} {t("available")} · {l.contributor_count}{" "}
                  {t("farmers")}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{l.fpo_name}</span>
                  <VerifiedBadge verified={l.fpo_verified} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {[l.fpo_district, l.fpo_state].filter(Boolean).join(", ")}
                </p>
                {l.last_inspected_on && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("Quality checked")} {shortDate(l.last_inspected_on)}
                    {l.last_moisture_pct !== null
                      ? ` · ${t("moisture")} ${l.last_moisture_pct}%`
                      : ""}
                  </p>
                )}
                <Btn
                  className="mt-4 w-full"
                  disabled={Boolean(mine)}
                  icon={<Handshake className="h-4 w-4" />}
                  onClick={() => setOffering(l)}
                >
                  {mine ? t("Offer in progress") : t("Make offer")}
                </Btn>
              </div>
            );
          })}
        </div>
      )}
      {(offers.data?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <h3 className="font-serif text-xl">{t("My offers to FPOs")}</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            {offers.data!.map((o) => (
              <OfferCard
                key={o.id}
                offer={o}
                side="buyer"
                busy={respond.isPending}
                respond={(id, body) => respond.mutate({ id, body })}
              />
            ))}
          </div>
        </div>
      )}
      {offering && <MakeOfferModal lot={offering} onClose={() => setOffering(null)} />}
      {(offers.data ?? []).some((o) => o.status === "accepted") && (
        <div className="space-y-3">
          <h3 className="font-medium">{t("Confirmed FPO deals — contact")}</h3>
          {(offers.data ?? [])
            .filter((o) => o.status === "accepted")
            .map((o) => (
              <FpoDealContact key={o.id} offerId={o.id} />
            ))}
        </div>
      )}
    </section>
  );
}

function MakeOfferModal({ lot, onClose }: { lot: FpoLot; onClose: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({
    qty: String(lot.available_quintals),
    price: "",
    terms: "",
    note: "",
  });
  const save = useFpoMutation(
    () =>
      fpoApi.buyerCreateOffer({
        lot_id: lot.id,
        quantity_quintals: Number(f.qty),
        price_per_quintal: Number(f.price),
        payment_terms: f.terms,
        note: f.note,
      }),
    { success: "Offer sent to the FPO", onSuccess: onClose },
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={`${t("Make offer")} · ${lot.lot_code}`}
      subtitle={`${quintals(lot.available_quintals)} ${t(lot.crop_name)} ${t("available")} · ${lot.fpo_name}`}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="bo-qty"
            label="Quantity (quintals)"
            type="number"
            min={0.01}
            step="0.01"
            max={lot.available_quintals}
            required
            value={f.qty}
            onChange={(e) => setF({ ...f, qty: e.target.value })}
          />
          <Input
            id="bo-price"
            label="Your price (₹ per quintal)"
            type="number"
            min={1}
            required
            value={f.price}
            onChange={(e) => setF({ ...f, price: e.target.value })}
            hint={priceHint(f.price)}
          />
        </div>
        <Input
          id="bo-terms"
          label="Payment terms"
          value={f.terms}
          onChange={(e) => setF({ ...f, terms: e.target.value })}
          placeholder="e.g. 30% advance, rest on delivery"
        />
        <TextArea
          id="bo-note"
          label="Message (optional)"
          value={f.note}
          onChange={(e) => setF({ ...f, note: e.target.value })}
        />
        <FormActions onCancel={onClose} submitLabel="Send offer" busy={save.isPending} />
      </form>
    </Modal>
  );
}

function FpoDealContact({ offerId }: { offerId: number }) {
  const q = useQuery({
    queryKey: ["fpo-offer-contact", offerId],
    queryFn: () => verificationApi.fpoOfferContact(offerId),
    staleTime: 5 * 60_000,
  });
  return <ContactCard contact={q.data} />;
}

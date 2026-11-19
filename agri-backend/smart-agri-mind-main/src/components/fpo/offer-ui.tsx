import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, Check, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { fpoApi, type BuyerProfile, type FpoOffer, type RespondInput } from "@/services/fpo-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import {
  Badge,
  Btn,
  ConfirmButton,
  Empty,
  ErrorNote,
  FormActions,
  GradeBadge,
  Input,
  Loading,
  Modal,
  priceHint,
  quintals,
  rupees,
  Select,
  shortDate,
  TextArea,
  VerifiedBadge,
} from "./fpo-ui";

/** One offer with its negotiation history and the actions available to `side`. */
export function OfferCard({
  offer,
  side,
  respond,
  busy,
}: {
  offer: FpoOffer;
  side: "fpo" | "buyer";
  respond: (id: number, body: RespondInput) => void;
  busy?: boolean | undefined;
}) {
  const { t } = useI18n();
  const [countering, setCountering] = useState(false);
  const myTurn = offer.status === "open" && offer.awaiting === side;
  const other = side === "fpo" ? offer.buyer_name : offer.fpo_name;
  const total = offer.quantity_quintals * offer.price_per_quintal;

  return (
    <div className={cn("fpo-card p-5", myTurn && "ring-2 ring-[var(--fpo-gold)]")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-semibold">{other}</p>
            <VerifiedBadge verified={side === "fpo" ? offer.buyer_verified : offer.fpo_verified} />
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{offer.lot_code}</span> · {t(offer.crop_name)} ·{" "}
            <GradeBadge grade={offer.grade} />
          </p>
        </div>
        {offer.status === "open" ? (
          <Badge
            label={
              myTurn
                ? "Your reply needed"
                : side === "fpo"
                  ? "Waiting for buyer"
                  : "Waiting for FPO"
            }
            tone={myTurn ? "amber" : "gray"}
          />
        ) : (
          <Badge status={offer.status} />
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 rounded-2xl bg-secondary p-4">
        <div>
          <p className="text-xs text-muted-foreground">{t("Price")}</p>
          <p className="font-serif text-2xl tabular-nums">
            {rupees(offer.price_per_quintal)}
            <span className="text-sm">/q</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("Quantity")}</p>
          <p className="font-serif text-2xl tabular-nums">{quintals(offer.quantity_quintals)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t("Total value")}</p>
          <p className="font-serif text-2xl tabular-nums">{rupees(total)}</p>
        </div>
      </div>
      {offer.payment_terms && (
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">{t("Payment terms")}:</span> {offer.payment_terms}
        </p>
      )}

      {offer.events.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-primary">
            {t("Negotiation history")} ({offer.events.length})
          </summary>
          <ol className="mt-2 space-y-1.5 border-l-2 border-accent pl-4">
            {offer.events.map((e) => (
              <li key={e.id}>
                <span className="font-medium">
                  {e.actor_role === "fpo" ? t("FPO") : t("Buyer")}
                </span>{" "}
                {t(e.action)} ·{" "}
                <span className="tabular-nums">
                  {rupees(e.price_per_quintal)}/q × {quintals(e.quantity_quintals)}
                </span>
                {e.note && <span className="text-muted-foreground"> — “{e.note}”</span>}
                <span className="block text-xs text-muted-foreground">
                  {shortDate(e.created_at)}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {myTurn && (
        <div className="mt-4 flex flex-wrap gap-2.5">
          <ConfirmButton
            label="Accept Offer"
            icon={<Check className="h-4 w-4" />}
            busy={busy}
            confirmTitle="Accept this offer?"
            confirmBody={`${quintals(offer.quantity_quintals)} at ${rupees(offer.price_per_quintal)}/q = ${rupees(total)}. The quantity will be reserved for this buyer and cannot be sold to anyone else.`}
            onConfirm={() => respond(offer.id, { action: "accept" })}
          />
          <Btn
            variant="outline"
            icon={<ArrowLeftRight className="h-4 w-4" />}
            onClick={() => setCountering(true)}
          >
            {t("Counter offer")}
          </Btn>
          <ConfirmButton
            label="Reject"
            variant="danger"
            icon={<X className="h-4 w-4" />}
            confirmTitle="Reject this offer?"
            confirmBody="The negotiation will close. You can still receive new offers."
            onConfirm={() => respond(offer.id, { action: "reject" })}
          />
        </div>
      )}
      {offer.status === "open" && !myTurn && offer.lot_available < offer.quantity_quintals && (
        <p className="mt-3 text-sm text-[var(--fpo-warn)]">
          {t("Only")} {quintals(offer.lot_available)} {t("is still available in this lot.")}
        </p>
      )}

      {countering && (
        <CounterModal
          offer={offer}
          onClose={() => setCountering(false)}
          onSubmit={(b) => {
            respond(offer.id, b);
            setCountering(false);
          }}
        />
      )}
    </div>
  );
}

function CounterModal({
  offer,
  onClose,
  onSubmit,
}: {
  offer: FpoOffer;
  onClose: () => void;
  onSubmit: (b: RespondInput) => void;
}) {
  const [price, setPrice] = useState(String(offer.price_per_quintal));
  const [qty, setQty] = useState(String(offer.quantity_quintals));
  const [terms, setTerms] = useState(offer.payment_terms);
  const [note, setNote] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      title="Counter offer"
      subtitle={`${offer.lot_code} · ${offer.crop_name}`}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            action: "counter",
            price_per_quintal: Number(price),
            quantity_quintals: Number(qty),
            payment_terms: terms,
            note,
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="ctr-price"
            label="Your price (₹ per quintal)"
            type="number"
            min={1}
            step="1"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            hint={priceHint(price)}
          />
          <Input
            id="ctr-qty"
            label="Quantity (quintals)"
            type="number"
            min={0.01}
            step="0.01"
            max={Math.max(offer.lot_available, offer.quantity_quintals)}
            required
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            hint={`Available: ${quintals(offer.lot_available)}`}
          />
        </div>
        <p className="rounded-xl bg-secondary px-4 py-3 text-base">
          = <strong>{rupees(Number(price) * Number(qty))}</strong>
        </p>
        <Input
          id="ctr-terms"
          label="Payment terms"
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          placeholder="e.g. 30% advance, rest on delivery"
        />
        <TextArea
          id="ctr-note"
          label="Message (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <FormActions onCancel={onClose} submitLabel="Send counter offer" />
      </form>
    </Modal>
  );
}

/** FPO sends its own offer to a buyer for a lot. */
export function SendOfferModal({
  lotId,
  buyerId,
  suggestedPrice,
  onClose,
}: {
  lotId?: number | undefined;
  buyerId?: number | undefined;
  suggestedPrice?: number | undefined;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const lots = useFpoQuery(["lots"], fpoApi.lots);
  const buyers = useFpoQuery(["buyers"], fpoApi.buyers);
  const [form, setForm] = useState({
    lot_id: lotId ? String(lotId) : "",
    buyer_id: buyerId ? String(buyerId) : "",
    quantity: "",
    price: suggestedPrice ? String(Math.round(suggestedPrice)) : "",
    terms: "",
    note: "",
  });
  const sellable = lots.data?.filter((l) => l.available_quintals > 0) ?? [];
  const lot = sellable.find((l) => l.id === Number(form.lot_id));
  const buyer = buyers.data?.find((b) => b.id === Number(form.buyer_id));
  const send = useFpoMutation(
    () =>
      fpoApi.createOffer({
        lot_id: Number(form.lot_id),
        buyer_id: Number(form.buyer_id),
        quantity_quintals: Number(form.quantity),
        price_per_quintal: Number(form.price),
        payment_terms: form.terms,
        note: form.note,
      }),
    { success: "Offer sent to buyer", onSuccess: onClose },
  );
  return (
    <Modal
      open
      onClose={onClose}
      title="Send offer to buyer"
      subtitle="The buyer can accept, reject or reply with a counter offer."
    >
      <ErrorNote error={lots.error ?? buyers.error} />
      {lots.isLoading ? (
        <Loading />
      ) : sellable.length === 0 ? (
        <Empty
          title="No lot available to sell yet"
          body="Offers are made on a bulk lot. Add your farmers' crop, approve it, then combine it into a lot. Lots that are fully reserved or sold are not shown."
          action={
            <Link
              to="/fpo/aggregation"
              onClick={onClose}
              className="inline-flex min-h-11 items-center rounded-xl bg-primary px-5 font-medium text-primary-foreground"
            >
              {t("Combine Crops")}
            </Link>
          }
        />
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate(undefined);
          }}
        >
          <Select
            id="so-lot"
            label="Lot"
            required
            value={form.lot_id}
            onChange={(e) => setForm({ ...form, lot_id: e.target.value })}
          >
            <option value="">{t("Choose lot")}</option>
            {sellable.map((l) => (
              <option key={l.id} value={l.id}>
                {l.lot_code} · {t(l.crop_name)} · {quintals(l.available_quintals)} {t("available")}
              </option>
            ))}
          </Select>
          <Select
            id="so-buyer"
            label="Buyer"
            required
            value={form.buyer_id}
            onChange={(e) => setForm({ ...form, buyer_id: e.target.value })}
          >
            <option value="">{t("Choose buyer")}</option>
            {buyers.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} {b.verified ? "✓" : `(${t("not verified")})`}
              </option>
            ))}
          </Select>
          {buyer && !buyer.verified && (
            <p className="rounded-xl bg-[var(--fpo-warn-soft)] px-4 py-3 text-sm text-[var(--fpo-warn)]">
              {t(
                "This buyer is not verified by AgriSense. Ask for an advance payment before dispatch.",
              )}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="so-qty"
              label="Quantity (quintals)"
              type="number"
              min={0.01}
              step="0.01"
              max={lot?.available_quintals}
              required
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              hint={lot ? `Available: ${quintals(lot.available_quintals)}` : undefined}
            />
            <Input
              id="so-price"
              label="Price (₹ per quintal)"
              type="number"
              min={1}
              required
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              hint={priceHint(form.price)}
            />
          </div>
          <Input
            id="so-terms"
            label="Payment terms"
            value={form.terms}
            onChange={(e) => setForm({ ...form, terms: e.target.value })}
            placeholder="e.g. 30% advance, rest on delivery"
          />
          <TextArea
            id="so-note"
            label="Message (optional)"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
          <FormActions onCancel={onClose} submitLabel="Send offer" busy={send.isPending} />
        </form>
      )}
    </Modal>
  );
}

export function TrustLine({ b }: { b: Pick<BuyerProfile, "trust" | "deals"> }) {
  const { t } = useI18n();
  return (
    <div className="text-sm">
      {b.trust.score === null ? (
        <p className="text-muted-foreground">{t(b.trust.basis)}</p>
      ) : (
        <p>
          <span className="font-serif text-2xl tabular-nums">{b.trust.score}</span>
          <span className="text-muted-foreground">/100 {t("trust score")}</span>
          <span className="block text-xs text-muted-foreground">
            {b.trust.paid_in_full_pct}% {t("paid in full")} · {b.trust.dispute_count}{" "}
            {t("disputes")} · {b.trust.basis}
          </span>
        </p>
      )}
    </div>
  );
}

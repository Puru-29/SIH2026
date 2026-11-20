/**
 * Shared pieces for farmer–buyer deals: offer status, accept / counter /
 * decline actions, the negotiation history of a lot, and a "Message" link.
 * Prices on the API are ₹ per quintal; the portals show ₹ per kg next to them.
 */

import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, MessageSquare, Repeat, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/agri/ui-bits";
import {
  Btn,
  ErrorNote,
  FormActions,
  Input,
  Loading,
  Modal,
  priceHint,
  shortDate,
} from "@/components/fpo/fpo-ui";
import { useAcceptOffer } from "@/hooks/use-offers";
import {
  useCounterOffer,
  useLotDetail,
  useRejectOffer,
  useWithdrawOffer,
} from "@/hooks/use-market";
import type { BackendOffer, LotDisplayStatus } from "@/services/api-client";
import { inrKg, inrQ, ORDER_LABEL, PAYMENT_LABEL, qtl } from "@/lib/deal-format";

/* -------------------------------- formatting ------------------------------- */

/* --------------------------------- statuses -------------------------------- */

const OFFER_TONE: Record<string, "green" | "amber" | "slate" | "clay" | "muted" | "solid"> = {
  pending: "amber",
  accepted: "green",
  countered: "slate",
  rejected: "clay",
  cancelled: "muted",
};

const OFFER_LABEL: Record<string, string> = {
  pending: "Waiting for reply",
  accepted: "Accepted",
  countered: "Countered",
  rejected: "Declined",
  cancelled: "Withdrawn",
};

export function OfferStatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  return <Pill tone={OFFER_TONE[status] ?? "muted"}>{t(OFFER_LABEL[status] ?? status)}</Pill>;
}

const LOT_TONE: Record<LotDisplayStatus, "green" | "amber" | "slate" | "clay" | "muted"> = {
  open: "green",
  offer_received: "amber",
  sold: "slate",
  withdrawn: "muted",
  cancelled: "clay",
};

const LOT_LABEL: Record<LotDisplayStatus, string> = {
  open: "Open",
  offer_received: "Offer received",
  sold: "Sold",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled by admin",
};

export function LotStatusPill({ status }: { status: LotDisplayStatus | undefined }) {
  const { t } = useI18n();
  const s = status ?? "open";
  return <Pill tone={LOT_TONE[s]}>{t(LOT_LABEL[s])}</Pill>;
}

export function OrderStatusPill({ status }: { status: string | undefined }) {
  const { t } = useI18n();
  const s = status ?? "accepted";
  const tone = s === "delivered" ? "green" : s === "accepted" ? "amber" : "slate";
  return <Pill tone={tone}>{t(ORDER_LABEL[s] ?? s)}</Pill>;
}

export function PaymentStatusPill({ status }: { status: string | undefined }) {
  const { t } = useI18n();
  const s = status ?? "pending";
  const tone =
    s === "paid"
      ? "green"
      : s === "awaiting_confirmation"
        ? "amber"
        : s === "partially_paid"
          ? "slate"
          : "clay";
  return <Pill tone={tone}>{t(PAYMENT_LABEL[s] ?? s)}</Pill>;
}

/* ---------------------------------- message -------------------------------- */

export function MessageLink({
  userId,
  label = "Message",
  className,
}: {
  userId: number;
  label?: string;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <Link
      to="/messages"
      search={{ with: String(userId) } as never}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm hover:bg-secondary",
        className,
      )}
    >
      <MessageSquare className="h-4 w-4" /> {t(label)}
    </Link>
  );
}

/* ------------------------------- offer actions ----------------------------- */

/**
 * What I can do with an offer: answer it (accept, counter, decline) when the
 * other side made it, or withdraw it while it is mine and still pending.
 */
export function OfferActions({
  offer,
  myRole,
  compact,
}: {
  offer: BackendOffer;
  myRole: "farmer" | "buyer";
  compact?: boolean;
}) {
  const { t } = useI18n();
  const accept = useAcceptOffer();
  const reject = useRejectOffer();
  const withdraw = useWithdrawOffer();
  const counter = useCounterOffer();
  const [mode, setMode] = useState<"counter" | "decline" | null>(null);
  const [price, setPrice] = useState(String(Math.round(offer.price_offered)));
  const [reason, setReason] = useState("");

  if (offer.status !== "pending") return <OfferStatusPill status={offer.status} />;

  const mine = offer.created_by_role === myRole;
  const size = compact ? "sm" : "md";

  if (mine) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <OfferStatusPill status="pending" />
        <Btn
          size="sm"
          variant="ghost"
          busy={withdraw.isPending}
          onClick={() =>
            withdraw.mutate(offer.id, {
              onSuccess: () => toast.success(t("Offer withdrawn")),
              onError: (e) => toast.error(t("Could not withdraw"), { description: e.message }),
            })
          }
        >
          {t("Withdraw")}
        </Btn>
      </div>
    );
  }

  const submitCounter = (e: FormEvent) => {
    e.preventDefault();
    counter.mutate(
      { offerId: offer.id, price: Number(price) },
      {
        onSuccess: () => {
          toast.success(t("Counter offer sent"));
          setMode(null);
        },
        onError: (err) =>
          toast.error(t("Could not send counter offer"), { description: err.message }),
      },
    );
  };

  const submitDecline = (e: FormEvent) => {
    e.preventDefault();
    reject.mutate(
      { offerId: offer.id, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      {
        onSuccess: () => {
          toast.success(t("Offer declined"));
          setMode(null);
        },
        onError: (err) => toast.error(t("Could not decline"), { description: err.message }),
      },
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Btn
        size={size}
        icon={<Check className="h-4 w-4" />}
        busy={accept.isPending}
        onClick={() =>
          accept.mutate(offer.id, {
            onSuccess: () =>
              toast.success(t("Offer accepted"), {
                description: t("The order is now on the Orders page for both sides."),
              }),
            onError: (err) =>
              toast.error(t("Could not accept offer"), { description: err.message }),
          })
        }
      >
        {t("Accept")}
      </Btn>
      <Btn
        size={size}
        variant="outline"
        icon={<Repeat className="h-4 w-4" />}
        onClick={() => setMode("counter")}
      >
        {t("Counter")}
      </Btn>
      <Btn
        size={size}
        variant="ghost"
        icon={<X className="h-4 w-4" />}
        onClick={() => setMode("decline")}
      >
        {t("Decline")}
      </Btn>

      <Modal
        open={mode === "counter"}
        onClose={() => setMode(null)}
        title={t("Counter offer")}
        subtitle={`${t("They offered")} ${inrQ(offer.price_offered)} (${inrKg(offer.price_offered)})`}
      >
        <form onSubmit={submitCounter}>
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
          <FormActions
            onCancel={() => setMode(null)}
            submitLabel="Send counter offer"
            busy={counter.isPending}
          />
        </form>
      </Modal>

      <Modal open={mode === "decline"} onClose={() => setMode(null)} title={t("Decline offer")}>
        <form onSubmit={submitDecline}>
          <Input
            label="Reason (optional)"
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("For example: price is below the mandi rate")}
          />
          <FormActions
            onCancel={() => setMode(null)}
            submitLabel="Decline offer"
            busy={reject.isPending}
          />
        </form>
      </Modal>
    </div>
  );
}

/* ---------------------------- negotiation history -------------------------- */

/** Offers on one lot, grouped by buyer, oldest first, with the counter chain. */
export function NegotiationHistory({
  offers,
  myRole,
}: {
  offers: BackendOffer[];
  myRole: "farmer" | "buyer";
}) {
  const { t } = useI18n();
  if (offers.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("No offers on this lot yet.")}</p>;
  }
  const byBuyer = new Map<number, BackendOffer[]>();
  for (const o of offers) byBuyer.set(o.buyer_id, [...(byBuyer.get(o.buyer_id) ?? []), o]);
  return (
    <div className="space-y-4">
      {[...byBuyer.entries()].map(([buyerId, list]) => {
        const sorted = [...list].sort((a, b) => a.id - b.id);
        const latest = sorted[sorted.length - 1]!;
        return (
          <div key={buyerId} className="rounded-2xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {myRole === "farmer"
                  ? (latest.buyer_name ?? `Buyer #${buyerId}`)
                  : latest.farmer_name}
              </p>
              <MessageLink
                userId={myRole === "farmer" ? buyerId : (latest.farmer_id ?? 0)}
                className="px-3 py-1.5 text-xs"
              />
            </div>
            <ol className="mt-3 space-y-2 border-l-2 border-border pl-4">
              {sorted.map((o) => {
                const who =
                  o.created_by_role === myRole
                    ? t("You")
                    : o.created_by_role === "buyer"
                      ? t("Buyer")
                      : t("Farmer");
                return (
                  <li key={o.id} className="relative text-sm">
                    <span className="absolute left-[-1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span>
                        {who} {o.parent_offer_id ? t("countered with") : t("offered")}{" "}
                        <strong>{inrQ(o.price_offered)}</strong>{" "}
                        <span className="text-muted-foreground">({inrKg(o.price_offered)})</span>
                      </span>
                      <OfferStatusPill status={o.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {shortDate(o.created_at)}
                      {o.cancel_reason ? ` · ${o.cancel_reason}` : ""}
                    </p>
                  </li>
                );
              })}
            </ol>
            {latest.status === "pending" && (
              <div className="mt-3">
                <OfferActions offer={latest} myRole={myRole} compact />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------- lot detail modal --------------------------- */

export function LotDealsModal({
  lotId,
  onClose,
  myRole,
}: {
  lotId: number | null;
  onClose: () => void;
  myRole: "farmer" | "buyer";
}) {
  const { t } = useI18n();
  const detail = useLotDetail(lotId ?? undefined);
  const lot = detail.data?.lot;
  return (
    <Modal
      open={lotId !== null}
      onClose={onClose}
      wide
      title={lot ? `${t(lot.crop_name ?? "Lot")} · LOT-${lot.id}` : t("Lot")}
      subtitle={lot ? `${qtl(lot.quantity_quintals)} · ${lot.expected_quality}` : undefined}
    >
      {detail.isLoading ? (
        <Loading />
      ) : detail.error ? (
        <ErrorNote error={detail.error} />
      ) : lot ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <LotStatusPill status={lot.display_status} />
            {lot.cancel_reason && (
              <span className="text-sm text-muted-foreground">{lot.cancel_reason}</span>
            )}
          </div>
          <h3 className="font-serif text-xl">{t("Negotiation history")}</h3>
          <NegotiationHistory offers={detail.data?.offers ?? []} myRole={myRole} />
          {lot.status === "sold" && (
            <Link
              to="/orders"
              className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
            >
              {t("Go to the order")} <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

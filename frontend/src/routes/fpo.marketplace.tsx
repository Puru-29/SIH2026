import { createFileRoute } from "@tanstack/react-router";
import { BuyerTrustBadge } from "@/components/agri/trust-ui";
import { useMemo, useState } from "react";
import { Handshake, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { fpoApi, type FpoOffer, type RespondInput } from "@/services/fpo-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import { OfferCard, SendOfferModal, TrustLine } from "@/components/fpo/offer-ui";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorNote,
  Loading,
  PageTitle,
  quintals,
  rupees,
  shortDate,
  Table,
  Tabs,
  VerifiedBadge,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/fpo/marketplace")({
  component: MarketplacePage,
});

type Tab = "reply" | "waiting" | "compare" | "closed" | "buyers";

function MarketplacePage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("reply");
  const [sending, setSending] = useState<{ lotId?: number; buyerId?: number } | null>(null);
  const offers = useFpoQuery(["offers"], fpoApi.offers);
  const buyers = useFpoQuery(["buyers"], fpoApi.buyers);
  const respond = useFpoMutation(
    ({ id, body }: { id: number; body: RespondInput }) => fpoApi.respond(id, body),
    {
      onSuccess: (r) => {
        if (r.status === "accepted")
          toast.success(t("Offer accepted. Stock reserved and sale created."), {
            description: t("Next: arrange transport and track payment."),
          });
        else if (r.status === "rejected") toast.success(t("Offer rejected"));
        else toast.success(t("Counter offer sent to buyer"));
      },
    },
  );

  const list = useMemo(() => offers.data ?? [], [offers.data]);
  const reply = list.filter((o) => o.status === "open" && o.awaiting === "fpo");
  const waiting = list.filter((o) => o.status === "open" && o.awaiting === "buyer");
  const closed = list.filter((o) => o.status !== "open");

  const byLot = useMemo(() => {
    const m = new Map<string, FpoOffer[]>();
    for (const o of list.filter((x) => x.status === "open")) {
      const k = o.lot_code ?? String(o.lot_id);
      m.set(
        k,
        [...(m.get(k) ?? []), o].sort((a, b) => b.price_per_quintal - a.price_per_quintal),
      );
    }
    return [...m.entries()];
  }, [list]);

  const trustOf = (buyerId: number) => buyers.data?.find((b) => b.id === buyerId);
  const doRespond = (id: number, body: RespondInput) => respond.mutate({ id, body });

  return (
    <>
      <PageTitle
        title="Buyer Marketplace"
        subtitle="Offers from buyers on your lots. Compare prices, negotiate and accept the best deal."
        actions={
          <Btn size="lg" icon={<Send className="h-5 w-5" />} onClick={() => setSending({})}>
            {t("Send offer to buyer")}
          </Btn>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: "reply", label: "Your reply needed", count: reply.length },
          { id: "waiting", label: "Waiting for buyer", count: waiting.length },
          { id: "compare", label: "Compare Prices" },
          { id: "closed", label: "Accepted / rejected", count: closed.length },
          { id: "buyers", label: "Buyers", count: buyers.data?.length },
        ]}
      />
      <ErrorNote error={offers.error ?? buyers.error} />
      {offers.isLoading ? (
        <Loading />
      ) : tab === "compare" ? (
        byLot.length === 0 ? (
          <Card>
            <Empty icon={<Handshake className="h-6 w-6" />} title="No open offers to compare" />
          </Card>
        ) : (
          byLot.map(([code, items]) => (
            <Card
              key={code}
              title={`${code} · ${items[0]!.crop_name}`}
              subtitle={`${quintals(items[0]!.lot_available)} ${t("available")} · ${items.length} ${t("open offers")}`}
            >
              <Table
                head={[
                  "Buyer",
                  "Verified",
                  "Trust",
                  "Price",
                  "Quantity",
                  "Total",
                  "Payment terms",
                  "Status",
                ]}
              >
                {items.map((o, i) => {
                  const b = trustOf(o.buyer_id);
                  return (
                    <tr key={o.id} className={i === 0 ? "bg-accent/40" : undefined}>
                      <td className="font-medium">
                        {o.buyer_name} <BuyerTrustBadge buyerId={o.buyer_id} />
                        {i === 0 && (
                          <span className="ml-2">
                            <Badge label="Highest price" tone="green" />
                          </span>
                        )}
                      </td>
                      <td>
                        <VerifiedBadge verified={o.buyer_verified} />
                      </td>
                      <td className="tabular-nums">
                        {b?.trust.score ?? (
                          <span className="text-muted-foreground">{t("No history")}</span>
                        )}
                      </td>
                      <td className="font-semibold tabular-nums">
                        {rupees(o.price_per_quintal)}/q
                      </td>
                      <td className="tabular-nums">{quintals(o.quantity_quintals)}</td>
                      <td className="tabular-nums">
                        {rupees(o.price_per_quintal * o.quantity_quintals)}
                      </td>
                      <td className="max-w-56 text-sm">{o.payment_terms || "—"}</td>
                      <td>
                        <Badge
                          label={o.awaiting === "fpo" ? "Your reply needed" : "Waiting for buyer"}
                          tone={o.awaiting === "fpo" ? "amber" : "gray"}
                        />
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          ))
        )
      ) : tab === "buyers" ? (
        buyers.isLoading ? (
          <Loading />
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {buyers.data?.map((b) => (
              <Card key={b.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold">{b.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {b.locations.length ? b.locations.join(", ") : t("Location not shared")}
                    </p>
                  </div>
                  <VerifiedBadge verified={b.verified} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 rounded-2xl bg-secondary p-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">{t("FPO deals")}</p>
                    <p className="font-serif text-xl">{b.deals.fpo}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("Marketplace deals")}</p>
                    <p className="font-serif text-xl">{b.deals.marketplace}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("FPO value")}</p>
                    <p className="font-serif text-xl">{rupees(b.deals.fpo_value)}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-start gap-2">
                  <ShieldCheck className="mt-1 h-4 w-4 text-primary" />
                  <TrustLine b={b} />
                </div>
                {b.usual_payment_terms && (
                  <p className="mt-2 text-sm">
                    <span className="text-muted-foreground">{t("Usual payment terms")}:</span>{" "}
                    {b.usual_payment_terms}
                  </p>
                )}
                <h3 className="mt-4 text-sm font-semibold">{t("Current requirements")}</h3>
                {b.requirements.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("No open requirements.")}</p>
                ) : (
                  <ul className="mt-1 space-y-1.5 text-sm">
                    {b.requirements.map((r) => (
                      <li key={r.id} className="rounded-xl border border-border px-3 py-2">
                        <strong>{t(r.crop_name)}</strong> · {quintals(r.min_quantity)}+ ·{" "}
                        {t("up to")} {rupees(r.max_price)}/q · {r.required_quality}
                        <span className="block text-xs text-muted-foreground">
                          {r.delivery_location} · {t("by")} {shortDate(r.required_by)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <Btn
                  className="mt-4"
                  variant="outline"
                  icon={<Send className="h-4 w-4" />}
                  onClick={() => setSending({ buyerId: b.id })}
                >
                  {t("Send offer")}
                </Btn>
              </Card>
            ))}
          </div>
        )
      ) : (
        (() => {
          const items = tab === "reply" ? reply : tab === "waiting" ? waiting : closed;
          return items.length === 0 ? (
            <Card>
              <Empty
                icon={<Handshake className="h-6 w-6" />}
                title={
                  tab === "reply"
                    ? "No offers need your reply"
                    : tab === "waiting"
                      ? "No offers waiting for buyers"
                      : "No closed offers yet"
                }
                body="Buyers see your available lots in their portal and can send offers. You can also send offers to matching buyers."
              />
            </Card>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              {items.map((o) => (
                <OfferCard
                  key={o.id}
                  offer={o}
                  side="fpo"
                  respond={doRespond}
                  busy={respond.isPending}
                />
              ))}
            </div>
          );
        })()
      )}
      {sending && (
        <SendOfferModal
          lotId={sending.lotId}
          buyerId={sending.buyerId}
          onClose={() => setSending(null)}
        />
      )}
    </>
  );
}

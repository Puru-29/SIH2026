import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ArrowLeft, BadgeCheck, MapPin, Send, Users } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { useI18n } from "@/lib/i18n";
import { useSupplier } from "@/hooks/use-market";
import { useCreateOffer } from "@/hooks/use-offers";
import {
  ErrorNote,
  FormActions,
  Input,
  Loading,
  Modal,
  priceHint,
  shortDate,
} from "@/components/fpo/fpo-ui";
import { MessageLink, OfferStatusPill } from "@/components/agri/deal-ui";
import { inrKg, qtl } from "@/lib/deal-format";
import type { SupplierLot } from "@/services/api-client";

export const Route = createFileRoute("/suppliers_/$kind/$id")({
  head: () => ({ meta: [{ title: "Supplier — AgriSense" }] }),
  component: SupplierPage,
});

function SupplierPage() {
  const { t } = useI18n();
  const { kind, id } = Route.useParams();
  const supplier = useSupplier(kind, Number(id));
  const createOffer = useCreateOffer();
  const [bidOn, setBidOn] = useState<SupplierLot | null>(null);
  const [price, setPrice] = useState("");
  const s = supplier.data?.supplier;
  const lots = supplier.data?.lots ?? [];

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!bidOn) return;
    createOffer.mutate(
      { lot_id: bidOn.id, price_offered: Number(price) },
      {
        onSuccess: () => {
          toast.success(t("Offer sent"), { description: t("The farmer has been notified.") });
          setBidOn(null);
        },
        onError: (err) => toast.error(t("Could not send offer"), { description: err.message }),
      },
    );
  }

  return (
    <PortalLayout roles={["buyer"]}>
      <Link
        to="/suppliers"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {t("All suppliers")}
      </Link>
      <ErrorNote error={supplier.error} />
      {supplier.isLoading ? (
        <Loading />
      ) : s ? (
        <>
          <PageHeader
            eyebrow={s.kind === "fpo" ? "Farmer Producer Organisation" : "Farmer"}
            title={s.name}
            description={s.location || t("Location not set")}
            action={
              <div className="flex flex-wrap items-center gap-2">
                {s.verified && (
                  <Pill tone="green">
                    <BadgeCheck className="h-3.5 w-3.5" />{" "}
                    {s.kind === "fpo" ? t("Verified FPO") : `${t("Member of")} ${s.fpo_name}`}
                  </Pill>
                )}
                <MessageLink userId={s.user_id} />
              </div>
            }
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Open lots" value={s.open_lots} />
            <Metric label="Available" value={qtl(s.open_quantity).split(" (")[0]} />
            <Metric label="Completed deals" value={s.completed_deals} />
            <Metric
              label={s.kind === "fpo" ? "Member farmers" : "Crops"}
              value={s.kind === "fpo" ? (s.members ?? 0) : s.crops.length}
              icon={
                s.kind === "fpo" ? <Users className="h-4 w-4" /> : <MapPin className="h-4 w-4" />
              }
            />
          </div>

          <Panel className="p-0">
            <h2 className="border-b border-border p-6 font-serif text-2xl">{t("Open lots")}</h2>
            {lots.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">{t("No open lots right now.")}</p>
            ) : (
              <ul className="divide-y divide-border">
                {lots.map((l) => (
                  <li
                    key={`${l.kind}-${l.id}`}
                    className="flex flex-wrap items-center justify-between gap-4 p-5"
                  >
                    <div>
                      <p className="font-medium">
                        {t(l.crop)} · {l.code ?? `LOT-${l.id}`}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {qtl(l.quantity_quintals)} · {l.quality} · {t("listed")}{" "}
                        {shortDate(l.listed_at)}
                        {l.best_offer ? ` · ${t("best offer")} ${inrKg(l.best_offer)}` : ""}
                      </p>
                    </div>
                    {l.kind === "farmer" ? (
                      l.my_offer_status === "pending" ? (
                        <OfferStatusPill status="pending" />
                      ) : (
                        <button
                          onClick={() => {
                            setBidOn(l);
                            setPrice(l.best_offer ? String(Math.round(l.best_offer)) : "");
                          }}
                          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground"
                        >
                          <Send className="h-4 w-4" /> {t("Make offer")}
                        </button>
                      )
                    ) : (
                      <Link
                        to="/browse-produce"
                        className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground"
                      >
                        {t("Bid in FPO marketplace")}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      ) : null}

      <Modal
        open={bidOn !== null}
        onClose={() => setBidOn(null)}
        title={`${t("Make offer")} · ${bidOn ? t(bidOn.crop) : ""}`}
        subtitle={bidOn ? `${qtl(bidOn.quantity_quintals)} · ${bidOn.quality}` : undefined}
      >
        <form onSubmit={submit}>
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
            onCancel={() => setBidOn(null)}
            submitLabel="Send offer"
            busy={createOffer.isPending}
          />
        </form>
      </Modal>
    </PortalLayout>
  );
}

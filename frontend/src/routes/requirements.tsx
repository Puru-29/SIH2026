import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { useI18n } from "@/lib/i18n";
import {
  createBuyerDemand,
  deleteBuyerDemand,
  getBuyerDemands,
  type BackendBuyerPrice,
} from "@/services/api-client";
import { useCropOptions, useEnsureCrop } from "@/hooks/use-my-lots";
import { useDemandMatches, useFulfilDemand, useUpdateDemand } from "@/hooks/use-market";
import { useCreateOffer } from "@/hooks/use-offers";
import {
  FormActions,
  Input,
  Loading,
  Modal,
  priceHint,
  Select,
  shortDate,
  today,
} from "@/components/fpo/fpo-ui";
import { LotStatusPill, MessageLink } from "@/components/agri/deal-ui";
import { inrKg, qtl } from "@/lib/deal-format";

export const Route = createFileRoute("/requirements")({
  head: () => ({ meta: [{ title: "My Requirements — AgriSense" }] }),
  component: Requirements,
});

const QUALITIES = ["Grade A", "Grade B", "Grade C", "FAQ"];

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function statusOf(r: BackendBuyerPrice): "open" | "fulfilled" | "expired" {
  if (r.status === "fulfilled") return "fulfilled";
  if (r.status === "open" && r.required_by.slice(0, 10) < today()) return "expired";
  return r.status === "open" ? "open" : "fulfilled";
}

function Requirements() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const {
    data: demands = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["buyer-demands"],
    queryFn: getBuyerDemands,
  });
  const { options: cropOptions } = useCropOptions();
  const ensureCrop = useEnsureCrop();
  const update = useUpdateDemand();
  const fulfil = useFulfilDemand();

  const [showForm, setShowForm] = useState(false);
  const [crop, setCrop] = useState("Wheat");
  const [quantity, setQuantity] = useState("1000");
  const [price, setPrice] = useState("2500");
  const [quality, setQuality] = useState("Grade A");
  const [location, setLocation] = useState("");
  const [requiredBy, setRequiredBy] = useState(inDays(30));
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<BackendBuyerPrice | null>(null);
  const [matchesFor, setMatchesFor] = useState<BackendBuyerPrice | null>(null);

  const open = demands.filter((d) => statusOf(d) === "open");
  const matching = open.reduce((s, d) => s + (d.matching_lots ?? 0), 0);

  async function submitRequirement(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const c = await ensureCrop.mutateAsync(crop);
      await createBuyerDemand({
        crop_id: c.id,
        min_quantity: Number(quantity) / 100,
        max_price: Number(price),
        required_quality: quality,
        delivery_location: location,
        required_by: requiredBy,
      });
      await queryClient.invalidateQueries({ queryKey: ["buyer-demands"] });
      setShowForm(false);
      toast.success(t("Requirement listed"), {
        description: t(
          "Farmers with this crop can now find you, and you will hear about new lots.",
        ),
      });
    } catch (err) {
      toast.error(t("Could not list requirement"), {
        description: err instanceof Error ? err.message : t("Please try again."),
      });
    } finally {
      setSaving(false);
    }
  }

  async function removeRequirement(id: number) {
    if (!window.confirm(t("Remove this requirement permanently?"))) return;
    try {
      await deleteBuyerDemand(id);
      toast.success(t("Requirement removed"));
      await queryClient.invalidateQueries({ queryKey: ["buyer-demands"] });
      await queryClient.invalidateQueries({ queryKey: ["buyer-prices"] });
    } catch (err) {
      toast.error(t("Could not update requirement"), {
        description: err instanceof Error ? err.message : t("Please try again."),
      });
    }
  }

  function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const form = new FormData(e.target as HTMLFormElement);
    update.mutate(
      {
        demandId: editing.id,
        body: {
          min_quantity: Number(form.get("quantity")) / 100,
          max_price: Number(form.get("price")),
          required_quality: String(form.get("quality")),
          delivery_location: String(form.get("location")),
          required_by: String(form.get("by")),
        },
      },
      {
        onSuccess: () => {
          toast.success(t("Requirement updated"));
          setEditing(null);
        },
        onError: (err) =>
          toast.error(t("Could not update requirement"), { description: err.message }),
      },
    );
  }

  return (
    <PortalLayout roles={["buyer"]}>
      <PageHeader
        eyebrow="Buyer procurement"
        title="My requirements"
        description="Tell farmers what you need. Matching lots are counted live, and you are notified when a new one is listed."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Open" value={open.length} hint={t("Accepting offers")} />
        <Metric label="Matching lots" value={matching} hint={t("Open lots of these crops")} />
        <Metric
          label="Fulfilled"
          value={demands.filter((d) => statusOf(d) === "fulfilled").length}
          hint={t("Marked done by you")}
        />
      </div>
      <button
        onClick={() => setShowForm((value) => !value)}
        className="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
      >
        <Plus className="h-4 w-4" /> {t("Create requirement")}
      </button>
      {showForm && (
        <Panel>
          <form onSubmit={submitRequirement} className="grid gap-4 sm:grid-cols-2">
            <Select label="Crop" value={crop} onChange={(e) => setCrop(e.target.value)}>
              {cropOptions.map((c) => (
                <option key={c} value={c}>
                  {t(c)}
                </option>
              ))}
            </Select>
            <Select label="Quality" value={quality} onChange={(e) => setQuality(e.target.value)}>
              {QUALITIES.map((q) => (
                <option key={q} value={q}>
                  {t(q)}
                </option>
              ))}
            </Select>
            <Input
              label="Quantity (kg)"
              type="number"
              min={1}
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <Input
              label="Maximum price (₹ per quintal)"
              type="number"
              min={1}
              required
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              hint={priceHint(price) || (Number(price) > 0 ? inrKg(Number(price)) : undefined)}
            />
            <Input
              label="Delivery location"
              required
              maxLength={100}
              placeholder={t("For example: Azadpur, Delhi")}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
            <Input
              label="Needed by"
              type="date"
              min={today()}
              required
              value={requiredBy}
              onChange={(e) => setRequiredBy(e.target.value)}
            />
            <div className="sm:col-span-2">
              <button
                disabled={saving}
                className="rounded-xl bg-primary px-5 py-3 text-sm text-primary-foreground disabled:opacity-60"
              >
                {saving ? t("Listing...") : t("List requirement")}
              </button>
            </div>
          </form>
        </Panel>
      )}
      <Panel className="p-0">
        {isLoading ? (
          <div className="p-6">
            <Loading />
          </div>
        ) : error ? (
          <p className="p-6 text-sm text-destructive">{error.message}</p>
        ) : demands.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            {t("You have no requirements yet — create your first one so farmers can find you.")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  {[
                    "Crop",
                    "Quality",
                    "Quantity",
                    "Max price",
                    "Location",
                    "Needed by",
                    "Matching lots",
                    "Status",
                    "Actions",
                  ].map((heading) => (
                    <th key={heading} className="px-5 py-3 font-medium">
                      {t(heading)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {demands.map((r) => {
                  const st = statusOf(r);
                  return (
                    <tr key={r.id} className="border-b border-border/60 last:border-0">
                      <td className="px-5 py-4 font-medium">{t(r.crop_name)}</td>
                      <td className="px-5 py-4">{r.quality}</td>
                      <td className="px-5 py-4">{qtl(r.min_quantity_quintals)}</td>
                      <td className="px-5 py-4">{inrKg(r.price_per_quintal)}</td>
                      <td className="px-5 py-4">{r.delivery_location}</td>
                      <td className="px-5 py-4">{shortDate(r.required_by)}</td>
                      <td className="px-5 py-4">
                        {st === "open" && (r.matching_lots ?? 0) > 0 ? (
                          <button
                            onClick={() => setMatchesFor(r)}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {r.matching_lots} {t("view")}
                          </button>
                        ) : (
                          (r.matching_lots ?? 0)
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <Pill
                          tone={st === "open" ? "green" : st === "fulfilled" ? "slate" : "clay"}
                        >
                          {t(st === "open" ? "Open" : st === "fulfilled" ? "Fulfilled" : "Expired")}
                        </Pill>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-3">
                          {r.status === "open" && (
                            <>
                              <button
                                onClick={() => setEditing(r)}
                                className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                              >
                                <Pencil className="h-3.5 w-3.5" /> {t("Edit")}
                              </button>
                              <button
                                onClick={() =>
                                  fulfil.mutate(r.id, {
                                    onSuccess: () => toast.success(t("Marked as fulfilled")),
                                    onError: (err) => toast.error(err.message),
                                  })
                                }
                                className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" /> {t("Fulfilled")}
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => void removeRequirement(r.id)}
                            className="inline-flex items-center gap-1 text-destructive underline-offset-4 hover:underline"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> {t("Remove")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`${t("Edit requirement")} · ${editing ? t(editing.crop_name) : ""}`}
      >
        {editing && (
          <form onSubmit={saveEdit} className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Quantity (kg)"
              name="quantity"
              type="number"
              min={1}
              required
              defaultValue={Math.round(editing.min_quantity_quintals * 100)}
            />
            <Input
              label="Maximum price (₹ per quintal)"
              name="price"
              type="number"
              min={1}
              required
              defaultValue={editing.price_per_quintal}
            />
            <Select label="Quality" name="quality" defaultValue={editing.quality}>
              {[...new Set([editing.quality, ...QUALITIES])].map((q) => (
                <option key={q} value={q}>
                  {t(q)}
                </option>
              ))}
            </Select>
            <Input
              label="Needed by"
              name="by"
              type="date"
              min={today()}
              required
              defaultValue={editing.required_by.slice(0, 10)}
            />
            <div className="sm:col-span-2">
              <Input
                label="Delivery location"
                name="location"
                required
                maxLength={100}
                defaultValue={editing.delivery_location}
              />
            </div>
            <div className="sm:col-span-2">
              <FormActions
                onCancel={() => setEditing(null)}
                submitLabel="Save changes"
                busy={update.isPending}
              />
            </div>
          </form>
        )}
      </Modal>

      <MatchesModal requirement={matchesFor} onClose={() => setMatchesFor(null)} />
    </PortalLayout>
  );
}

function MatchesModal({
  requirement,
  onClose,
}: {
  requirement: BackendBuyerPrice | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const matches = useDemandMatches(requirement?.id);
  const createOffer = useCreateOffer();
  return (
    <Modal
      open={requirement !== null}
      onClose={onClose}
      wide
      title={`${t("Lots matching")} · ${requirement ? t(requirement.crop_name) : ""}`}
      subtitle={
        requirement
          ? `${qtl(requirement.min_quantity_quintals)} · ${requirement.quality} · ${requirement.delivery_location}`
          : undefined
      }
    >
      {matches.isLoading ? (
        <Loading />
      ) : (matches.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("No open lots match right now.")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {(matches.data ?? []).map((m) => (
            <li key={m.lot.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="font-medium">
                  LOT-{m.lot.id} · {m.lot.farmer_name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {qtl(m.lot.quantity_quintals)} · {m.lot.expected_quality} ·{" "}
                  {m.lot.farmer_location}
                  {m.freight_per_quintal != null
                    ? ` · ${t("freight")} ${inrKg(m.freight_per_quintal)}`
                    : ""}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <LotStatusPill status={m.lot.display_status} />
                  {!m.quantity_ok && <Pill tone="amber">{t("Smaller than you need")}</Pill>}
                  {!m.quality_ok && <Pill tone="amber">{t("Lower grade")}</Pill>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {m.lot.my_offer_status === "pending" ? (
                  <Pill tone="amber">{t("Offer sent")}</Pill>
                ) : (
                  <button
                    onClick={() =>
                      requirement &&
                      createOffer.mutate(
                        { lot_id: m.lot.id, price_offered: requirement.price_per_quintal },
                        {
                          onSuccess: () =>
                            toast.success(t("Offer sent"), {
                              description: `${inrKg(requirement.price_per_quintal)} — ${t("your maximum price")}`,
                            }),
                          onError: (err) =>
                            toast.error(t("Could not send offer"), { description: err.message }),
                        },
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground"
                  >
                    <Send className="h-4 w-4" /> {t("Offer my price")}
                  </button>
                )}
                <MessageLink userId={m.lot.farmer_id} label="Message farmer" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

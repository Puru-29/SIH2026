import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { CalendarDays, Gavel, Loader2, MapPin, Pencil, Plus, Search, Undo2 } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { PageHeader, Panel, Pill, StatusTag } from "@/components/agri/ui-bits";
import { useFarmLocation } from "@/lib/location-context";
import { inr, kg, type Lot } from "@/lib/agri";
import { useCreateLot } from "@/hooks/use-lots";
import { useCatalogueCrops, useEnsureCrop, useMyLots } from "@/hooks/use-my-lots";
import { RequestCrop } from "@/components/agri/request-crop";
import { useUpdateLot, useWithdrawLot } from "@/hooks/use-market";
import { cropEmoji } from "@/lib/crop-catalog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { ContributeToPoolButton } from "@/components/fpo/farmer-fpo";
import { FormActions, Input, Modal, Select } from "@/components/fpo/fpo-ui";
import { LotDealsModal, LotStatusPill } from "@/components/agri/deal-ui";
import { inrKg } from "@/lib/deal-format";

export const Route = createFileRoute("/crops")({
  validateSearch: (search: Record<string, unknown>): { lot?: number } => {
    const lot = Number(search["lot"]);
    return Number.isFinite(lot) && lot > 0 ? { lot } : {};
  },
  head: () => ({
    meta: [
      { title: "My Crops — AgriSense" },
      {
        name: "description",
        content:
          "Every registered crop lot with its status, offers and sell, hold or split advice.",
      },
      { property: "og:title", content: "My Crops — AgriSense" },
      {
        property: "og:description",
        content: "Track quantity, grade, price and buyer offers for each lot.",
      },
    ],
  }),
  component: Crops,
});

const FILTERS = [
  { key: "all", label: "All lots" },
  { key: "open", label: "Open" },
  { key: "offer_received", label: "Offer received" },
  { key: "sold", label: "Sold" },
  { key: "withdrawn", label: "Withdrawn" },
] as const;

const GRADES = [
  { value: "Grade A", label: "Grade A (Export quality)" },
  { value: "Grade B", label: "Grade B (Standard)" },
  { value: "Grade C", label: "Grade C (Processing)" },
];

function Crops() {
  const { location } = useFarmLocation();
  const { t } = useI18n();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const { lots: allLots, isLoading: lotsLoading, error: lotsError } = useMyLots();
  const lots =
    filter === "all"
      ? allLots
      : filter === "withdrawn"
        ? allLots.filter((l) => l.displayStatus === "withdrawn" || l.displayStatus === "cancelled")
        : allLots.filter((l) => l.displayStatus === filter);
  const dealsLot = search.lot ?? null;
  const openDeals = (id: number | null) =>
    void navigate({ search: id ? { lot: id } : {}, replace: true });

  // Register modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formCrop, setFormCrop] = useState("Tomato");
  const [cropSearch, setCropSearch] = useState("");
  const [formQuantity, setFormQuantity] = useState("5000");
  const [formQuality, setFormQuality] = useState("Grade A");
  // Edit / withdraw state
  const [editing, setEditing] = useState<Lot | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editQuality, setEditQuality] = useState("Grade A");
  const [withdrawing, setWithdrawing] = useState<Lot | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const updateLot = useUpdateLot();
  const withdrawLot = useWithdrawLot();

  const { options: cropOptions } = useCatalogueCrops();
  const filteredCrops = useMemo(() => {
    const q = cropSearch.trim().toLowerCase();
    // Only crops in the list can be chosen; missing ones are requested from the admin.
    return q ? cropOptions.filter((c) => c.toLowerCase().includes(q)) : cropOptions;
  }, [cropOptions, cropSearch]);

  const ensureCrop = useEnsureCrop();
  const createLot = useCreateLot();
  const submitting = ensureCrop.isPending || createLot.isPending;

  async function handleRegisterLot(e: FormEvent) {
    e.preventDefault();
    const qtyNum = Number(formQuantity);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      toast.error(t("Enter a valid quantity"));
      return;
    }
    try {
      // Resolve the crop name to a backend crop id (creating it if needed).
      const crop = await ensureCrop.mutateAsync(formCrop);
      const backendLot = await createLot.mutateAsync({
        crop_id: crop.id,
        quantity_quintals: qtyNum / 100, // API expects quintals
        expected_quality: formQuality,
      });
      toast.success(`${t("Lot registered")}: LOT-${backendLot.id}`, {
        description: `${kg(qtyNum)} ${t(crop.name)} (${formQuality}). ${t("Buyers looking for this crop have been told.")}`,
      });
      setFilter("all");
      setCropSearch("");
      setIsModalOpen(false);
    } catch (err) {
      toast.error(t("Could not register lot"), {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function startEdit(lot: Lot) {
    setEditing(lot);
    setEditQty(String(lot.quantity));
    setEditQuality(GRADES.some((g) => g.value === lot.grade) ? lot.grade : "Grade A");
  }

  function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing?.backendId) return;
    const qty = Number(editQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error(t("Enter a valid quantity"));
      return;
    }
    updateLot.mutate(
      { lotId: editing.backendId, quantity_quintals: qty / 100, expected_quality: editQuality },
      {
        onSuccess: () => {
          toast.success(t("Lot updated"));
          setEditing(null);
        },
        onError: (err) => toast.error(t("Could not update lot"), { description: err.message }),
      },
    );
  }

  function confirmWithdraw(e: FormEvent) {
    e.preventDefault();
    if (!withdrawing?.backendId) return;
    withdrawLot.mutate(
      {
        lotId: withdrawing.backendId,
        ...(withdrawReason.trim() ? { reason: withdrawReason.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast.success(t("Lot withdrawn"), {
            description: t("Buyers with open offers on it have been told."),
          });
          setWithdrawing(null);
          setWithdrawReason("");
        },
        onError: (err) => toast.error(t("Could not withdraw lot"), { description: err.message }),
      },
    );
  }

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Portfolio"
        title="My crops"
        action={
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> {t("Register lot")}
          </button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count =
            f.key === "all"
              ? allLots.length
              : f.key === "withdrawn"
                ? allLots.filter(
                    (l) => l.displayStatus === "withdrawn" || l.displayStatus === "cancelled",
                  ).length
                : allLots.filter((l) => l.displayStatus === f.key).length;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full border px-4 py-2 text-sm transition-colors",
                filter === f.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              {t(f.label)} {count > 0 && <span className="opacity-70">({count})</span>}
            </button>
          );
        })}
      </div>

      {lotsLoading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("Loading your lots…")}
        </p>
      )}
      {lotsError && (
        <Panel className="border-destructive/40 text-sm text-destructive">
          {t("Could not load your lots")}: {lotsError.message}
        </Panel>
      )}
      {!lotsLoading && !lotsError && lots.length === 0 && (
        <Panel className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="text-4xl">🌾</span>
          <p className="font-serif text-2xl">
            {allLots.length === 0
              ? t("You have no lots yet — add your first lot")
              : t("No lots match this filter")}
          </p>
          {allLots.length === 0 && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> {t("Register lot")}
            </button>
          )}
        </Panel>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {lots.map((lot) => {
          const open = lot.backendStatus === "open";
          return (
            <Panel key={lot.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-2xl">
                    {lot.emoji}
                  </span>
                  <div>
                    <p className="font-serif text-2xl">{t(lot.crop)}</p>
                    <p className="text-xs text-muted-foreground">
                      {lot.id} · {lot.grade}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <LotStatusPill status={lot.displayStatus} />
                  {open && <StatusTag status={lot.status} />}
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                {(
                  [
                    ["Quantity", kg(lot.quantity)],
                    [
                      lot.priceSource === "live" ? "Mandi price" : "Typical price",
                      `${inr(lot.price)}/kg`,
                    ],
                    ["Offers waiting", String(lot.pendingOffers ?? 0)],
                    ["Best offer", lot.bestOffer ? inrKg(lot.bestOffer) : "—"],
                  ] as const
                ).map(([l, v]) => (
                  <div key={l}>
                    <p className="text-xs text-muted-foreground">{t(l)}</p>
                    <p className="mt-0.5">{v}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
                <Pill>
                  <MapPin className="h-3.5 w-3.5" /> {location.name}, {location.district}
                </Pill>
                <Pill>
                  <CalendarDays className="h-3.5 w-3.5" /> {t("Listed")}{" "}
                  {Math.round(lot.daysListed ?? 0)} {t("days ago")}
                </Pill>
                {lot.perishabilityDays !== undefined && (
                  <Pill>
                    {t("Shelf life")} ~{lot.perishabilityDays} {t("days")}
                  </Pill>
                )}
                {lot.cancelReason && <Pill tone="clay">{lot.cancelReason}</Pill>}
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                {lot.backendId && (
                  <button
                    onClick={() => openDeals(lot.backendId!)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground"
                  >
                    <Gavel className="h-4 w-4" /> {t("Offers & history")}
                  </button>
                )}
                {open && (
                  <>
                    <Link
                      to="/decision"
                      search={{ lot: lot.id }}
                      className="rounded-full border border-border px-4 py-2 text-sm"
                    >
                      {t("View AI Decision")}
                    </Link>
                    <Link
                      to="/buyers"
                      search={{ lot: lot.id } as never}
                      className="rounded-full border border-border px-4 py-2 text-sm"
                    >
                      {t("Find buyers")}
                    </Link>
                    <button
                      onClick={() => startEdit(lot)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm"
                    >
                      <Pencil className="h-3.5 w-3.5" /> {t("Edit")}
                    </button>
                    <button
                      onClick={() => setWithdrawing(lot)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground"
                    >
                      <Undo2 className="h-3.5 w-3.5" /> {t("Withdraw")}
                    </button>
                    {lot.backendId && lot.cropId ? (
                      <ContributeToPoolButton lotId={lot.backendId} cropId={lot.cropId} />
                    ) : null}
                  </>
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      <LotDealsModal lotId={dealsLot} onClose={() => openDeals(null)} myRole="farmer" />

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`${t("Edit lot")} ${editing?.id ?? ""}`}
        subtitle={t("Buyers with open offers will be told about the change.")}
      >
        <form onSubmit={saveEdit} className="space-y-4">
          <Input
            label="Quantity (kg)"
            type="number"
            min={1}
            step="1"
            required
            value={editQty}
            onChange={(e) => setEditQty(e.target.value)}
          />
          <Select
            label="Expected quality"
            value={editQuality}
            onChange={(e) => setEditQuality(e.target.value)}
          >
            {GRADES.map((g) => (
              <option key={g.value} value={g.value}>
                {t(g.label)}
              </option>
            ))}
          </Select>
          <FormActions
            onCancel={() => setEditing(null)}
            submitLabel="Save changes"
            busy={updateLot.isPending}
          />
        </form>
      </Modal>

      <Modal
        open={withdrawing !== null}
        onClose={() => setWithdrawing(null)}
        title={`${t("Withdraw lot")} ${withdrawing?.id ?? ""}`}
        subtitle={
          withdrawing?.pendingOffers
            ? `${withdrawing.pendingOffers} ${t("open offer(s) will be closed.")}`
            : t("The lot will no longer be shown to buyers.")
        }
      >
        <form onSubmit={confirmWithdraw}>
          <Input
            label="Reason (optional)"
            maxLength={200}
            value={withdrawReason}
            onChange={(e) => setWithdrawReason(e.target.value)}
            placeholder={t("For example: sold at the local mandi")}
          />
          <FormActions
            onCancel={() => setWithdrawing(null)}
            submitLabel="Withdraw lot"
            busy={withdrawLot.isPending}
          />
        </form>
      </Modal>

      {/* Register modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-[2rem] border border-border bg-card p-6 shadow-xl">
            <h2 className="font-serif text-2xl">{t("Register a new lot")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("Enter the details of your harvest.")}
            </p>

            <form onSubmit={handleRegisterLot} className="mt-6 space-y-4">
              <div>
                <div className="flex items-baseline justify-between">
                  <label className="text-sm text-muted-foreground">{t("Crop type")}</label>
                  <span className="text-[11px] text-muted-foreground">
                    {cropOptions.length} {t("crops")}
                  </span>
                </div>
                <div className="mt-1 rounded-xl border border-border bg-background focus-within:border-primary">
                  <div className="flex items-center gap-2 border-b border-border px-3">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <input
                      value={cropSearch}
                      onChange={(e) => setCropSearch(e.target.value)}
                      placeholder={t("Search crops, e.g. wheat, cotton, mango")}
                      aria-label={t("Search crops")}
                      className="w-full bg-transparent py-2.5 text-sm outline-none"
                    />
                  </div>
                  <ul
                    role="listbox"
                    aria-label={t("Crop type")}
                    className="max-h-48 overflow-y-auto p-1"
                  >
                    {filteredCrops.slice(0, 200).map((c) => (
                      <li key={c}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={formCrop === c}
                          onClick={() => setFormCrop(c)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm",
                            formCrop === c
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-secondary",
                          )}
                        >
                          <span>{cropEmoji(c)}</span>
                          <span className="flex-1">{t(c)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t("Selected")}: {cropEmoji(formCrop)}{" "}
                  <strong className="text-foreground">{formCrop}</strong>
                </p>
                <div className="mt-1.5">
                  <RequestCrop key={cropSearch} initial={cropSearch.trim()} />
                </div>
              </div>

              <div>
                <label className="text-sm text-muted-foreground">{t("Quantity (kg)")}</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={formQuantity}
                  onChange={(e) => setFormQuantity(e.target.value)}
                  required
                  className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="text-sm text-muted-foreground">{t("Expected quality")}</label>
                <select
                  value={formQuality}
                  onChange={(e) => setFormQuality(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
                >
                  {GRADES.map((g) => (
                    <option key={g.value} value={g.value}>
                      {t(g.label)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="w-full rounded-xl border border-border px-4 py-3 text-sm transition-colors hover:bg-secondary"
                >
                  {t("Cancel")}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("Register lot")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}

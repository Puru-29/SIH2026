import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Check, CheckCircle2, Layers, Plus, Wheat, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fpoApi, type Contribution, type FpoLot } from "@/services/fpo-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import { useCatalogueCrops } from "@/hooks/use-my-lots";
import { RequestCrop } from "@/components/agri/request-crop";
import { cropEmoji } from "@/lib/crop-catalog";
import { CreatePoolModal, PoolCard } from "@/components/fpo/pool-ui";
import { cn } from "@/lib/utils";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorNote,
  FormActions,
  Input,
  Loading,
  Meter,
  Modal,
  PageTitle,
  quintals,
  Select,
  shortDate,
  Table,
  Tabs,
  TextArea,
  today,
  tonnes,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/fpo/aggregation")({
  component: AggregationTabs,
});

/** Pools are the main way to aggregate; direct contributions remain for one-off lots. */
function AggregationTabs() {
  const { t } = useI18n();
  const navigate = Route.useNavigate();
  const [view, setView] = useState<"pools" | "direct">("pools");
  const [creating, setCreating] = useState(false);
  const pools = useFpoQuery(["pools"], fpoApi.pools);
  const active = (pools.data ?? []).filter(
    (p) => !["cancelled", "settled"].includes(p.effective_status),
  );
  const closed = (pools.data ?? []).filter((p) =>
    ["cancelled", "settled"].includes(p.effective_status),
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs<"pools" | "direct">
          value={view}
          onChange={setView}
          items={[
            { id: "pools", label: "Pools", count: active.length },
            { id: "direct", label: "Direct contributions" },
          ]}
        />
        {view === "pools" && (
          <Btn size="lg" icon={<Plus className="h-5 w-5" />} onClick={() => setCreating(true)}>
            {t("Create pool")}
          </Btn>
        )}
      </div>
      {view === "direct" ? (
        <AggregationPage />
      ) : (
        <>
          <PageTitle
            title="Crop pools"
            subtitle="Set a target, collect pledges from members, weigh and grade the crop at the collection centre, then list it for sale as one bulk lot."
          />
          <ErrorNote error={pools.error} />
          {pools.isLoading ? (
            <Loading />
          ) : active.length === 0 && closed.length === 0 ? (
            <Card>
              <Empty
                icon={<Wheat className="h-6 w-6" />}
                title="No pools yet"
                body="Create a pool for a crop your members grow. They can pledge to it from their own app."
                action={
                  <Btn icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                    {t("Create pool")}
                  </Btn>
                }
              />
            </Card>
          ) : (
            <>
              <div className="grid gap-5 lg:grid-cols-2">
                {active.map((p) => (
                  <PoolCard key={p.id} pool={p} />
                ))}
              </div>
              {closed.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium text-primary">
                    {t("Settled and cancelled pools")} ({closed.length})
                  </summary>
                  <div className="mt-3 grid gap-5 lg:grid-cols-2">
                    {closed.map((p) => (
                      <PoolCard key={p.id} pool={p} />
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </>
      )}
      {creating && (
        <CreatePoolModal
          onClose={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false);
            void navigate({ to: "/fpo/pools/$poolId", params: { poolId: String(p.id) } });
          }}
        />
      )}
    </>
  );
}

type Tab = "pending" | "approved" | "all";

function AggregationPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("pending");
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<FpoLot | null>(null);
  const contributions = useFpoQuery(["contributions"], () => fpoApi.contributions());
  const list = contributions.data ?? [];
  const pending = list.filter((c) => c.status === "pending");
  const approved = list.filter((c) => c.status === "approved");

  const review = useFpoMutation(
    ({ id, action }: { id: number; action: "approve" | "reject" }) =>
      fpoApi.reviewContribution(id, action),
    {
      success: (r) =>
        r.status === "approved" ? t("Contribution approved") : t("Contribution rejected"),
    },
  );

  return (
    <>
      <PageTitle
        title="Direct contributions"
        subtitle="For crop that is not part of a pool: record it, approve it, then combine it into a bulk lot."
        actions={
          <Btn size="lg" icon={<Plus className="h-5 w-5" />} onClick={() => setAdding(true)}>
            {t("Add Crop")}
          </Btn>
        }
      />

      <ol className="grid gap-3 md:grid-cols-3">
        {[
          {
            n: 1,
            title: "Add Crop",
            body: "Record what each farmer brings: crop, quantity and harvest date.",
            count: list.length,
          },
          {
            n: 2,
            title: "Approve",
            body: "Check the crop at the collection centre and approve it.",
            count: pending.length,
            note: "waiting",
          },
          {
            n: 3,
            title: "Combine Crops",
            body: "Join approved crop of the same type into one bulk lot with a Lot ID.",
            count: approved.length,
            note: "ready",
          },
        ].map((s) => (
          <li key={s.n} className="fpo-card flex gap-4 p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary font-serif text-lg text-primary-foreground">
              {s.n}
            </span>
            <div>
              <p className="text-lg font-medium">{t(s.title)}</p>
              <p className="text-sm text-muted-foreground">{t(s.body)}</p>
              {s.note && s.count > 0 && (
                <p className="mt-1 text-sm font-semibold text-primary">
                  {s.count} {t(s.note)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: "pending", label: "Waiting for approval", count: pending.length },
          { id: "approved", label: "Ready to combine", count: approved.length },
          { id: "all", label: "All contributions", count: list.length },
        ]}
      />

      <ErrorNote error={contributions.error} />
      {contributions.isLoading ? (
        <Loading />
      ) : tab === "approved" ? (
        <CombinePanel approved={approved} onCreated={setCreated} />
      ) : (
        <Card padded={false}>
          {(tab === "pending" ? pending : list).length === 0 ? (
            <Empty
              icon={<Wheat className="h-6 w-6" />}
              title={tab === "pending" ? "Nothing waiting for approval" : "No contributions yet"}
              action={
                <Btn icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
                  {t("Add Crop")}
                </Btn>
              }
            />
          ) : (
            <div className="p-3 md:p-4">
              <Table
                head={["Farmer", "Crop", "Quantity", "Harvest date", "Quality note", "Status", ""]}
              >
                {(tab === "pending" ? pending : list).map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium">{c.member_name}</td>
                    <td>
                      {cropEmoji(c.crop_name)} {t(c.crop_name)}
                      {c.variety && <span className="text-muted-foreground"> · {c.variety}</span>}
                    </td>
                    <td className="tabular-nums">{quintals(c.quantity_quintals)}</td>
                    <td>{shortDate(c.harvest_date)}</td>
                    <td className="max-w-56 truncate text-muted-foreground">
                      {c.quality_note || "—"}
                    </td>
                    <td>
                      <Badge status={c.status} />
                      {c.lot_code && (
                        <p className="mt-1 font-mono text-xs text-muted-foreground">{c.lot_code}</p>
                      )}
                    </td>
                    <td>
                      {c.status === "pending" && (
                        <div className="flex justify-end gap-1.5">
                          <Btn
                            size="sm"
                            icon={<Check className="h-4 w-4" />}
                            busy={review.isPending}
                            onClick={() => review.mutate({ id: c.id, action: "approve" })}
                          >
                            {t("Approve")}
                          </Btn>
                          <Btn
                            size="sm"
                            variant="danger"
                            icon={<X className="h-4 w-4" />}
                            onClick={() => review.mutate({ id: c.id, action: "reject" })}
                          >
                            {t("Reject")}
                          </Btn>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}

      {adding && <AddCropModal onClose={() => setAdding(false)} />}

      {created && (
        <Modal open onClose={() => setCreated(null)} title="Bulk lot created">
          <div className="flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="h-14 w-14 text-[var(--fpo-good)]" />
            <p className="text-muted-foreground">{t("Digital Lot ID")}</p>
            <p className="rounded-xl bg-accent px-4 py-2 font-mono text-xl font-semibold text-accent-foreground">
              {created.lot_code}
            </p>
            <p className="text-lg">
              {tonnes(created.total_quintals)} {t(created.crop_name)} · {created.contributor_count}{" "}
              {t("farmers")}
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-3">
              <Link
                to="/fpo/quality"
                className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 font-medium hover:bg-secondary"
              >
                {t("Record quality")}
              </Link>
              <Link
                to="/fpo/market"
                className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 font-medium text-primary-foreground"
              >
                {t("Find Buyers")}
              </Link>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function CombinePanel({
  approved,
  onCreated,
}: {
  approved: Contribution[];
  onCreated: (l: FpoLot) => void;
}) {
  const { t } = useI18n();
  const crops = useMemo(() => [...new Set(approved.map((c) => c.crop_name))].sort(), [approved]);
  const [crop, setCrop] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [warehouse, setWarehouse] = useState("");
  const [variety, setVariety] = useState("");
  const warehouses = useFpoQuery(["warehouses"], fpoApi.warehouses);
  const activeCrop = crop || crops[0] || "";
  const rows = approved.filter((c) => c.crop_name === activeCrop);
  const total = rows
    .filter((r) => picked.includes(r.id))
    .reduce((s, r) => s + r.quantity_quintals, 0);

  const create = useFpoMutation(
    () =>
      fpoApi.createLot({
        contribution_ids: picked,
        variety: variety.trim(),
        warehouse_id: warehouse ? Number(warehouse) : null,
      }),
    {
      onSuccess: (lot) => {
        setPicked([]);
        setVariety("");
        onCreated(lot);
      },
    },
  );

  if (approved.length === 0) {
    return (
      <Card>
        <Empty
          icon={<Layers className="h-6 w-6" />}
          title="No approved crop to combine"
          body="Approve contributions first. Only approved crop of the same type can be combined into a lot."
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
      <Card
        title="Choose contributions"
        subtitle="Only the same crop can be combined into one lot."
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {crops.map((c) => (
            <button
              key={c}
              onClick={() => {
                setCrop(c);
                setPicked([]);
              }}
              className={cn(
                "min-h-11 rounded-full border px-4 text-sm font-medium",
                c === activeCrop
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-secondary",
              )}
            >
              {cropEmoji(c)} {t(c)}
            </button>
          ))}
        </div>
        <div className="mb-2 flex justify-end">
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => setPicked(picked.length === rows.length ? [] : rows.map((r) => r.id))}
          >
            {picked.length === rows.length ? t("Clear all") : t("Select all")}
          </Btn>
        </div>
        <ul className="space-y-2">
          {rows.map((c) => {
            const on = picked.includes(c.id);
            return (
              <li key={c.id}>
                <label
                  className={cn(
                    "flex min-h-14 cursor-pointer items-center gap-4 rounded-2xl border p-3.5 transition-colors",
                    on ? "border-primary bg-accent/50" : "border-border hover:bg-secondary",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setPicked(on ? picked.filter((x) => x !== c.id) : [...picked, c.id])
                    }
                    className="h-5 w-5 accent-[var(--primary)]"
                  />
                  <span className="flex-1">
                    <span className="font-medium">{c.member_name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {c.variety || t(c.crop_name)} · {t("Harvest")} {shortDate(c.harvest_date)}
                    </span>
                  </span>
                  <span className="font-serif text-lg tabular-nums">
                    {quintals(c.quantity_quintals)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="New bulk lot" className="h-fit lg:sticky lg:top-24">
        <p className="text-sm text-muted-foreground">{t("Total quantity")}</p>
        <p className="font-serif text-4xl tabular-nums">{tonnes(total)}</p>
        <p className="text-sm text-muted-foreground">
          {quintals(total)} · {picked.length} {t("farmers")}
        </p>
        {picked.length > 0 && (
          <p className="mt-2 text-sm">
            {rows
              .filter((r) => picked.includes(r.id))
              .map(
                (r) =>
                  `${(r.quantity_quintals / 10).toLocaleString("en-IN", { maximumFractionDigits: 2 })} MT`,
              )
              .join(" + ")}{" "}
            = <strong>{tonnes(total)}</strong>
          </p>
        )}
        <div className="mt-5 grid gap-4">
          <Input
            id="lot-variety"
            label="Variety (optional)"
            value={variety}
            onChange={(e) => setVariety(e.target.value)}
            placeholder="e.g. Lokwan"
          />
          <Select
            id="lot-warehouse"
            label="Store in warehouse (optional)"
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value)}
          >
            <option value="">{t("Not stored yet")}</option>
            {warehouses.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} — {t("free")} {quintals(w.capacity_quintals - w.used_quintals)}
              </option>
            ))}
          </Select>
          {warehouse &&
            warehouses.data &&
            (() => {
              const w = warehouses.data.find((x) => x.id === Number(warehouse));
              return w ? (
                <Meter
                  value={w.used_quintals + total}
                  max={w.capacity_quintals}
                  tone={w.used_quintals + total > w.capacity_quintals ? "warn" : "primary"}
                />
              ) : null;
            })()}
          <Btn
            size="lg"
            icon={<Layers className="h-5 w-5" />}
            disabled={picked.length === 0}
            busy={create.isPending}
            onClick={() => create.mutate(undefined)}
          >
            {t("Combine Crops")}
          </Btn>
        </div>
      </Card>
    </div>
  );
}

function AddCropModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const members = useFpoQuery(["members", "", "active"], () => fpoApi.members("", "active"));
  const { options } = useCatalogueCrops();
  const [form, setForm] = useState({
    member_id: "",
    crop_name: "",
    variety: "",
    quantity: "",
    unit: "q" as "q" | "mt",
    harvest_date: today(),
    quality_note: "",
  });
  const qtyQuintals = Number(form.quantity || 0) * (form.unit === "mt" ? 10 : 1);
  const save = useFpoMutation(
    () =>
      fpoApi.createContribution({
        member_id: Number(form.member_id),
        crop_name: form.crop_name.trim(),
        variety: form.variety.trim(),
        quantity_quintals: qtyQuintals,
        harvest_date: form.harvest_date,
        quality_note: form.quality_note.trim(),
      }),
    { success: "Crop contribution recorded. Approve it to add it to a lot.", onSuccess: onClose },
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="Add Crop"
      subtitle="Record a farmer's crop contribution to the FPO."
    >
      {members.data && members.data.length === 0 ? (
        <Empty
          title="Add a farmer first"
          body="Crop contributions are recorded against member farmers."
          action={
            <Link
              to="/fpo/farmers"
              className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 font-medium text-primary-foreground"
            >
              {t("Add Farmer")}
            </Link>
          }
        />
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          <Select
            id="c-member"
            label="Farmer"
            required
            value={form.member_id}
            onChange={(e) => setForm({ ...form, member_id: e.target.value })}
          >
            <option value="">{t("Choose farmer")}</option>
            {members.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — {m.village}
              </option>
            ))}
          </Select>
          <Input
            id="c-crop"
            label="Crop"
            required
            list="fpo-crop-list"
            value={form.crop_name}
            onChange={(e) => setForm({ ...form, crop_name: e.target.value })}
            placeholder={t("Type to search, e.g. Wheat")}
            hint="Pick a crop from the AgriSense list"
          />
          <datalist id="fpo-crop-list">
            {options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <RequestCrop />
          <Input
            id="c-variety"
            label="Variety (optional)"
            value={form.variety}
            onChange={(e) => setForm({ ...form, variety: e.target.value })}
          />
          <div className="grid grid-cols-[1fr_130px] gap-3">
            <Input
              id="c-qty"
              label="Quantity"
              required
              type="number"
              min={0.01}
              step="0.01"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              hint={
                qtyQuintals > 0
                  ? `= ${quintals(qtyQuintals)} = ${tonnes(qtyQuintals)}`
                  : "1 MT = 10 quintals"
              }
            />
            <Select
              id="c-unit"
              label="Unit"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value as "q" | "mt" })}
            >
              <option value="q">{t("Quintal")}</option>
              <option value="mt">MT</option>
            </Select>
          </div>
          <Input
            id="c-harvest"
            label="Harvest date"
            type="date"
            required
            max={today()}
            value={form.harvest_date}
            onChange={(e) => setForm({ ...form, harvest_date: e.target.value })}
          />
          <TextArea
            id="c-note"
            label="Quality note (optional)"
            value={form.quality_note}
            onChange={(e) => setForm({ ...form, quality_note: e.target.value })}
            placeholder={t("e.g. clean, dry, bold grain")}
          />
          <FormActions onCancel={onClose} submitLabel="Add Crop" busy={save.isPending} />
        </form>
      )}
    </Modal>
  );
}

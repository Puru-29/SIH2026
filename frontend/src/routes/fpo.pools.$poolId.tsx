import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Handshake, Lock, Plus, Search, Send, Unlock } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { getLiveMandiPrices } from "@/services/api-client";
import {
  fpoApi,
  type Contribution,
  type PoolAction,
  type PoolDetail,
  type RespondInput,
} from "@/services/fpo-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import { IntakeModal, PoolProgress } from "@/components/fpo/pool-ui";
import { OfferCard } from "@/components/fpo/offer-ui";
import {
  Badge,
  Btn,
  Card,
  ConfirmButton,
  Empty,
  ErrorNote,
  FormActions,
  GradeBadge,
  Input,
  Loading,
  Modal,
  PageTitle,
  quintals,
  rupees,
  Select,
  shortDate,
  Stat,
  Table,
  tonnes,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/fpo/pools/$poolId")({
  component: PoolPage,
});

const ACTIONS: Partial<
  Record<
    string,
    { action: PoolAction; label: string; body: string; icon: typeof Lock; danger?: boolean }[]
  >
> = {
  draft: [
    {
      action: "open",
      label: "Start collecting",
      body: "Members will be able to pledge crop to this pool.",
      icon: Unlock,
    },
  ],
  collecting: [
    {
      action: "lock",
      label: "Lock pool",
      body: "No new pledges or intake after locking. You can reopen it later.",
      icon: Lock,
    },
  ],
  locked: [
    {
      action: "reopen",
      label: "Reopen collection",
      body: "Members can pledge again and you can record more intake.",
      icon: Unlock,
    },
    {
      action: "list",
      label: "List for sale",
      body: "All received crop becomes one bulk lot that buyers can bid on. Pledges not yet received will be closed.",
      icon: Handshake,
    },
  ],
};

function PoolPage() {
  const { t } = useI18n();
  const { poolId } = Route.useParams();
  const id = Number(poolId);
  const detail = useFpoQuery(["pool", id], () => fpoApi.pool(id));
  const [intake, setIntake] = useState<Contribution | null>(null);
  const [adding, setAdding] = useState(false);
  const act = useFpoMutation((a: PoolAction) => fpoApi.poolAction(id, a), {
    success: (p) => `${t("Pool updated")}: ${t(p.status)}`,
  });
  const respond = useFpoMutation(
    ({ oid, body }: { oid: number; body: RespondInput }) => fpoApi.respond(oid, body),
    {
      success: "Offer updated",
    },
  );

  if (detail.isLoading) return <Loading />;
  if (detail.error || !detail.data) return <ErrorNote error={detail.error} />;
  const d = detail.data;
  const p = d.pool;
  const canIntake = p.status === "collecting";

  return (
    <>
      <Link
        to="/fpo/aggregation"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {t("All pools")}
      </Link>
      <PageTitle
        title={`${t(p.crop_name)} ${t("pool")}`}
        subtitle={`${p.collection_center} · ${t("collect by")} ${shortDate(p.collection_deadline)}${p.lot_code ? ` · ${p.lot_code}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge status={p.effective_status} />
            {canIntake && (
              <Btn
                variant="outline"
                icon={<Plus className="h-4 w-4" />}
                onClick={() => setAdding(true)}
              >
                {t("Add pledge")}
              </Btn>
            )}
            {(ACTIONS[p.status] ?? []).map((a) => (
              <ConfirmButton
                key={a.action}
                label={a.label}
                icon={<a.icon className="h-4 w-4" />}
                busy={act.isPending}
                confirmTitle={`${t(a.label)}?`}
                confirmBody={a.body}
                onConfirm={() => act.mutate(a.action)}
              />
            ))}
            {["draft", "collecting", "locked"].includes(p.status) && (
              <ConfirmButton
                label="Cancel pool"
                variant="danger"
                confirmTitle="Cancel this pool?"
                confirmBody="All pledges are closed and farmers' own lots go back on the open market. This cannot be undone."
                onConfirm={() => act.mutate("cancel")}
              />
            )}
            {p.lot_id && (
              <Link
                to="/fpo/market"
                search={{ lot: p.lot_id }}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 font-medium text-primary-foreground"
              >
                <Search className="h-4 w-4" /> {t("Find Buyers")}
              </Link>
            )}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Target"
          value={tonnes(p.target_quantity_quintals)}
          hint={p.target_grade ? `${t("Grade")} ${p.target_grade}` : t("Any grade")}
        />
        <Stat
          label="Pledged"
          value={tonnes(p.pledged_quintals)}
          hint={`${p.contributors} ${t("farmers")}`}
        />
        <Stat
          label="Received"
          value={tonnes(p.received_quintals)}
          hint={`${p.pending_pledges} ${t("waiting for intake")}`}
        />
        <Stat label="Rejected pledges" value={p.rejected} />
      </div>
      <Card>
        <PoolProgress pool={p} />
        {d.grade_breakdown.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("Received by grade")}:</span>
            {d.grade_breakdown.map((g) => (
              <span key={g.grade} className="inline-flex items-center gap-1.5">
                <GradeBadge grade={g.grade.length === 1 ? g.grade : null} /> {quintals(g.quintals)}
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Pledges and intake"
        subtitle={
          canIntake
            ? "Weigh and grade each farmer's crop when it reaches the collection centre."
            : undefined
        }
      >
        {d.contributions.length === 0 ? (
          <Empty
            title="No pledges yet"
            body="Members pledge from My FPO in their app, or you can add a pledge for them."
          />
        ) : (
          <Table head={["Farmer", "Source", "Pledged", "Received", "Grade", "Status", ""]}>
            {d.contributions.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.member_name}</td>
                <td className="text-sm text-muted-foreground">
                  {c.source_lot_id
                    ? `${t("Own lot")} #${c.source_lot_id}`
                    : c.pledged_by === "farmer"
                      ? t("Farmer pledge")
                      : t("Recorded by FPO")}
                </td>
                <td className="tabular-nums">
                  {quintals(c.pledged_quintals ?? c.quantity_quintals)}
                </td>
                <td className="tabular-nums">
                  {c.received_quintals != null ? quintals(c.received_quintals) : "—"}
                </td>
                <td>{c.assessed_grade ? <GradeBadge grade={c.assessed_grade} /> : "—"}</td>
                <td>
                  <Badge
                    status={
                      c.status === "pending"
                        ? "pending"
                        : c.status === "approved"
                          ? "accepted"
                          : c.status
                    }
                    label={
                      c.status === "pending"
                        ? "Pledged"
                        : c.status === "approved"
                          ? "Received"
                          : undefined
                    }
                  />
                  {c.rejection_note && (
                    <p className="mt-1 max-w-56 text-xs text-muted-foreground">
                      {c.rejection_note}
                    </p>
                  )}
                </td>
                <td>
                  {canIntake && (c.status === "pending" || c.status === "approved") && (
                    <Btn
                      size="sm"
                      variant={c.status === "pending" ? "primary" : "outline"}
                      onClick={() => setIntake(c)}
                    >
                      {t(c.status === "pending" ? "Record intake" : "Change / reject")}
                    </Btn>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <SoloVsPooled d={d} />

      {p.lot_id && (
        <>
          <Card
            title="Buyer offers on this pool"
            action={
              <Link
                to="/fpo/marketplace"
                className="text-sm font-medium text-primary hover:underline"
              >
                {t("Compare offers")}
              </Link>
            }
          >
            {d.offers.length === 0 ? (
              <Empty
                icon={<Send className="h-6 w-6" />}
                title="No offers yet"
                body="Buyers see listed pools in their portal. Use Find Buyers to send offers to matching buyers."
              />
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {d.offers.map((o) => (
                  <OfferCard
                    key={o.id}
                    offer={o}
                    side="fpo"
                    busy={respond.isPending}
                    respond={(oid, body) => respond.mutate({ oid, body })}
                  />
                ))}
              </div>
            )}
          </Card>
          {d.sales.length > 0 && (
            <Card
              title="Sales and member payouts"
              action={
                <Link
                  to="/fpo/transactions"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {t("Track Payment")}
                </Link>
              }
            >
              <Table head={["Buyer", "Quantity", "Amount", "Payment", "Delivery", "Payouts"]}>
                {d.sales.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.buyer_name}</td>
                    <td className="tabular-nums">{quintals(s.quantity_quintals)}</td>
                    <td className="tabular-nums">{rupees(s.amount)}</td>
                    <td>
                      <Badge status={s.payment_status} />
                    </td>
                    <td>
                      <Badge status={s.delivery_status} />
                    </td>
                    <td className="text-sm">
                      {s.payout_count === 0
                        ? t("Not calculated")
                        : `${s.payouts_paid}/${s.payout_count} ${t("paid")}`}
                    </td>
                  </tr>
                ))}
              </Table>
              {d.payouts.length > 0 && (
                <div className="mt-5">
                  <Table head={["Farmer", "Share", "Gross", "Deductions", "Net", "Status"]}>
                    {d.payouts.map((po) => (
                      <tr key={po.id}>
                        <td>{po.member_name}</td>
                        <td className="tabular-nums">{quintals(po.quantity_quintals)}</td>
                        <td className="tabular-nums">{rupees(po.gross)}</td>
                        <td className="tabular-nums">−{rupees(po.deductions)}</td>
                        <td className="font-semibold tabular-nums">{rupees(po.net)}</td>
                        <td>
                          <Badge status={po.status} />
                        </td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {intake && <IntakeModal poolId={id} c={intake} onClose={() => setIntake(null)} />}
      {adding && <AddPledgeModal poolId={id} onClose={() => setAdding(false)} />}
    </>
  );
}

function AddPledgeModal({ poolId, onClose }: { poolId: number; onClose: () => void }) {
  const { t } = useI18n();
  const members = useFpoQuery(["members", "", "active"], () => fpoApi.members("", "active"));
  const [member, setMember] = useState("");
  const [qty, setQty] = useState("");
  const save = useFpoMutation(
    () => fpoApi.addPledge(poolId, { member_id: Number(member), quantity_quintals: Number(qty) }),
    {
      success: "Pledge added",
      onSuccess: onClose,
    },
  );
  return (
    <Modal
      open
      onClose={onClose}
      title="Add pledge"
      subtitle="Record crop a member has promised to bring to the collection centre."
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Select
          id="ap-member"
          label="Farmer"
          required
          value={member}
          onChange={(e) => setMember(e.target.value)}
        >
          <option value="">{t("Choose farmer")}</option>
          {members.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} — {m.village}
            </option>
          ))}
        </Select>
        <Input
          id="ap-qty"
          label="Pledged quantity (quintals)"
          type="number"
          min={0.01}
          step="0.01"
          required
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <FormActions onCancel={onClose} submitLabel="Add pledge" busy={save.isPending} />
      </form>
    </Modal>
  );
}

/**
 * Estimates what members earn selling alone at the mandi vs through this pool,
 * from today's mandi price, the best open buyer price and the FPO's transporters.
 */
function SoloVsPooled({ d }: { d: PoolDetail }) {
  const { t } = useI18n();
  const p = d.pool;
  const org = useFpoQuery(["org"], fpoApi.org);
  const buyers = useFpoQuery(["buyers"], fpoApi.buyers);
  const transporters = useFpoQuery(["transporters"], fpoApi.transporters);
  const [km, setKm] = useState("30");
  const state = org.data?.state ?? "Maharashtra";
  const mandi = useQuery({
    queryKey: ["fpo", "mandi", state, p.crop_name],
    queryFn: () => getLiveMandiPrices({ state, commodity: p.crop_name }),
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const qty = p.received_quintals || p.pledged_quintals;
  const members = Math.max(1, p.contributors);
  const modal = (mandi.data ?? [])
    .map((m) => m.modal_price)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const mandiPrice = modal.length ? modal[Math.floor(modal.length / 2)]! : null;
  const demandPrices = (buyers.data ?? [])
    .flatMap((b) => b.requirements)
    .filter((r) => r.crop_id === p.crop_id)
    .map((r) => r.max_price);
  const offerPrices = d.offers
    .filter((o) => o.status !== "rejected")
    .map((o) => o.price_per_quintal);
  const bulkPrice = [...demandPrices, ...offerPrices].length
    ? Math.max(...demandPrices, ...offerPrices)
    : null;
  const truck = (transporters.data ?? []).slice().sort((a, b) => a.rate_per_km - b.rate_per_km)[0];
  const distance = Number(km) || 0;
  // One trip per member when selling alone; one consolidated set of trips for the pool.
  const soloFreight = truck && qty > 0 ? (distance * truck.rate_per_km * members) / qty : null;
  const pooledFreight =
    truck && qty > 0
      ? (distance * truck.rate_per_km * Math.max(1, Math.ceil(qty / truck.capacity_quintals))) / qty
      : null;
  const soloNet = mandiPrice !== null ? mandiPrice - (soloFreight ?? 0) : null;
  const pooledNet = bulkPrice !== null ? bulkPrice - (pooledFreight ?? 0) : null;
  const gain = soloNet !== null && pooledNet !== null ? (pooledNet - soloNet) * qty : null;

  return (
    <Card
      title="Selling alone vs selling as a pool"
      subtitle="Estimate per quintal, from today's mandi price, the best open buyer price and your cheapest transporter."
    >
      <div className="mb-4 max-w-48">
        <Input
          id="svp-km"
          label="Distance to market (km)"
          type="number"
          min={0}
          value={km}
          onChange={(e) => setKm(e.target.value)}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[
          {
            title: "Each farmer alone",
            price: mandiPrice,
            priceLabel: "Mandi modal price today",
            freight: soloFreight,
            freightNote: `${members} ${t("separate trips")}`,
            net: soloNet,
          },
          {
            title: "Pooled sale",
            price: bulkPrice,
            priceLabel: "Best buyer price for this crop",
            freight: pooledFreight,
            freightNote: truck
              ? `${Math.max(1, Math.ceil(qty / truck.capacity_quintals))} ${t("shared trip(s)")}`
              : "",
            net: pooledNet,
          },
        ].map((col) => (
          <div key={col.title} className="rounded-2xl border border-border p-4">
            <p className="font-medium">{t(col.title)}</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t(col.priceLabel)}</dt>
                <dd className="tabular-nums">
                  {col.price !== null ? `${rupees(col.price)}/q` : t("Not available")}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">
                  {t("Freight")}
                  {col.freightNote ? ` (${col.freightNote})` : ""}
                </dt>
                <dd className="tabular-nums">
                  {col.freight !== null ? `−${rupees(col.freight)}/q` : t("Add a transporter")}
                </dd>
              </div>
              <div className="flex justify-between gap-2 border-t border-border pt-1.5 font-semibold">
                <dt>{t("Net per quintal")}</dt>
                <dd className="tabular-nums">{col.net !== null ? `${rupees(col.net)}/q` : "—"}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      {gain !== null && (
        <p
          className={`mt-4 rounded-xl px-4 py-3 text-base ${gain >= 0 ? "bg-[var(--fpo-good-soft)]" : "bg-[var(--fpo-warn-soft)]"}`}
        >
          {gain >= 0 ? t("Pooling earns members about") : t("Selling alone earns about")}{" "}
          <strong>{rupees(Math.abs(gain))}</strong> {t("more in total for")} {quintals(qty)}.
        </p>
      )}
      {mandi.error && (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("Mandi prices are unavailable right now")}: {mandi.error.message}
        </p>
      )}
      {bulkPrice === null && (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("No buyer has posted a requirement or offer for this crop yet.")}
        </p>
      )}
    </Card>
  );
}

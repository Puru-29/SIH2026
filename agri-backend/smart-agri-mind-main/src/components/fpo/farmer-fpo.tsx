/** Farmer-portal pieces for FPO membership: join, pledge to pools, announcements, payouts. */

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { HandHeart, Megaphone, Search, Wheat } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cropEmoji } from "@/lib/crop-catalog";
import { getSession } from "@/services/session";
import { fpoApi, type Pool } from "@/services/fpo-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import { PoolProgress } from "./pool-ui";
import {
  Badge,
  Btn,
  Empty,
  ErrorNote,
  FormActions,
  inputCls,
  Input,
  Loading,
  Modal,
  quintals,
  rupees,
  Select,
  shortDate,
  Table,
  TextArea,
} from "./fpo-ui";

const isFarmer = () => getSession()?.role === "farmer";

/** Search verified FPOs by district or crop and ask to join. */
export function JoinFpoPanel() {
  const { t } = useI18n();
  const [district, setDistrict] = useState("");
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState<{ id: number; name: string } | null>(null);
  const fpos = useFpoQuery(
    ["find-fpos", q, district],
    () => fpoApi.findFpos(q, district),
    isFarmer(),
  );
  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <h2 className="font-serif text-2xl">{t("Join an FPO")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(
          "Farmer Producer Organisations pool crop from members and sell in bulk at better prices.",
        )}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="relative">
          <span className="sr-only">{t("District or state")}</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="fpo-district"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            placeholder={t("District or state, e.g. Nashik")}
            className={`${inputCls} pl-10`}
          />
        </label>
        <input
          id="fpo-q"
          aria-label={t("FPO name or crop")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("FPO name or crop")}
          className={inputCls}
        />
      </div>
      <ErrorNote error={fpos.error} />
      {fpos.isLoading ? (
        <Loading />
      ) : !fpos.data?.length ? (
        <Empty
          title="No verified FPOs found"
          body="Try another district, or leave the search empty to see all."
        />
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {fpos.data.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {f.name} <Badge label="✓ Verified" tone="green" />
                </p>
                <p className="text-sm text-muted-foreground">
                  {[f.district, f.state].filter(Boolean).join(", ")} · {f.members} {t("members")}
                  {f.primary_crops ? ` · ${f.primary_crops}` : ""}
                </p>
              </div>
              {f.is_member ? (
                <Badge label="Member" tone="green" />
              ) : f.request_status === "pending" ? (
                <Badge label="Request sent" tone="amber" />
              ) : (
                <Btn size="sm" onClick={() => setAsking({ id: f.id, name: f.name })}>
                  {t("Ask to join")}
                </Btn>
              )}
            </li>
          ))}
        </ul>
      )}
      {asking && <JoinModal fpo={asking} onClose={() => setAsking(null)} />}
    </section>
  );
}

function JoinModal({ fpo, onClose }: { fpo: { id: number; name: string }; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const send = useFpoMutation(() => fpoApi.requestToJoin(fpo.id, message), {
    success: "Request sent. The FPO will review it.",
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Join ${fpo.name}`}
      subtitle="The FPO manager will approve your request."
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate(undefined);
        }}
      >
        <TextArea
          id="join-msg"
          label="Message (optional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. I grow 5 acres of wheat in Khanna"
        />
        <FormActions onCancel={onClose} submitLabel="Send request" busy={send.isPending} />
      </form>
    </Modal>
  );
}

/** Pools that are collecting now in the farmer's FPOs, with a pledge form. */
export function OpenPoolsPanel() {
  const { t } = useI18n();
  const data = useFpoQuery(["my-pools"], fpoApi.myPools, isFarmer());
  const [pledging, setPledging] = useState<Pool | null>(null);
  if (data.isLoading) return <Loading />;
  const pools = data.data?.pools ?? [];
  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <h2 className="font-serif text-2xl">{t("Pools collecting now")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(
          "Pledge your crop to your FPO's pool. It is weighed and graded at the collection centre.",
        )}
      </p>
      <ErrorNote error={data.error} />
      {pools.length === 0 ? (
        <Empty icon={<Wheat className="h-6 w-6" />} title="No pools are collecting right now" />
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {pools.map((p) => (
            <div key={p.id} className="rounded-2xl border border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-serif text-xl">
                    {cropEmoji(p.crop_name)} {t(p.crop_name)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {p.fpo_name} · {p.collection_center} · {t("by")}{" "}
                    {shortDate(p.collection_deadline)}
                  </p>
                </div>
                {p.target_grade && <Badge label={`Grade ${p.target_grade}`} tone="olive" />}
              </div>
              <div className="mt-3">
                <PoolProgress pool={p} />
              </div>
              <Btn
                className="mt-4"
                icon={<HandHeart className="h-4 w-4" />}
                onClick={() => setPledging(p)}
              >
                {t("Pledge crop")}
              </Btn>
            </div>
          ))}
        </div>
      )}
      {pledging && (
        <PledgeModal
          pool={pledging}
          lots={data.data?.open_lots ?? []}
          onClose={() => setPledging(null)}
        />
      )}
    </section>
  );
}

export function PledgeModal({
  pool,
  lots,
  presetLotId,
  onClose,
}: {
  pool: Pool;
  lots: {
    id: number;
    crop_id: number;
    crop_name: string;
    quantity_quintals: number;
    quality: string;
  }[];
  presetLotId?: number | undefined;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const matching = lots.filter((l) => l.crop_id === pool.crop_id);
  const [lotId, setLotId] = useState(presetLotId ? String(presetLotId) : "");
  const [qty, setQty] = useState("");
  const chosen = matching.find((l) => l.id === Number(lotId));
  const save = useFpoMutation(
    () =>
      fpoApi.pledge(pool.id, {
        quantity_quintals: chosen ? chosen.quantity_quintals : Number(qty),
        source_lot_id: chosen?.id,
      }),
    {
      success: (r) =>
        `${t("Pledged")} ${quintals(r.quantity_quintals)}. ${t("Bring it to the collection centre.")}`,
      onSuccess: onClose,
    },
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={`${t("Pledge to")} ${t(pool.crop_name)} ${t("pool")}`}
      subtitle={`${pool.fpo_name} · ${pool.collection_center} · ${t("by")} ${shortDate(pool.collection_deadline)}`}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        {matching.length > 0 && (
          <Select
            id="pl-lot"
            label="From one of my lots (optional)"
            value={lotId}
            onChange={(e) => setLotId(e.target.value)}
            hint="A pledged lot is taken off the open market and its pending buyer offers are closed."
          >
            <option value="">{t("No, enter a quantity")}</option>
            {matching.map((l) => (
              <option key={l.id} value={l.id}>
                LOT-{l.id} · {quintals(l.quantity_quintals)} · {l.quality}
              </option>
            ))}
          </Select>
        )}
        {chosen ? (
          <p className="rounded-xl bg-secondary px-4 py-3">
            {t("You will pledge the whole lot")}:{" "}
            <strong>{quintals(chosen.quantity_quintals)}</strong>
          </p>
        ) : (
          <Input
            id="pl-qty"
            label="Quantity (quintals)"
            type="number"
            min={0.01}
            step="0.01"
            required
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            hint="1 quintal = 100 kg"
          />
        )}
        <FormActions onCancel={onClose} submitLabel="Pledge crop" busy={save.isPending} />
      </form>
    </Modal>
  );
}

/** Small button for a farmer lot card: pledge this lot to a matching open pool. */
export function ContributeToPoolButton({ lotId, cropId }: { lotId: number; cropId: number }) {
  const { t } = useI18n();
  const data = useFpoQuery(["my-pools"], fpoApi.myPools, isFarmer());
  const [open, setOpen] = useState(false);
  const pool = data.data?.pools.find((p) => p.crop_id === cropId);
  const lotOpen = data.data?.open_lots.some((l) => l.id === lotId);
  if (!pool || !lotOpen) return null;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-full border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10"
      >
        {t("Contribute to FPO pool")}
      </button>
      {open && (
        <PledgeModal
          pool={pool}
          lots={data.data!.open_lots}
          presetLotId={lotId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function AnnouncementsList({ limit }: { limit?: number }) {
  const { t } = useI18n();
  const list = useFpoQuery(["my-announcements"], fpoApi.myAnnouncements);
  const items = (list.data ?? []).slice(0, limit ?? 50);
  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <h2 className="flex items-center gap-2 font-serif text-2xl">
        <Megaphone className="h-5 w-5 text-primary" /> {t("Announcements")}
      </h2>
      <ErrorNote error={list.error} />
      {list.isLoading ? (
        <Loading />
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("No announcements yet.")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {items.map((a) => (
            <li key={a.id} className="py-3">
              <p className="font-medium">{a.title}</p>
              <p className="mt-0.5 whitespace-pre-line text-sm">{a.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {a.fpo_name ?? a.author_name} · {shortDate(a.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** FPO payouts on the farmer's Settlements page. */
export function FpoPayoutsPanel() {
  const { t } = useI18n();
  const my = useFpoQuery(["my"], fpoApi.my, isFarmer());
  const payouts = my.data?.payouts ?? [];
  const pledges = (my.data?.contributions ?? []).filter((c) => c.pool_id && c.status !== "pooled");
  if (my.isLoading) return <Loading />;
  if (!my.data?.memberships.length) return null;
  return (
    <section className="rounded-3xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-2xl">{t("FPO payouts")}</h2>
        <Link to="/my-fpo" className="text-sm font-medium text-primary hover:underline">
          {t("My FPO")}
        </Link>
      </div>
      {pledges.length > 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          {pledges.length} {t("pledge(s) waiting to be received or sold")}.
        </p>
      )}
      {payouts.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("No payouts yet. They appear after your FPO sells a pool you contributed to.")}
        </p>
      ) : (
        <div className="mt-3">
          <Table
            head={["Lot ID", "Buyer", "Your share", "Gross", "Deductions", "You receive", "Status"]}
          >
            {payouts.map((p) => (
              <tr key={p.id}>
                <td className="font-mono text-sm">{p.lot_code}</td>
                <td>{p.buyer_name}</td>
                <td className="tabular-nums">{quintals(p.quantity_quintals)}</td>
                <td className="tabular-nums">{rupees(p.gross)}</td>
                <td className="tabular-nums">−{rupees(p.deductions)}</td>
                <td className="font-semibold tabular-nums">{rupees(p.net)}</td>
                <td>
                  <Badge status={p.status} />
                  {p.reference && <p className="text-xs text-muted-foreground">{p.reference}</p>}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </section>
  );
}

/** Profile shortcut to FPO membership (farmers only). */
export function MyFpoCard() {
  const { t } = useI18n();
  const my = useFpoQuery(["my"], fpoApi.my, isFarmer());
  if (!isFarmer()) return null;
  const m = my.data?.memberships[0];
  return (
    <Link
      to="/my-fpo"
      className="flex flex-wrap items-center gap-4 rounded-3xl border border-border bg-card p-5 hover:border-primary/50"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-primary">
        <Wheat className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("My FPO")}</p>
        <p className="text-sm text-muted-foreground">
          {m
            ? `${m.fpo_name} · ${[m.district, m.state].filter(Boolean).join(", ")}`
            : t("You are not in an FPO yet. Find one near you and ask to join.")}
        </p>
      </div>
      <span className="text-sm font-medium text-primary">{m ? t("Open") : t("Join an FPO")} →</span>
    </Link>
  );
}

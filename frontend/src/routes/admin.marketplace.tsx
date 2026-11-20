import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { adminApi, type Flag } from "@/services/admin-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import { Pager, ReasonModal } from "@/components/admin/admin-ui";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorNote,
  inputCls,
  Loading,
  PageTitle,
  quintals,
  rupees,
  shortDate,
  Table,
  Tabs,
} from "@/components/fpo/fpo-ui";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/marketplace")({
  component: MarketplacePage,
});

type Tab = "flags" | "lots" | "offers" | "demands" | "transactions";
type Cancel = { kind: "lot" | "offer" | "fpo_offer"; id: number; label: string };

function MarketplacePage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("flags");
  const [f, setF] = useState({ status: "", crop: "", page: 1 });
  const [cancel, setCancel] = useState<Cancel | null>(null);
  const flags = useFpoQuery(["admin", "flags"], adminApi.flags, tab === "flags");
  const lots = useFpoQuery(
    ["admin", "lots", f],
    () => adminApi.lots({ ...f, limit: 20 }),
    tab === "lots",
  );
  const offers = useFpoQuery(
    ["admin", "offers", f],
    () => adminApi.offers({ ...f, limit: 20 }),
    tab === "offers",
  );
  const demands = useFpoQuery(
    ["admin", "demands", f],
    () => adminApi.demands({ ...f, limit: 20 }),
    tab === "demands",
  );
  const txs = useFpoQuery(
    ["admin", "transactions", f],
    () => adminApi.transactions({ ...f, limit: 20 }),
    tab === "transactions",
  );
  const doCancel = useFpoMutation(
    ({ c, reason }: { c: Cancel; reason: string }) =>
      c.kind === "lot"
        ? adminApi.cancelLot(c.id, reason)
        : c.kind === "offer"
          ? adminApi.cancelOffer(c.id, reason)
          : adminApi.cancelFpoOffer(c.id, reason),
    { success: "Cancelled. The people involved were notified.", onSuccess: () => setCancel(null) },
  );
  const switchTab = (next: Tab) => {
    setTab(next);
    setF({ status: "", crop: "", page: 1 });
  };
  const filters = tab !== "flags" && (
    <div className="flex flex-wrap gap-3">
      <input
        id="m-crop"
        aria-label={t("Crop")}
        placeholder={t("Filter by crop")}
        value={f.crop}
        onChange={(e) => setF({ ...f, crop: e.target.value, page: 1 })}
        className={`${inputCls} w-56`}
      />
      {tab !== "transactions" && (
        <select
          id="m-status"
          aria-label={t("Status")}
          value={f.status}
          onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}
          className={`${inputCls} w-48`}
        >
          <option value="">{t("All statuses")}</option>
          {(tab === "lots"
            ? ["open", "pooled", "sold", "reserved", "cancelled"]
            : tab === "offers"
              ? ["pending", "open", "accepted", "rejected", "cancelled"]
              : ["open", "fulfilled", "cancelled"]
          ).map((s) => (
            <option key={s} value={s}>
              {t(s)}
            </option>
          ))}
        </select>
      )}
    </div>
  );

  return (
    <>
      <PageTitle
        title="Marketplace monitoring"
        subtitle="Every lot, offer, buyer requirement and deal on the platform, with automatic checks for suspicious activity."
      />
      <Tabs<Tab>
        value={tab}
        onChange={switchTab}
        items={[
          { id: "flags", label: "Flags", count: flags.data?.flags.length },
          { id: "lots", label: "Lots" },
          { id: "offers", label: "Offers" },
          { id: "demands", label: "Buyer demand" },
          { id: "transactions", label: "Deals" },
        ]}
      />
      {filters}

      {tab === "flags" && (
        <Card title="Suspicious activity" subtitle={flags.data?.rules}>
          <ErrorNote error={flags.error} />
          {flags.isLoading ? (
            <Loading label="Checking live mandi prices…" />
          ) : !flags.data?.flags.length ? (
            <Empty
              icon={<ShieldAlert className="h-6 w-6" />}
              title="Nothing suspicious right now"
            />
          ) : (
            <ul className="space-y-2">
              {flags.data.flags.map((fl, i) => (
                <FlagRow key={i} fl={fl} onCancel={(c) => setCancel(c)} />
              ))}
            </ul>
          )}
          {flags.data && flags.data.price_check_unavailable.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              {t("Mandi price not available, so these were not price-checked")}:{" "}
              {flags.data.price_check_unavailable.join(", ")}
            </p>
          )}
        </Card>
      )}

      {tab === "lots" && (
        <Card padded={false}>
          <ErrorNote error={lots.error} />
          {lots.isLoading ? (
            <div className="px-6">
              <Loading />
            </div>
          ) : !lots.data?.items.length ? (
            <Empty title="No lots" />
          ) : (
            <div className="p-3 md:p-4">
              <Table head={["Lot", "Seller", "Crop", "Quantity", "Quality", "Place", "Status", ""]}>
                {lots.data.items.map((l) => (
                  <tr key={`${l.kind}-${l.id}`}>
                    <td className="font-mono text-sm">
                      {l.kind === "fpo" ? "FPO " : ""}#{l.id}
                      <p className="font-sans text-xs text-muted-foreground">
                        {shortDate(l.created_at)}
                      </p>
                    </td>
                    <td>{l.seller}</td>
                    <td>{t(l.crop)}</td>
                    <td className="tabular-nums">{quintals(l.quantity_quintals)}</td>
                    <td>{l.quality}</td>
                    <td className="text-sm">{l.place || "—"}</td>
                    <td>
                      <Badge status={l.status} />
                      {l.cancel_reason && (
                        <p className="mt-1 max-w-48 text-xs text-muted-foreground">
                          {l.cancel_reason}
                        </p>
                      )}
                    </td>
                    <td>
                      {l.kind === "farmer" && l.status === "open" && (
                        <Btn
                          size="sm"
                          variant="danger"
                          onClick={() =>
                            setCancel({ kind: "lot", id: l.id, label: `lot #${l.id}` })
                          }
                        >
                          {t("Cancel")}
                        </Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
              <Pager
                page={lots.data.page}
                pages={lots.data.pages}
                total={lots.data.total}
                onPage={(page) => setF({ ...f, page })}
              />
            </div>
          )}
        </Card>
      )}

      {tab === "offers" && (
        <Card padded={false}>
          <ErrorNote error={offers.error} />
          {offers.isLoading ? (
            <div className="px-6">
              <Loading />
            </div>
          ) : !offers.data?.items.length ? (
            <Empty title="No offers" />
          ) : (
            <div className="p-3 md:p-4">
              <Table head={["Offer", "Crop", "Buyer", "Seller", "Quantity", "Price", "Status", ""]}>
                {offers.data.items.map((o) => {
                  const cancellable =
                    (o.kind === "farmer" && o.status === "pending") ||
                    (o.kind === "fpo" && o.status === "open");
                  return (
                    <tr key={`${o.kind}-${o.id}`}>
                      <td className="font-mono text-sm">
                        {o.kind === "fpo" ? "FPO " : ""}#{o.id}
                        <p className="font-sans text-xs text-muted-foreground">
                          {shortDate(o.created_at)}
                        </p>
                      </td>
                      <td>{t(o.crop)}</td>
                      <td>{o.buyer}</td>
                      <td>{o.seller}</td>
                      <td className="tabular-nums">{quintals(o.quantity_quintals)}</td>
                      <td className="tabular-nums">{rupees(o.price_per_quintal)}/q</td>
                      <td>
                        <Badge status={o.status} />
                        {o.cancel_reason && (
                          <p className="mt-1 max-w-48 text-xs text-muted-foreground">
                            {o.cancel_reason}
                          </p>
                        )}
                      </td>
                      <td>
                        {cancellable && (
                          <Btn
                            size="sm"
                            variant="danger"
                            onClick={() =>
                              setCancel({
                                kind: o.kind === "fpo" ? "fpo_offer" : "offer",
                                id: o.id,
                                label: `offer #${o.id}`,
                              })
                            }
                          >
                            {t("Cancel")}
                          </Btn>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Table>
              <Pager
                page={offers.data.page}
                pages={offers.data.pages}
                total={offers.data.total}
                onPage={(page) => setF({ ...f, page })}
              />
            </div>
          )}
        </Card>
      )}

      {tab === "demands" && (
        <Card padded={false}>
          <ErrorNote error={demands.error} />
          {demands.isLoading ? (
            <div className="px-6">
              <Loading />
            </div>
          ) : !demands.data?.items.length ? (
            <Empty title="No buyer requirements" />
          ) : (
            <div className="p-3 md:p-4">
              <Table
                head={[
                  "#",
                  "Buyer",
                  "Crop",
                  "Quantity",
                  "Max price",
                  "Quality",
                  "Deliver to",
                  "By",
                  "Status",
                ]}
              >
                {demands.data.items.map((d) => (
                  <tr key={d.id}>
                    <td className="font-mono text-sm">#{d.id}</td>
                    <td>{d.buyer}</td>
                    <td>{t(d.crop)}</td>
                    <td className="tabular-nums">{quintals(d.quantity_quintals)}</td>
                    <td className="tabular-nums">{rupees(d.max_price)}/q</td>
                    <td>{d.quality}</td>
                    <td>{d.location}</td>
                    <td>{shortDate(d.required_by)}</td>
                    <td>
                      <Badge status={d.status} />
                    </td>
                  </tr>
                ))}
              </Table>
              <Pager
                page={demands.data.page}
                pages={demands.data.pages}
                total={demands.data.total}
                onPage={(page) => setF({ ...f, page })}
              />
            </div>
          )}
        </Card>
      )}

      {tab === "transactions" && (
        <Card padded={false}>
          <ErrorNote error={txs.error} />
          {txs.isLoading ? (
            <div className="px-6">
              <Loading />
            </div>
          ) : !txs.data?.items.length ? (
            <Empty title="No deals yet" />
          ) : (
            <div className="p-3 md:p-4">
              <Table
                head={["Deal", "Crop", "Buyer", "Seller", "Quantity", "Price", "Amount", "Status"]}
              >
                {txs.data.items.map((x) => (
                  <tr key={`${x.kind}-${x.id}`}>
                    <td className="font-mono text-sm">
                      {x.kind === "fpo" ? "FPO " : ""}#{x.id}
                      <p className="font-sans text-xs text-muted-foreground">
                        {shortDate(x.created_at)}
                      </p>
                    </td>
                    <td>{t(x.crop)}</td>
                    <td>{x.buyer}</td>
                    <td>{x.seller}</td>
                    <td className="tabular-nums">{quintals(x.quantity_quintals)}</td>
                    <td className="tabular-nums">{rupees(x.price_per_quintal)}/q</td>
                    <td className="tabular-nums">{rupees(x.amount)}</td>
                    <td>
                      <Badge status={x.status} />
                      {x.open_disputes > 0 && (
                        <div className="mt-1">
                          <Badge label={`${x.open_disputes} dispute(s)`} tone="red" />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
              <Pager
                page={txs.data.page}
                pages={txs.data.pages}
                total={txs.data.total}
                onPage={(page) => setF({ ...f, page })}
              />
            </div>
          )}
        </Card>
      )}

      {cancel && (
        <ReasonModal
          title={`Cancel ${cancel.label}`}
          subtitle="The seller and buyer are notified with your reason."
          submitLabel="Cancel it"
          busy={doCancel.isPending}
          onClose={() => setCancel(null)}
          onSubmit={(reason) => doCancel.mutate({ c: cancel, reason })}
        />
      )}
    </>
  );
}

function FlagRow({ fl, onCancel }: { fl: Flag; onCancel: (c: Cancel) => void }) {
  const { t } = useI18n();
  const canCancel =
    (fl.entity_type === "offer" && fl.status === "pending") ||
    (fl.entity_type === "fpo_offer" && fl.status === "open") ||
    fl.entity_type === "lot";
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl border p-3.5",
        fl.severity === "high"
          ? "border-destructive/40 bg-destructive/5"
          : "border-[var(--fpo-warn)]/40 bg-[var(--fpo-warn-soft)]",
      )}
    >
      <AlertTriangle
        className={cn(
          "h-5 w-5 shrink-0",
          fl.severity === "high" ? "text-destructive" : "text-[var(--fpo-warn)]",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {t(
            fl.kind === "low_price"
              ? "Offer far below mandi price"
              : fl.kind === "no_settlement"
                ? "Deals not being paid"
                : "Possible duplicate lot",
          )}
        </p>
        <p className="text-sm">{fl.message}</p>
      </div>
      {canCancel && (
        <Btn
          size="sm"
          variant="danger"
          onClick={() =>
            onCancel({
              kind:
                fl.entity_type === "lot"
                  ? "lot"
                  : fl.entity_type === "fpo_offer"
                    ? "fpo_offer"
                    : "offer",
              id: fl.entity_id,
              label: `${fl.entity_type.replace("_", " ")} #${fl.entity_id}`,
            })
          }
        >
          {t("Cancel")}
        </Btn>
      )}
    </li>
  );
}

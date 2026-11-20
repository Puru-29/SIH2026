import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Boxes, Eye, Layers } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fpoApi } from "@/services/fpo-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import { cropEmoji } from "@/lib/crop-catalog";
import { LotDetail, StockBar } from "@/components/fpo/lot-detail";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorNote,
  GradeBadge,
  inputCls,
  Loading,
  PageTitle,
  quintals,
  Stat,
  tonnes,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/fpo/inventory")({
  component: InventoryPage,
});

function InventoryPage() {
  const { t } = useI18n();
  const lots = useFpoQuery(["lots"], fpoApi.lots);
  const warehouses = useFpoQuery(["warehouses"], fpoApi.warehouses);
  const [status, setStatus] = useState("");
  const [crop, setCrop] = useState("");
  const [viewing, setViewing] = useState<number | null>(null);
  const move = useFpoMutation(
    ({ id, warehouse }: { id: number; warehouse: number | null }) =>
      fpoApi.assignWarehouse(id, warehouse),
    { success: "Storage updated" },
  );

  const all = lots.data ?? [];
  const list = all.filter(
    (l) => (!status || l.status === status) && (!crop || l.crop_name === crop),
  );
  const sum = (
    k: "total_quintals" | "available_quintals" | "reserved_quintals" | "sold_quintals",
  ) => all.reduce((s, l) => s + l[k], 0);

  return (
    <>
      <PageTitle
        title="Inventory"
        subtitle="Every bulk lot with its available, reserved and sold stock. Stock is reserved when an offer is accepted and becomes sold on delivery, so the same quantity can never be sold twice."
        actions={
          <Link
            to="/fpo/aggregation"
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 font-medium text-primary-foreground"
          >
            <Layers className="h-5 w-5" /> {t("Combine Crops")}
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Total collected"
          value={tonnes(sum("total_quintals"))}
          hint={`${all.length} ${t("lots")}`}
        />
        <Stat
          label="Available"
          value={tonnes(sum("available_quintals"))}
          hint={t("Free to sell")}
        />
        <Stat
          label="Reserved"
          value={tonnes(sum("reserved_quintals"))}
          hint={t("Accepted, not yet delivered")}
        />
        <Stat label="Sold" value={tonnes(sum("sold_quintals"))} hint={t("Delivered to buyers")} />
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          id="inv-status"
          aria-label={t("Status")}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={`${inputCls} w-auto`}
        >
          <option value="">{t("All statuses")}</option>
          <option value="available">{t("Available")}</option>
          <option value="partly_sold">{t("Partly sold")}</option>
          <option value="reserved">{t("Reserved")}</option>
          <option value="sold">{t("Sold")}</option>
        </select>
        <select
          id="inv-crop"
          aria-label={t("Crop")}
          value={crop}
          onChange={(e) => setCrop(e.target.value)}
          className={`${inputCls} w-auto`}
        >
          <option value="">{t("All crops")}</option>
          {[...new Set(all.map((l) => l.crop_name))].map((c) => (
            <option key={c} value={c}>
              {t(c)}
            </option>
          ))}
        </select>
      </div>

      <ErrorNote error={lots.error} />
      {lots.isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Card>
          <Empty
            icon={<Boxes className="h-6 w-6" />}
            title={all.length ? "No lots match this filter" : "No bulk lots yet"}
            body="Approved crop contributions become lots when you combine them."
          />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {list.map((l) => (
            <Card key={l.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-2xl">
                    {cropEmoji(l.crop_name)}
                  </span>
                  <div>
                    <p className="font-serif text-xl">
                      {t(l.crop_name)}{" "}
                      {l.variety && (
                        <span className="text-base text-muted-foreground">· {l.variety}</span>
                      )}
                    </p>
                    <p className="font-mono text-sm text-muted-foreground">{l.lot_code}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge status={l.status} />
                  <GradeBadge grade={l.grade} />
                </div>
              </div>
              <p className="mt-4 font-serif text-3xl tabular-nums">
                {tonnes(l.total_quintals)}{" "}
                <span className="text-base text-muted-foreground">
                  · {quintals(l.total_quintals)} · {l.contributor_count} {t("farmers")}
                </span>
              </p>
              <div className="mt-3">
                <StockBar lot={l} />
              </div>
              <div className="mt-5 flex flex-wrap items-end gap-3">
                <label className="min-w-48 flex-1 text-sm">
                  <span className="mb-1 block text-muted-foreground">{t("Warehouse")}</span>
                  <select
                    id={`wh-${l.id}`}
                    value={l.warehouse_id ?? ""}
                    disabled={move.isPending || l.status === "sold"}
                    onChange={(e) =>
                      move.mutate({
                        id: l.id,
                        warehouse: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    className={inputCls}
                  >
                    <option value="">{t("Not stored")}</option>
                    {warehouses.data?.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Btn
                  variant="outline"
                  icon={<Eye className="h-4 w-4" />}
                  onClick={() => setViewing(l.id)}
                >
                  {t("View details")}
                </Btn>
              </div>
            </Card>
          ))}
        </div>
      )}
      {viewing !== null && <LotDetail id={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

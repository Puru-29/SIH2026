import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { adminApi, type MasterRow, type MasterTable } from "@/services/admin-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import {
  Btn,
  Card,
  ConfirmButton,
  Empty,
  ErrorNote,
  FormActions,
  Input,
  Loading,
  Modal,
  PageTitle,
  Select,
  Table,
  Tabs,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/admin/master-data")({
  component: MasterDataPage,
});

type Field = { key: string; label: string; type: "text" | "number" | "market"; step?: string };

const TABLES: Record<MasterTable, { label: string; subtitle: string; fields: Field[] }> = {
  crops: {
    label: "Crops",
    subtitle: "Shelf life is used by the smart-sale advisor to decide how long a crop can be held.",
    fields: [
      { key: "name", label: "Crop name", type: "text" },
      { key: "perishability_days", label: "Shelf life (days)", type: "number", step: "1" },
    ],
  },
  markets: {
    label: "Markets",
    subtitle: "Mandis used by the net-realisation calculator.",
    fields: [
      { key: "name", label: "Market name", type: "text" },
      { key: "location", label: "Location (state)", type: "text" },
    ],
  },
  transport: {
    label: "Transport costs",
    subtitle: "Freight per quintal between places, used by the net-realisation calculator.",
    fields: [
      { key: "from_location", label: "From", type: "text" },
      { key: "to_location", label: "To", type: "text" },
      { key: "cost_per_quintal", label: "Cost (₹ per quintal)", type: "number", step: "0.5" },
    ],
  },
  storage: {
    label: "Storage rates",
    subtitle: "Storage cost per quintal per day at each market.",
    fields: [
      { key: "market_id", label: "Market", type: "market" },
      {
        key: "cost_per_quintal_per_day",
        label: "Cost (₹ per quintal per day)",
        type: "number",
        step: "0.05",
      },
    ],
  },
};

const COLUMNS: Record<MasterTable, [string, string][]> = {
  crops: [
    ["name", "Crop"],
    ["perishability_days", "Shelf life (days)"],
    ["in_use", "Used by"],
  ],
  markets: [
    ["name", "Market"],
    ["location", "Location"],
    ["in_use", "Storage rates"],
  ],
  transport: [
    ["from_location", "From"],
    ["to_location", "To"],
    ["cost_per_quintal", "₹ / quintal"],
  ],
  storage: [
    ["market", "Market"],
    ["cost_per_quintal_per_day", "₹ / quintal / day"],
  ],
};

function MasterDataPage() {
  const { t } = useI18n();
  const [table, setTable] = useState<MasterTable>("crops");
  const [editing, setEditing] = useState<MasterRow | "new" | null>(null);
  const rows = useFpoQuery(["admin", "master", table], () => adminApi.master(table));
  const del = useFpoMutation((id: number) => adminApi.masterDelete(table, id), {
    success: "Deleted",
  });
  const meta = TABLES[table];
  return (
    <>
      <PageTitle
        title="Master data"
        subtitle="Reference data the advisor and calculators read. Every change is recorded in the audit log."
      />
      <Tabs<MasterTable>
        value={table}
        onChange={(v) => {
          setTable(v);
          setEditing(null);
        }}
        items={(Object.keys(TABLES) as MasterTable[]).map((k) => ({
          id: k,
          label: TABLES[k].label,
        }))}
      />
      <Card
        title={meta.label}
        subtitle={meta.subtitle}
        action={
          <Btn icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>
            {t("Add")}
          </Btn>
        }
      >
        <ErrorNote error={rows.error} />
        {rows.isLoading ? (
          <Loading />
        ) : !rows.data?.length ? (
          <Empty title="Nothing here yet" />
        ) : (
          <Table head={[...COLUMNS[table].map(([, l]) => l), ""]}>
            {rows.data.map((r) => (
              <tr key={r.id}>
                {COLUMNS[table].map(([k]) => (
                  <td key={k} className={typeof r[k] === "number" ? "tabular-nums" : undefined}>
                    {r[k] ?? "—"}
                  </td>
                ))}
                <td>
                  <div className="flex justify-end gap-1.5">
                    <Btn
                      size="sm"
                      variant="ghost"
                      icon={<Pencil className="h-4 w-4" />}
                      onClick={() => setEditing(r)}
                      aria-label={t("Edit")}
                    >
                      <span className="sr-only">{t("Edit")}</span>
                    </Btn>
                    <ConfirmButton
                      size="sm"
                      variant="danger"
                      label="Delete"
                      icon={<Trash2 className="h-4 w-4" />}
                      disabled={r.in_use > 0}
                      title={r.in_use > 0 ? t("In use, cannot be deleted") : undefined}
                      confirmTitle="Delete this record?"
                      confirmBody="This cannot be undone. Records in use by lots or other data cannot be deleted."
                      onConfirm={() => del.mutate(r.id)}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && (
        <EditModal
          table={table}
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function EditModal({
  table,
  row,
  onClose,
}: {
  table: MasterTable;
  row: MasterRow | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const meta = TABLES[table];
  const markets = useFpoQuery(
    ["admin", "master", "markets"],
    () => adminApi.master("markets"),
    table === "storage",
  );
  const [f, setF] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      meta.fields.map((fl) => [fl.key, row?.[fl.key] != null ? String(row[fl.key]) : ""]),
    ),
  );
  const save = useFpoMutation(
    () => {
      const body = Object.fromEntries(
        meta.fields.map((fl) => [fl.key, fl.type === "text" ? f[fl.key] : Number(f[fl.key])]),
      );
      return row ? adminApi.masterUpdate(table, row.id, body) : adminApi.masterCreate(table, body);
    },
    { success: "Saved", onSuccess: onClose },
  );
  return (
    <Modal open onClose={onClose} title={`${row ? t("Edit") : t("Add")} · ${t(meta.label)}`}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        {meta.fields.map((fl) =>
          fl.type === "market" ? (
            <Select
              key={fl.key}
              id={`md-${fl.key}`}
              label={fl.label}
              required
              value={f[fl.key]}
              onChange={(e) => setF({ ...f, [fl.key]: e.target.value })}
            >
              <option value="">{t("Choose market")}</option>
              {markets.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {String(m["name"])}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              key={fl.key}
              id={`md-${fl.key}`}
              label={fl.label}
              required
              type={fl.type}
              step={fl.step}
              min={fl.type === "number" ? 0 : undefined}
              value={f[fl.key]}
              onChange={(e) => setF({ ...f, [fl.key]: e.target.value })}
            />
          ),
        )}
        <FormActions onCancel={onClose} submitLabel="Save" busy={save.isPending} />
      </form>
    </Modal>
  );
}

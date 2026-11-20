import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FileClock } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { adminApi } from "@/services/admin-api";
import { useFpoQuery } from "@/hooks/use-fpo";
import { Pager } from "@/components/admin/admin-ui";
import {
  Card,
  Empty,
  ErrorNote,
  inputCls,
  Loading,
  PageTitle,
  shortDate,
  Table,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/admin/audit")({
  component: AuditPage,
});

const ENTITIES = [
  "",
  "fpo",
  "user",
  "lot",
  "offer",
  "fpo_offer",
  "dispute",
  "crops",
  "markets",
  "transport_costs",
  "storage_facilities",
  "announcement",
];

function AuditPage() {
  const { t } = useI18n();
  const [f, setF] = useState({ action: "", entity_type: "", page: 1 });
  const list = useFpoQuery(["admin", "audit", f], () => adminApi.audit({ ...f, limit: 30 }));
  return (
    <>
      <PageTitle
        title="Audit log"
        subtitle="Every action taken by an administrator, newest first. This list cannot be edited."
      />
      <div className="flex flex-wrap gap-3">
        <input
          id="au-action"
          aria-label={t("Action")}
          placeholder={t("Search action, e.g. suspend")}
          value={f.action}
          onChange={(e) => setF({ ...f, action: e.target.value, page: 1 })}
          className={`${inputCls} w-64`}
        />
        <select
          id="au-entity"
          aria-label={t("Record type")}
          value={f.entity_type}
          onChange={(e) => setF({ ...f, entity_type: e.target.value, page: 1 })}
          className={`${inputCls} w-56`}
        >
          {ENTITIES.map((e) => (
            <option key={e} value={e}>
              {e ? e.replace(/_/g, " ") : t("All record types")}
            </option>
          ))}
        </select>
      </div>
      <ErrorNote error={list.error} />
      <Card padded={false}>
        {list.isLoading ? (
          <div className="px-6">
            <Loading />
          </div>
        ) : !list.data?.items.length ? (
          <Empty icon={<FileClock className="h-6 w-6" />} title="No admin actions match" />
        ) : (
          <div className="p-3 md:p-4">
            <Table head={["When", "Admin", "Action", "Record", "Details"]}>
              {list.data.items.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap text-sm">
                    {shortDate(a.created_at)}
                    <p className="text-xs text-muted-foreground">
                      {a.created_at.slice(11, 16)} UTC
                    </p>
                  </td>
                  <td>{a.admin}</td>
                  <td className="font-mono text-sm">{a.action}</td>
                  <td className="text-sm">
                    {a.entity_type.replace(/_/g, " ")}
                    {a.entity_id != null ? ` #${a.entity_id}` : ""}
                  </td>
                  <td className="max-w-md text-sm text-muted-foreground">
                    {a.details && Object.keys(a.details).length > 0
                      ? Object.entries(a.details)
                          .filter(([, v]) => v !== null && v !== "")
                          .map(
                            ([k, v]) =>
                              `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`,
                          )
                          .join(" · ")
                      : "—"}
                  </td>
                </tr>
              ))}
            </Table>
            <Pager
              page={list.data.page}
              pages={list.data.pages}
              total={list.data.total}
              onPage={(page) => setF({ ...f, page })}
            />
          </div>
        )}
      </Card>
    </>
  );
}

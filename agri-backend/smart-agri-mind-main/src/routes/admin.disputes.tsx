import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Scale } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { adminApi, type Dispute } from "@/services/admin-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import { Pager, ReasonModal } from "@/components/admin/admin-ui";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorNote,
  Loading,
  Modal,
  PageTitle,
  rupees,
  shortDate,
  Table,
  Tabs,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/admin/disputes")({
  component: DisputesPage,
});

const TONE: Record<Dispute["status"], "amber" | "olive" | "green" | "gray"> = {
  open: "amber",
  investigating: "olive",
  resolved: "green",
  rejected: "gray",
};

function DisputesPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<"" | Dispute["status"]>("open");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const list = useFpoQuery(["admin", "disputes", status, page], () =>
    adminApi.disputes({ status, page, limit: 20 }),
  );

  return (
    <>
      <PageTitle
        title="Disputes"
        subtitle="Problems raised by farmers and buyers on their orders. Review the order history and record a decision."
      />
      <Tabs<"" | Dispute["status"]>
        value={status}
        onChange={(s) => {
          setStatus(s);
          setPage(1);
        }}
        items={[
          { id: "open", label: "Open" },
          { id: "investigating", label: "Investigating" },
          { id: "resolved", label: "Resolved" },
          { id: "rejected", label: "Rejected" },
          { id: "", label: "All" },
        ]}
      />
      <ErrorNote error={list.error} />
      <Card padded={false}>
        {list.isLoading ? (
          <div className="px-6">
            <Loading />
          </div>
        ) : !list.data?.items.length ? (
          <Empty icon={<Scale className="h-6 w-6" />} title="No disputes here" />
        ) : (
          <div className="p-3 md:p-4">
            <Table head={["#", "Order", "Raised by", "Reason", "Amount", "Status", ""]}>
              {list.data.items.map((d) => (
                <tr key={d.id}>
                  <td className="font-mono text-sm">
                    #{d.id}
                    <p className="font-sans text-xs text-muted-foreground">
                      {shortDate(d.created_at)}
                    </p>
                  </td>
                  <td className="text-sm">
                    #{d.transaction_id} · {t(d.crop)}
                    <p className="text-muted-foreground">
                      {d.farmer} → {d.buyer}
                    </p>
                  </td>
                  <td>
                    {d.raised_by_name}
                    <p className="text-xs capitalize text-muted-foreground">
                      {t(d.raised_by_role)}
                    </p>
                  </td>
                  <td className="max-w-72 text-sm">{d.reason}</td>
                  <td className="tabular-nums">{rupees(d.amount)}</td>
                  <td>
                    <Badge label={d.status} tone={TONE[d.status]} />
                  </td>
                  <td>
                    <Btn size="sm" variant="outline" onClick={() => setOpen(d.id)}>
                      {t("Review")}
                    </Btn>
                  </td>
                </tr>
              ))}
            </Table>
            <Pager
              page={list.data.page}
              pages={list.data.pages}
              total={list.data.total}
              onPage={setPage}
            />
          </div>
        )}
      </Card>
      {open !== null && <DisputeModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function DisputeModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useI18n();
  const d = useFpoQuery(["admin", "dispute", id], () => adminApi.dispute(id));
  const [deciding, setDeciding] = useState<Dispute["status"] | null>(null);
  const save = useFpoMutation(
    ({ s, note }: { s: Dispute["status"]; note: string }) => adminApi.setDisputeStatus(id, s, note),
    {
      success: "Dispute updated. Both parties were notified.",
      onSuccess: () => setDeciding(null),
    },
  );
  const dispute = d.data?.dispute;
  const openish = dispute && (dispute.status === "open" || dispute.status === "investigating");
  return (
    <Modal
      open
      onClose={onClose}
      title={`Dispute #${id}`}
      subtitle={
        dispute
          ? `${t("Order")} #${dispute.transaction_id} · ${t(dispute.crop)} · ${rupees(dispute.amount)}`
          : undefined
      }
      wide
    >
      <ErrorNote error={d.error} />
      {!d.data || !dispute ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div className="rounded-2xl bg-secondary p-4">
            <p className="text-sm text-muted-foreground">
              {dispute.raised_by_name} ({t(dispute.raised_by_role)}) {t("says")}:
            </p>
            <p className="mt-1 whitespace-pre-line">{dispute.reason}</p>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t("Farmer")}</dt>
              <dd>{d.data.farmer_contact}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("Buyer")}</dt>
              <dd>{d.data.buyer_contact}</dd>
            </div>
          </dl>
          <section>
            <h3 className="mb-2 font-serif text-xl">{t("Order timeline")}</h3>
            <ol className="space-y-2 border-l-2 border-accent pl-4">
              {d.data.timeline.map((e, i) => (
                <li key={i} className="text-sm">
                  <span className="text-muted-foreground">{shortDate(e.at)}</span> · {e.event}
                </li>
              ))}
            </ol>
            {d.data.other_disputes_on_order > 0 && (
              <p className="mt-2 text-sm text-[var(--fpo-warn)]">
                {d.data.other_disputes_on_order} {t("other dispute(s) on this order")}
              </p>
            )}
          </section>
          {dispute.resolution_note && (
            <div className="rounded-2xl border border-border p-4 text-sm">
              <p className="text-muted-foreground">
                {t("Decision")} · {dispute.resolved_by_name}
              </p>
              <p className="mt-1">{dispute.resolution_note}</p>
            </div>
          )}
          {openish && (
            <div className="flex flex-wrap gap-2">
              {dispute.status === "open" && (
                <Btn
                  variant="outline"
                  busy={save.isPending}
                  onClick={() => save.mutate({ s: "investigating", note: "" })}
                >
                  {t("Start investigating")}
                </Btn>
              )}
              <Btn onClick={() => setDeciding("resolved")}>{t("Mark resolved")}</Btn>
              <Btn variant="danger" onClick={() => setDeciding("rejected")}>
                {t("Reject")}
              </Btn>
            </div>
          )}
        </div>
      )}
      {deciding && (
        <ReasonModal
          title={deciding === "resolved" ? "Resolve dispute" : "Reject dispute"}
          subtitle="Both parties see this decision."
          submitLabel={deciding === "resolved" ? "Mark resolved" : "Reject"}
          busy={save.isPending}
          onClose={() => setDeciding(null)}
          onSubmit={(note) => save.mutate({ s: deciding, note })}
        />
      )}
    </Modal>
  );
}

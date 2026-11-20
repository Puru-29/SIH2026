import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MessageSquareWarning, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fpoApi, type GrievanceStatus } from "@/services/fpo-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import { GrievanceCard, GrievanceForm } from "@/components/fpo/grievance-ui";
import {
  Btn,
  Card,
  Empty,
  ErrorNote,
  FormActions,
  Loading,
  Modal,
  PageTitle,
  Tabs,
  TextArea,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/fpo/grievances")({
  component: GrievancesPage,
});

type Tab = "open" | "closed" | "all";

function GrievancesPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("open");
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<{ id: number; status: GrievanceStatus } | null>(null);
  const list = useFpoQuery(["grievances"], fpoApi.grievances);
  const sales = useFpoQuery(["sales"], fpoApi.sales);
  const members = useFpoQuery(["members", "", ""], () => fpoApi.members());
  const create = useFpoMutation(fpoApi.createGrievance, {
    success: "Complaint submitted",
    onSuccess: () => setCreating(false),
  });
  const all = list.data ?? [];
  const open = all.filter((g) => g.status === "submitted" || g.status === "under_review");
  const closed = all.filter((g) => g.status === "resolved" || g.status === "rejected");
  const shown = tab === "open" ? open : tab === "closed" ? closed : all;

  return (
    <>
      <PageTitle
        title="Grievances"
        subtitle="Complaints from farmers and your team about payments, quality or buyers. Each status change is kept in the history."
        actions={
          <Btn size="lg" icon={<Plus className="h-5 w-5" />} onClick={() => setCreating(true)}>
            {t("Report a problem")}
          </Btn>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: "open", label: "Open", count: open.length },
          { id: "closed", label: "Closed", count: closed.length },
          { id: "all", label: "All", count: all.length },
        ]}
      />
      <ErrorNote error={list.error} />
      {list.isLoading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <Card>
          <Empty
            icon={<MessageSquareWarning className="h-6 w-6" />}
            title={tab === "open" ? "No open grievances" : "No grievances here"}
          />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {shown.map((g) => (
            <GrievanceCard
              key={g.id}
              g={g}
              actions={
                g.status === "submitted" || g.status === "under_review" ? (
                  <>
                    {g.status === "submitted" && (
                      <Btn
                        variant="outline"
                        onClick={() => setDeciding({ id: g.id, status: "under_review" })}
                      >
                        {t("Start review")}
                      </Btn>
                    )}
                    <Btn onClick={() => setDeciding({ id: g.id, status: "resolved" })}>
                      {t("Mark resolved")}
                    </Btn>
                    <Btn
                      variant="danger"
                      onClick={() => setDeciding({ id: g.id, status: "rejected" })}
                    >
                      {t("Reject")}
                    </Btn>
                  </>
                ) : undefined
              }
            />
          ))}
        </div>
      )}
      {creating && (
        <GrievanceForm
          busy={create.isPending}
          onClose={() => setCreating(false)}
          onSubmit={(b) => create.mutate(b)}
          sales={sales.data?.map((s) => ({
            id: s.id,
            label: `#${s.id} · ${s.buyer_name} · ${s.lot_code}`,
          }))}
          members={members.data?.map((m) => ({ id: m.id, label: `${m.name} · ${m.village}` }))}
        />
      )}
      {deciding && <DecisionModal {...deciding} onClose={() => setDeciding(null)} />}
    </>
  );
}

function DecisionModal({
  id,
  status,
  onClose,
}: {
  id: number;
  status: GrievanceStatus;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const save = useFpoMutation(() => fpoApi.grievanceStatus(id, status, note), {
    success: "Grievance updated",
    onSuccess: onClose,
  });
  const title =
    status === "resolved"
      ? "Mark resolved"
      : status === "rejected"
        ? "Reject grievance"
        : "Start review";
  return (
    <Modal open onClose={onClose} title={title}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <TextArea
          id="gd-note"
          label={status === "under_review" ? "Note (optional)" : "What was decided?"}
          required={status !== "under_review"}
          minLength={status !== "under_review" ? 5 : undefined}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          hint="This note is shown to the person who raised the complaint"
        />
        <FormActions onCancel={onClose} submitLabel={title} busy={save.isPending} />
      </form>
    </Modal>
  );
}

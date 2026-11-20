import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BadgeCheck, Check, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { adminApi } from "@/services/admin-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import { ReasonModal } from "@/components/admin/admin-ui";
import {
  Badge,
  Btn,
  Card,
  ConfirmButton,
  Empty,
  ErrorNote,
  Loading,
  PageTitle,
  shortDate,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/admin/verification")({
  component: VerificationPage,
});

type Rejecting = { kind: "fpo" | "buyer"; id: number; name: string };

function VerificationPage() {
  const { t } = useI18n();
  const q = useFpoQuery(["admin", "verifications"], adminApi.verifications);
  const [rejecting, setRejecting] = useState<Rejecting | null>(null);
  const decide = useFpoMutation(
    ({
      kind,
      id,
      approve,
      reason,
    }: {
      kind: "fpo" | "buyer";
      id: number;
      approve: boolean;
      reason?: string;
    }) =>
      kind === "fpo"
        ? adminApi.decideFpo(id, approve, reason)
        : adminApi.decideBuyer(id, approve, reason),
    {
      success: "Decision saved and the user was notified",
      onSuccess: () => setRejecting(null),
    },
  );
  if (q.isLoading) return <Loading />;
  const fpos = q.data?.fpos ?? [];
  const buyers = q.data?.buyers ?? [];
  const waitingFpos = fpos.filter((f) => !f.rejection_reason);
  const sentBack = fpos.filter((f) => f.rejection_reason);
  const waitingBuyers = buyers.filter((b) => !b.verification_note);

  return (
    <>
      <PageTitle
        title="Verification queue"
        subtitle="Check registration documents offline, then approve or send back with a reason. Only approved accounts get the verified badge."
      />
      <ErrorNote error={q.error} />

      <Card title="FPOs waiting for approval" subtitle={`${waitingFpos.length} ${t("waiting")}`}>
        {waitingFpos.length === 0 ? (
          <Empty icon={<BadgeCheck className="h-6 w-6" />} title="No FPOs waiting" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {waitingFpos.map((f) => (
              <div key={f.id} className="rounded-2xl border border-border p-4">
                <p className="text-lg font-semibold">{f.name}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">{t("Registration number")}</dt>
                  <dd className="font-mono">{f.registration_no ?? "—"}</dd>
                  <dt className="text-muted-foreground">{t("District")}</dt>
                  <dd>{[f.district, f.state].filter(Boolean).join(", ") || "—"}</dd>
                  <dt className="text-muted-foreground">{t("Manager")}</dt>
                  <dd>
                    {f.manager} · {f.phone}
                  </dd>
                  <dt className="text-muted-foreground">{t("Primary crops")}</dt>
                  <dd>{f.primary_crops || "—"}</dd>
                  <dt className="text-muted-foreground">{t("Members")}</dt>
                  <dd>{f.members}</dd>
                  <dt className="text-muted-foreground">{t("Registered")}</dt>
                  <dd>{shortDate(f.created_at)}</dd>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ConfirmButton
                    label="Approve"
                    icon={<Check className="h-4 w-4" />}
                    busy={decide.isPending}
                    confirmTitle={`${t("Approve")} ${f.name}?`}
                    confirmBody="Confirm you have checked the FPO's registration certificate. The manager gets full access to the FPO portal."
                    onConfirm={() => decide.mutate({ kind: "fpo", id: f.id, approve: true })}
                  />
                  <Btn
                    variant="danger"
                    icon={<X className="h-4 w-4" />}
                    onClick={() => setRejecting({ kind: "fpo", id: f.id, name: f.name })}
                  >
                    {t("Send back")}
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Unverified buyers" subtitle={`${waitingBuyers.length} ${t("waiting")}`}>
        {waitingBuyers.length === 0 ? (
          <Empty title="No buyers waiting" />
        ) : (
          <ul className="divide-y divide-border">
            {waitingBuyers.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {b.name}{" "}
                    <span className="text-sm font-normal text-muted-foreground">· {b.phone}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("Joined")} {shortDate(b.created_at)} · {b.demands} {t("requirements")} ·{" "}
                    {b.offers} {t("offers")}
                  </p>
                </div>
                <ConfirmButton
                  size="sm"
                  label="Verify"
                  icon={<Check className="h-4 w-4" />}
                  confirmTitle={`${t("Verify")} ${b.name}?`}
                  confirmBody="Confirm you have checked the buyer's GSTIN or trade licence."
                  onConfirm={() => decide.mutate({ kind: "buyer", id: b.id, approve: true })}
                />
                <Btn
                  size="sm"
                  variant="danger"
                  onClick={() => setRejecting({ kind: "buyer", id: b.id, name: b.name })}
                >
                  {t("Decline")}
                </Btn>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {sentBack.length > 0 && (
        <Card
          title="Sent back to the FPO"
          subtitle="They return to the queue when the FPO updates its details."
        >
          <ul className="divide-y divide-border">
            {sentBack.map((f) => (
              <li key={f.id} className="py-3">
                <p className="font-medium">
                  {f.name} <Badge label="Waiting for FPO" tone="amber" />
                </p>
                <p className="text-sm text-muted-foreground">{f.rejection_reason}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {rejecting && (
        <ReasonModal
          title={
            rejecting.kind === "fpo" ? `Send ${rejecting.name} back` : `Decline ${rejecting.name}`
          }
          subtitle="Explain what is missing or wrong. The user sees this message."
          submitLabel={rejecting.kind === "fpo" ? "Send back" : "Decline"}
          busy={decide.isPending}
          onClose={() => setRejecting(null)}
          onSubmit={(reason) =>
            decide.mutate({ kind: rejecting.kind, id: rejecting.id, approve: false, reason })
          }
        />
      )}
    </>
  );
}

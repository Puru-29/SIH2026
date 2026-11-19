import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Users } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { PageHeader, Panel } from "@/components/agri/ui-bits";
import { useI18n } from "@/lib/i18n";
import { fpoApi } from "@/services/fpo-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import { GrievanceCard, GrievanceForm } from "@/components/fpo/grievance-ui";
import {
  Badge,
  Btn,
  Empty,
  ErrorNote,
  Loading,
  quintals,
  rupees,
  shortDate,
  Table,
  VerifiedBadge,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/my-fpo")({
  head: () => ({ meta: [{ title: "My FPO — AgriSense" }] }),
  component: MyFpo,
});

function MyFpo() {
  const { t } = useI18n();
  const my = useFpoQuery(["my"], fpoApi.my);
  const [complaining, setComplaining] = useState(false);
  const raise = useFpoMutation(fpoApi.myGrievance, {
    success: "Complaint sent to your FPO",
    onSuccess: () => setComplaining(false),
  });
  const d = my.data;
  const earned = d?.payouts.reduce((s, p) => s + p.net, 0) ?? 0;
  const paid = d?.payouts.filter((p) => p.status === "paid").reduce((s, p) => s + p.net, 0) ?? 0;

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="FPO membership"
        title="My FPO"
        description="Your FPO membership, the crop you gave for bulk sale, and the money due to you."
        action={
          d && d.memberships.length > 0 ? (
            <Btn icon={<Plus className="h-4 w-4" />} onClick={() => setComplaining(true)}>
              {t("Report a problem")}
            </Btn>
          ) : undefined
        }
      />
      <ErrorNote error={my.error} />
      {my.isLoading || !d ? (
        <Loading />
      ) : d.memberships.length === 0 ? (
        <Panel>
          <Empty
            icon={<Users className="h-6 w-6" />}
            title="You are not linked to an FPO yet"
            body="Ask your FPO manager to add you as a member using the same mobile number you use to sign in to AgriSense."
          />
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {d.memberships.map((m) => (
              <Panel key={m.member_id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-serif text-xl">{m.fpo_name}</p>
                  <VerifiedBadge verified={m.fpo_verified} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[m.district, m.state].filter(Boolean).join(", ")} · {t("Member since")}{" "}
                  {shortDate(m.joined_at)}
                </p>
                <div className="mt-2">
                  <Badge status={m.status} />
                </div>
              </Panel>
            ))}
            <Panel>
              <p className="text-sm text-muted-foreground">{t("Total earnings")}</p>
              <p className="mt-1 font-serif text-3xl">{rupees(earned)}</p>
              <p className="text-sm text-muted-foreground">
                {t("Paid")} {rupees(paid)} · {t("Due")} {rupees(earned - paid)}
              </p>
            </Panel>
          </div>

          <Panel>
            <h2 className="mb-3 font-serif text-2xl">{t("My crop contributions")}</h2>
            {d.contributions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("No contributions recorded yet.")}</p>
            ) : (
              <Table head={["Crop", "Quantity", "Harvest", "Lot ID", "Status"]}>
                {d.contributions.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {t(c.crop_name)}
                      {c.variety && ` · ${c.variety}`}
                    </td>
                    <td className="tabular-nums">{quintals(c.quantity_quintals)}</td>
                    <td>{shortDate(c.harvest_date)}</td>
                    <td className="font-mono text-sm">{c.lot_code ?? "—"}</td>
                    <td>
                      <Badge status={c.status} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>

          <Panel>
            <h2 className="mb-3 font-serif text-2xl">{t("My payments")}</h2>
            {d.payouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  "No payments yet. They appear after your crop is sold and the FPO calculates farmer payments.",
                )}
              </p>
            ) : (
              <Table
                head={[
                  "Lot ID",
                  "Buyer",
                  "Your share",
                  "Gross",
                  "Deductions",
                  "You receive",
                  "Status",
                ]}
              >
                {d.payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono text-sm">{p.lot_code}</td>
                    <td>{p.buyer_name}</td>
                    <td className="tabular-nums">{quintals(p.quantity_quintals)}</td>
                    <td className="tabular-nums">{rupees(p.gross)}</td>
                    <td className="tabular-nums">−{rupees(p.deductions)}</td>
                    <td className="font-semibold tabular-nums">{rupees(p.net)}</td>
                    <td>
                      <Badge status={p.status} />
                      {p.paid_on && (
                        <p className="text-xs text-muted-foreground">
                          {shortDate(p.paid_on)} · {p.reference}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>

          {d.grievances.length > 0 && (
            <div className="space-y-4">
              <h2 className="font-serif text-2xl">{t("My complaints")}</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {d.grievances.map((g) => (
                  <GrievanceCard key={g.id} g={g} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {complaining && d && (
        <GrievanceForm
          busy={raise.isPending}
          onClose={() => setComplaining(false)}
          onSubmit={(b) => raise.mutate(b)}
          fpos={d.memberships.map((m) => ({ id: m.fpo_id, label: m.fpo_name }))}
          sales={[
            ...new Map(
              d.payouts.map((p) => [
                p.sale_id,
                { id: p.sale_id, label: `${p.lot_code} · ${p.buyer_name}` },
              ]),
            ).values(),
          ]}
        />
      )}
    </PortalLayout>
  );
}

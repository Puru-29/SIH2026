import { createFileRoute } from "@tanstack/react-router";
import { BadgeCheck } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { PageHeader, Panel } from "@/components/agri/ui-bits";
import { useI18n } from "@/lib/i18n";
import { fpoApi } from "@/services/fpo-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import {
  ConfirmButton,
  Empty,
  ErrorNote,
  Loading,
  rupees,
  Table,
  VerifiedBadge,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — AgriSense" }] }),
  component: AdminPage,
});

function AdminPage() {
  const { t } = useI18n();
  const fpos = useFpoQuery(["admin", "fpos"], fpoApi.adminFpos);
  const buyers = useFpoQuery(["admin", "buyers"], fpoApi.adminBuyers);
  const verifyFpo = useFpoMutation(
    ({ id, v }: { id: number; v: boolean }) => fpoApi.adminVerifyFpo(id, v),
    { success: "FPO verification updated" },
  );
  const verifyBuyer = useFpoMutation(
    ({ id, v }: { id: number; v: boolean }) => fpoApi.adminVerifyBuyer(id, v),
    { success: "Buyer verification updated" },
  );

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Admin"
        title="Verification"
        description="Check registration documents offline, then verify FPO organisations and buyers. Only verified accounts show the verified badge."
      />
      <ErrorNote error={fpos.error ?? buyers.error} />
      <Panel>
        <h2 className="mb-3 font-serif text-2xl">{t("FPO organisations")}</h2>
        {fpos.isLoading ? (
          <Loading />
        ) : !fpos.data?.length ? (
          <Empty title="No FPOs registered yet" />
        ) : (
          <Table
            head={["FPO", "Registration no.", "Manager", "Members", "Lots", "Sales", "Status", ""]}
          >
            {fpos.data.map((o) => (
              <tr key={o.id}>
                <td>
                  <p className="font-medium">{o.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {[o.district, o.state].filter(Boolean).join(", ")}
                  </p>
                </td>
                <td className="font-mono text-sm">{o.registration_no ?? "—"}</td>
                <td>
                  {o.manager}
                  <p className="text-sm text-muted-foreground">{o.manager_phone}</p>
                </td>
                <td className="tabular-nums">{o.members}</td>
                <td className="tabular-nums">{o.lots}</td>
                <td className="tabular-nums">{rupees(o.sales_value)}</td>
                <td>
                  <VerifiedBadge verified={o.verified} />
                </td>
                <td>
                  <ConfirmButton
                    size="sm"
                    variant={o.verified ? "danger" : "primary"}
                    icon={o.verified ? undefined : <BadgeCheck className="h-4 w-4" />}
                    label={o.verified ? "Remove verification" : "Verify"}
                    confirmTitle={o.verified ? "Remove verification?" : "Verify this FPO?"}
                    confirmBody={
                      o.verified
                        ? "Buyers will see this FPO as not verified."
                        : "Confirm you have checked the FPO's registration documents."
                    }
                    onConfirm={() => verifyFpo.mutate({ id: o.id, v: !o.verified })}
                  />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <Panel>
        <h2 className="mb-3 font-serif text-2xl">{t("Buyers")}</h2>
        {buyers.isLoading ? (
          <Loading />
        ) : (
          <Table head={["Buyer", "FPO deals", "Marketplace deals", "Trust", "Status", ""]}>
            {buyers.data?.map((b) => (
              <tr key={b.id}>
                <td className="font-medium">{b.name}</td>
                <td className="tabular-nums">{b.fpo_deals}</td>
                <td className="tabular-nums">{b.marketplace_deals}</td>
                <td className="text-sm">{b.trust.score ?? t("No history")}</td>
                <td>
                  <VerifiedBadge verified={b.verified} />
                </td>
                <td>
                  <ConfirmButton
                    size="sm"
                    variant={b.verified ? "danger" : "primary"}
                    label={b.verified ? "Remove verification" : "Verify"}
                    confirmTitle={b.verified ? "Remove verification?" : "Verify this buyer?"}
                    confirmBody={
                      b.verified
                        ? "FPOs will see this buyer as not verified."
                        : "Confirm you have checked the buyer's GST / trade licence."
                    }
                    onConfirm={() => verifyBuyer.mutate({ id: b.id, v: !b.verified })}
                  />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </PortalLayout>
  );
}

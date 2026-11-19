import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, Pencil, Search, UserPlus, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fpoApi, type FpoMember, type MemberInput } from "@/services/fpo-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorNote,
  FormActions,
  Input,
  inputCls,
  Loading,
  Modal,
  PageTitle,
  quintals,
  rupees,
  Select,
  shortDate,
  Table,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/fpo/farmers")({
  component: FarmersPage,
});

const blank: MemberInput = {
  name: "",
  phone: "",
  village: "",
  land_acres: 0,
  crops: "",
  status: "active",
};

function FarmersPage() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<{ id: number | null; form: MemberInput } | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const members = useFpoQuery(["members", q, status], () => fpoApi.members(q, status));

  const save = useFpoMutation(
    ({ id, form }: { id: number | null; form: MemberInput }) =>
      id ? fpoApi.updateMember(id, form) : fpoApi.createMember(form),
    {
      success: (m) => `${m.name} — ${t("saved")}`,
      onSuccess: () => setEditing(null),
    },
  );

  const startEdit = (m: FpoMember) =>
    setEditing({
      id: m.id,
      form: {
        name: m.name,
        phone: m.phone,
        village: m.village,
        land_acres: m.land_acres,
        crops: m.crops,
        status: m.status,
      },
    });

  return (
    <>
      <PageTitle
        title="Farmers"
        subtitle="Your FPO members, their land, crops, contributions and payments."
        actions={
          <Btn
            size="lg"
            icon={<UserPlus className="h-5 w-5" />}
            onClick={() => setEditing({ id: null, form: blank })}
          >
            {t("Add Farmer")}
          </Btn>
        }
      />

      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        <label className="relative">
          <span className="sr-only">{t("Search farmers")}</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            id="farmer-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Search by name, mobile, village or crop")}
            className={`${inputCls} pl-12`}
          />
        </label>
        <select
          id="farmer-status"
          aria-label={t("Membership")}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={inputCls}
        >
          <option value="">{t("All members")}</option>
          <option value="active">{t("Active")}</option>
          <option value="inactive">{t("Inactive")}</option>
        </select>
      </div>

      <Card padded={false}>
        <ErrorNote error={members.error} />
        {members.isLoading ? (
          <div className="px-6">
            <Loading />
          </div>
        ) : !members.data?.length ? (
          <Empty
            icon={<Users className="h-6 w-6" />}
            title={q || status ? "No farmers match your search" : "No farmers added yet"}
            body="Add the farmers who are members of your FPO. You can then record their crop contributions."
            action={
              <Btn
                icon={<UserPlus className="h-4 w-4" />}
                onClick={() => setEditing({ id: null, form: blank })}
              >
                {t("Add Farmer")}
              </Btn>
            }
          />
        ) : (
          <div className="p-3 md:p-4">
            <Table
              head={[
                "Farmer",
                "Village",
                "Land",
                "Crops",
                "Contributed",
                "Earnings",
                "Membership",
                "",
              ]}
            >
              {members.data.map((m) => (
                <tr key={m.id}>
                  <td>
                    <p className="font-medium">{m.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {m.phone} {m.user_id ? `· ${t("has app login")}` : ""}
                    </p>
                  </td>
                  <td>{m.village}</td>
                  <td className="tabular-nums">
                    {m.land_acres} {t("acres")}
                  </td>
                  <td className="max-w-48 truncate">{m.crops || "—"}</td>
                  <td className="tabular-nums">
                    {quintals(m.contributed_quintals)}
                    {m.pending_quintals > 0 && (
                      <p className="text-xs text-[var(--fpo-warn)]">
                        +{quintals(m.pending_quintals)} {t("waiting")}
                      </p>
                    )}
                  </td>
                  <td className="tabular-nums">
                    {rupees(m.payouts_net)}
                    <p className="text-xs text-muted-foreground">
                      {t("Paid")} {rupees(m.payouts_paid)}
                    </p>
                  </td>
                  <td>
                    <Badge status={m.status} />
                  </td>
                  <td>
                    <div className="flex justify-end gap-1.5">
                      <Btn
                        size="sm"
                        variant="outline"
                        icon={<Eye className="h-4 w-4" />}
                        onClick={() => setViewing(m.id)}
                      >
                        {t("View")}
                      </Btn>
                      <Btn
                        size="sm"
                        variant="ghost"
                        icon={<Pencil className="h-4 w-4" />}
                        onClick={() => startEdit(m)}
                        aria-label={t("Edit")}
                      >
                        <span className="sr-only">{t("Edit")}</span>
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Card>

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing.id ? "Edit farmer" : "Add Farmer"}
          subtitle="Mobile number is used to link the farmer's own AgriSense login."
        >
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(editing);
            }}
          >
            <Input
              id="m-name"
              label="Farmer name"
              required
              value={editing.form.name}
              onChange={(e) =>
                setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })
              }
              placeholder="e.g. Ramesh Patil"
            />
            <Input
              id="m-phone"
              label="Mobile number"
              required
              inputMode="numeric"
              pattern="[0-9]{10}"
              maxLength={10}
              title={t("10 digit mobile number")}
              value={editing.form.phone}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  form: { ...editing.form, phone: e.target.value.replace(/\D/g, "") },
                })
              }
              placeholder="10 digits"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                id="m-village"
                label="Village"
                required
                value={editing.form.village}
                onChange={(e) =>
                  setEditing({ ...editing, form: { ...editing.form, village: e.target.value } })
                }
              />
              <Input
                id="m-land"
                label="Land size (acres)"
                type="number"
                min={0}
                step="0.1"
                value={editing.form.land_acres}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    form: { ...editing.form, land_acres: Number(e.target.value) },
                  })
                }
              />
            </div>
            <Input
              id="m-crops"
              label="Crops grown"
              hint="Separate with commas"
              value={editing.form.crops}
              onChange={(e) =>
                setEditing({ ...editing, form: { ...editing.form, crops: e.target.value } })
              }
              placeholder="Wheat, Onion, Soybean"
            />
            {editing.id && (
              <Select
                id="m-status"
                label="Membership"
                value={editing.form.status}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    form: { ...editing.form, status: e.target.value as "active" | "inactive" },
                  })
                }
              >
                <option value="active">{t("Active")}</option>
                <option value="inactive">{t("Inactive")}</option>
              </Select>
            )}
            <FormActions
              onCancel={() => setEditing(null)}
              submitLabel={editing.id ? "Save changes" : "Add Farmer"}
              busy={save.isPending}
            />
          </form>
        </Modal>
      )}

      {viewing !== null && <FarmerDetail id={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function FarmerDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useI18n();
  const { data, isLoading, error } = useFpoQuery(["member", id], () => fpoApi.member(id));
  return (
    <Modal
      open
      onClose={onClose}
      title={data?.member.name ?? "Farmer"}
      subtitle={data ? `${data.member.village} · ${data.member.phone}` : undefined}
      wide
    >
      <ErrorNote error={error} />
      {isLoading || !data ? (
        <Loading />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["Land", `${data.member.land_acres} ${t("acres")}`],
              ["Contributed", quintals(data.member.contributed_quintals)],
              ["Earnings", rupees(data.member.payouts_net)],
              ["Paid", rupees(data.member.payouts_paid)],
            ].map(([l, v]) => (
              <div key={l} className="rounded-2xl bg-secondary p-3">
                <p className="text-xs text-muted-foreground">{t(l!)}</p>
                <p className="mt-0.5 font-serif text-xl">{v}</p>
              </div>
            ))}
          </div>
          <div>
            <h3 className="mb-2 font-serif text-xl">{t("Crop contributions")}</h3>
            {data.contributions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("No contributions yet.")}</p>
            ) : (
              <Table head={["Crop", "Quantity", "Harvest", "Lot ID", "Status"]}>
                {data.contributions.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {t(c.crop_name)}{" "}
                      {c.variety && <span className="text-muted-foreground">· {c.variety}</span>}
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
          </div>
          <div>
            <h3 className="mb-2 font-serif text-xl">{t("Payments to farmer")}</h3>
            {data.payouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("No payments calculated yet.")}</p>
            ) : (
              <Table head={["Lot ID", "Buyer", "Share", "Gross", "Deductions", "Net", "Status"]}>
                {data.payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono text-sm">{p.lot_code}</td>
                    <td>{p.buyer_name}</td>
                    <td className="tabular-nums">{quintals(p.quantity_quintals)}</td>
                    <td className="tabular-nums">{rupees(p.gross)}</td>
                    <td className="tabular-nums">−{rupees(p.deductions)}</td>
                    <td className="font-semibold tabular-nums">{rupees(p.net)}</td>
                    <td>
                      <Badge status={p.status} />
                      {p.reference && (
                        <p className="text-xs text-muted-foreground">{p.reference}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

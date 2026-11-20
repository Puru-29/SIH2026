import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Search } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { adminApi, type AdminUser } from "@/services/admin-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import { Pager, ReasonModal } from "@/components/admin/admin-ui";
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
  shortDate,
  Table,
  TextArea,
  VerifiedBadge,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/admin/users")({
  component: UsersPage,
});

function UsersPage() {
  const { t } = useI18n();
  const [f, setF] = useState({ q: "", role: "", status: "", district: "", page: 1 });
  const [open, setOpen] = useState<number | null>(null);
  const list = useFpoQuery(["admin", "users", f], () => adminApi.users({ ...f, limit: 20 }));
  const set = (patch: Partial<typeof f>) => setF({ ...f, page: 1, ...patch });

  return (
    <>
      <PageTitle
        title="Users"
        subtitle="Search everyone on AgriSense, see their activity, and suspend accounts that break the rules."
      />
      <div className="grid gap-3 md:grid-cols-[1fr_160px_160px_200px]">
        <label className="relative">
          <span className="sr-only">{t("Search users")}</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="u-q"
            value={f.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder={t("Name or phone")}
            className={`${inputCls} pl-10`}
          />
        </label>
        <select
          id="u-role"
          aria-label={t("Role")}
          value={f.role}
          onChange={(e) => set({ role: e.target.value })}
          className={inputCls}
        >
          <option value="">{t("All roles")}</option>
          <option value="farmer">{t("Farmer")}</option>
          <option value="buyer">{t("Buyer")}</option>
          <option value="fpo">FPO</option>
          <option value="admin">{t("Admin")}</option>
        </select>
        <select
          id="u-status"
          aria-label={t("Status")}
          value={f.status}
          onChange={(e) => set({ status: e.target.value })}
          className={inputCls}
        >
          <option value="">{t("All statuses")}</option>
          <option value="active">{t("Active")}</option>
          <option value="pending">{t("Pending")}</option>
          <option value="suspended">{t("Suspended")}</option>
        </select>
        <input
          id="u-district"
          aria-label={t("District or state")}
          value={f.district}
          onChange={(e) => set({ district: e.target.value })}
          placeholder={t("District or state")}
          className={inputCls}
        />
      </div>
      <ErrorNote error={list.error} />
      <Card padded={false}>
        {list.isLoading ? (
          <div className="px-6">
            <Loading />
          </div>
        ) : !list.data?.items.length ? (
          <Empty title="No users match" />
        ) : (
          <div className="p-3 md:p-4">
            <Table head={["User", "Role", "Location", "Lots", "Offers", "Deals", "Status", ""]}>
              {list.data.items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <p className="font-medium">{u.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {u.phone} · {t("joined")} {shortDate(u.created_at)}
                    </p>
                  </td>
                  <td className="capitalize">
                    {u.role === "fpo" ? "FPO" : t(u.role)}
                    {u.role === "buyer" && (
                      <div className="mt-1">
                        <VerifiedBadge verified={u.buyer_verified} />
                      </div>
                    )}
                  </td>
                  <td className="text-sm">{u.location || "—"}</td>
                  <td className="tabular-nums">{u.lots}</td>
                  <td className="tabular-nums">{u.offers}</td>
                  <td className="tabular-nums">{u.transactions}</td>
                  <td>
                    <Badge
                      label={u.status}
                      tone={
                        u.status === "active" ? "green" : u.status === "suspended" ? "red" : "amber"
                      }
                    />
                  </td>
                  <td>
                    <Btn size="sm" variant="outline" onClick={() => setOpen(u.id)}>
                      {t("View")}
                    </Btn>
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
      {open !== null && <UserModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function UserModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useI18n();
  const d = useFpoQuery(["admin", "user", id], () => adminApi.user(id));
  const [changing, setChanging] = useState<"suspended" | "active" | null>(null);
  const [trust, setTrust] = useState(false);
  const status = useFpoMutation(
    ({ s, reason }: { s: "active" | "suspended"; reason: string }) =>
      adminApi.setUserStatus(id, s, reason),
    {
      success: (r) =>
        r.status === "suspended" ? t("User suspended and signed out") : t("User reactivated"),
      onSuccess: () => setChanging(null),
    },
  );
  const u: AdminUser | undefined = d.data?.user;
  return (
    <Modal
      open
      onClose={onClose}
      title={u?.name ?? "User"}
      subtitle={u ? `${u.role.toUpperCase()} · ${u.phone} · ${u.location || "—"}` : undefined}
      wide
    >
      <ErrorNote error={d.error} />
      {!d.data || !u ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              label={u.status}
              tone={u.status === "active" ? "green" : u.status === "suspended" ? "red" : "amber"}
            />
            {u.role === "buyer" && <VerifiedBadge verified={u.buyer_verified} />}
            {u.role === "buyer" && (
              <Badge label={`Trust ${u.trust_score.toFixed(1)} / 5`} tone="olive" />
            )}
            {d.data.fpo && (
              <Badge
                label={`${d.data.fpo.name}${d.data.fpo.verified ? " · verified" : " · not verified"}`}
                tone="olive"
              />
            )}
            {d.data.memberships.map((m) => (
              <Badge key={m.fpo} label={`Member: ${m.fpo}`} tone="gray" />
            ))}
          </div>
          {u.role !== "admin" && (
            <div className="flex flex-wrap gap-2">
              {u.status === "suspended" ? (
                <Btn onClick={() => setChanging("active")}>{t("Reactivate")}</Btn>
              ) : (
                <Btn variant="danger" onClick={() => setChanging("suspended")}>
                  {t("Suspend")}
                </Btn>
              )}
              {u.role === "buyer" && (
                <Btn variant="outline" onClick={() => setTrust(true)}>
                  {t("Adjust trust score")}
                </Btn>
              )}
            </div>
          )}
          <section>
            <h3 className="mb-2 font-serif text-xl">{t("Lots")}</h3>
            {d.data.lots.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("None")}</p>
            ) : (
              <Table head={["Lot", "Crop", "Quantity", "Quality", "Status"]}>
                {d.data.lots.map((l) => (
                  <tr key={l.id}>
                    <td className="font-mono text-sm">#{l.id}</td>
                    <td>{t(l.crop)}</td>
                    <td className="tabular-nums">{quintals(l.quantity_quintals)}</td>
                    <td>{l.quality}</td>
                    <td>
                      <Badge status={l.status} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
          <section>
            <h3 className="mb-2 font-serif text-xl">{t("Offers")}</h3>
            {d.data.offers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("None")}</p>
            ) : (
              <Table head={["Offer", "Lot", "Crop", "Price", "By", "Status"]}>
                {d.data.offers.map((o) => (
                  <tr key={o.id}>
                    <td className="font-mono text-sm">#{o.id}</td>
                    <td className="font-mono text-sm">#{o.lot_id}</td>
                    <td>{t(o.crop)}</td>
                    <td className="tabular-nums">{rupees(o.price_per_quintal)}/q</td>
                    <td>{o.created_by_role}</td>
                    <td>
                      <Badge status={o.status} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
          <section>
            <h3 className="mb-2 font-serif text-xl">{t("Transactions")}</h3>
            {d.data.transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("None")}</p>
            ) : (
              <Table head={["#", "Crop", "Quantity", "Price", "Buyer", "Farmer", "Date"]}>
                {d.data.transactions.map((x) => (
                  <tr key={x.id}>
                    <td className="font-mono text-sm">#{x.id}</td>
                    <td>{t(x.crop)}</td>
                    <td className="tabular-nums">{quintals(x.quantity_quintals)}</td>
                    <td className="tabular-nums">{rupees(x.price_per_quintal)}/q</td>
                    <td>{x.buyer}</td>
                    <td>{x.farmer}</td>
                    <td>{shortDate(x.completed_at)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
        </div>
      )}
      {changing && (
        <ReasonModal
          title={changing === "suspended" ? "Suspend this account" : "Reactivate this account"}
          subtitle={
            changing === "suspended"
              ? "The user is signed out everywhere and cannot sign in until reactivated."
              : undefined
          }
          submitLabel={changing === "suspended" ? "Suspend" : "Reactivate"}
          busy={status.isPending}
          onClose={() => setChanging(null)}
          onSubmit={(reason) => status.mutate({ s: changing, reason })}
        />
      )}
      {trust && u && (
        <TrustModal id={u.id} current={u.trust_score} onClose={() => setTrust(false)} />
      )}
    </Modal>
  );
}

function TrustModal({
  id,
  current,
  onClose,
}: {
  id: number;
  current: number;
  onClose: () => void;
}) {
  const [score, setScore] = useState(String(current));
  const [reason, setReason] = useState("");
  const save = useFpoMutation(() => adminApi.setTrust(id, Number(score), reason), {
    success: "Trust score updated",
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Adjust trust score"
      subtitle="0 to 5. The reason is saved in the audit log."
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Input
          id="trust-score"
          label="Trust score"
          type="number"
          min={0}
          max={5}
          step="0.1"
          required
          value={score}
          onChange={(e) => setScore(e.target.value)}
        />
        <TextArea
          id="trust-reason"
          label="Reason"
          required
          minLength={5}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <FormActions onCancel={onClose} submitLabel="Save" busy={save.isPending} />
      </form>
    </Modal>
  );
}

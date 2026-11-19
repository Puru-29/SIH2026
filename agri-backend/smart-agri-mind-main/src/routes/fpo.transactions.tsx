import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Calculator, FileText, IndianRupee, Receipt, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { openProtectedFile } from "@/services/api-client";
import {
  documentPath,
  fpoApi,
  type FpoPayment,
  type PaymentStatus,
  type Upload,
} from "@/services/fpo-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import {
  Badge,
  Btn,
  Card,
  ConfirmButton,
  Empty,
  ErrorNote,
  FileInput,
  FormActions,
  inputCls,
  Input,
  Loading,
  Meter,
  Modal,
  PageTitle,
  quintals,
  rupees,
  Select,
  shortDate,
  Stat,
  Table,
  today,
  VerifiedBadge,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/fpo/transactions")({
  component: TransactionsPage,
});

const STATUSES: { id: "" | PaymentStatus; label: string }[] = [
  { id: "", label: "All payments" },
  { id: "pending", label: "Pending" },
  { id: "advance_paid", label: "Advance paid" },
  { id: "partially_paid", label: "Partially paid" },
  { id: "fully_paid", label: "Fully paid" },
  { id: "disputed", label: "Disputed" },
];

function TransactionsPage() {
  const { t } = useI18n();
  const sales = useFpoQuery(["sales"], fpoApi.sales);
  const [filter, setFilter] = useState<"" | PaymentStatus>("");
  const [open, setOpen] = useState<number | null>(null);
  const all = sales.data ?? [];
  const list = all.filter((s) => !filter || s.payment_status === filter);
  const total = all.reduce((s, x) => s + x.amount, 0);
  const received = all.reduce((s, x) => s + x.received, 0);

  return (
    <>
      <PageTitle
        title="Transactions"
        subtitle="Every bulk sale with buyer payments received and farmer payments due."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Total sale value"
          value={rupees(total)}
          hint={`${all.length} ${t("sales")}`}
          icon={<IndianRupee className="h-5 w-5" />}
        />
        <Stat
          label="Received from buyers"
          value={rupees(received)}
          icon={<Wallet className="h-5 w-5" />}
        />
        <Stat
          label="Pending amount"
          value={rupees(total - received)}
          icon={<Receipt className="h-5 w-5" />}
        />
      </div>
      <select
        id="tx-filter"
        aria-label={t("Payment status")}
        value={filter}
        onChange={(e) => setFilter(e.target.value as "" | PaymentStatus)}
        className={`${inputCls} w-auto`}
      >
        {STATUSES.map((s) => (
          <option key={s.id} value={s.id}>
            {t(s.label)}
          </option>
        ))}
      </select>
      <ErrorNote error={sales.error} />
      <Card padded={false}>
        {sales.isLoading ? (
          <div className="px-6">
            <Loading />
          </div>
        ) : list.length === 0 ? (
          <Empty
            icon={<Wallet className="h-6 w-6" />}
            title="No transactions yet"
            body="A transaction is created when an offer is accepted."
          />
        ) : (
          <div className="p-3 md:p-4">
            <Table
              head={[
                "Date",
                "Buyer",
                "Lot ID",
                "Quantity",
                "Agreed price",
                "Amount",
                "Pending",
                "Payment",
                "Delivery",
                "",
              ]}
            >
              {list.map((s) => (
                <tr key={s.id}>
                  <td>{shortDate(s.created_at)}</td>
                  <td>
                    <p className="font-medium">{s.buyer_name}</p>
                    <VerifiedBadge verified={s.buyer_verified} />
                  </td>
                  <td className="font-mono text-sm">{s.lot_code}</td>
                  <td className="tabular-nums">{quintals(s.quantity_quintals)}</td>
                  <td className="tabular-nums">{rupees(s.price_per_quintal)}/q</td>
                  <td className="font-semibold tabular-nums">{rupees(s.amount)}</td>
                  <td className="tabular-nums">{rupees(s.pending_amount)}</td>
                  <td>
                    <Badge status={s.payment_status} />
                  </td>
                  <td>
                    <Badge status={s.delivery_status} />
                  </td>
                  <td>
                    <Btn size="sm" variant="outline" onClick={() => setOpen(s.id)}>
                      {t("Track Payment")}
                    </Btn>
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Card>
      {open !== null && <SaleModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function SaleModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useI18n();
  const detail = useFpoQuery(["sale", id], () => fpoApi.sale(id));
  const [paying, setPaying] = useState(false);
  const [payoutRef, setPayoutRef] = useState<{ id: number; name: string; net: number } | null>(
    null,
  );
  const sale = detail.data?.sale;

  return (
    <Modal
      open
      onClose={onClose}
      title={sale ? `${sale.buyer_name} · ${sale.lot_code}` : "Sale"}
      subtitle={
        sale
          ? `${quintals(sale.quantity_quintals)} ${t(sale.crop_name)} × ${rupees(sale.price_per_quintal)}/q`
          : undefined
      }
      wide
    >
      <ErrorNote error={detail.error} />
      {!detail.data || !sale ? (
        <Loading />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-secondary p-4">
              <p className="text-sm text-muted-foreground">{t("Sale amount")}</p>
              <p className="font-serif text-2xl">{rupees(sale.amount)}</p>
            </div>
            <div className="rounded-2xl bg-secondary p-4">
              <p className="text-sm text-muted-foreground">{t("Received")}</p>
              <p className="font-serif text-2xl">{rupees(sale.received)}</p>
            </div>
            <div className="rounded-2xl bg-secondary p-4">
              <p className="text-sm text-muted-foreground">{t("Pending")}</p>
              <p className="font-serif text-2xl">{rupees(sale.pending_amount)}</p>
            </div>
          </div>
          <Meter
            value={sale.received}
            max={sale.amount}
            tone={sale.payment_status === "disputed" ? "warn" : "primary"}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Badge status={sale.payment_status} />
            <Badge status={sale.delivery_status} />
            {sale.payment_terms && (
              <span className="text-sm text-muted-foreground">
                {t("Terms")}: {sale.payment_terms}
              </span>
            )}
          </div>
          {sale.payment_status === "disputed" && (
            <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {t(
                "This sale has an open grievance. Farmer payments are on hold until it is resolved.",
              )}
            </p>
          )}

          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-serif text-xl">{t("Buyer payments")}</h3>
              {sale.pending_amount > 0.01 && (
                <Btn icon={<Receipt className="h-4 w-4" />} onClick={() => setPaying(true)}>
                  {t("Record payment received")}
                </Btn>
              )}
            </div>
            {detail.data.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  "No payment recorded yet. Record a payment only after you see it in the bank account.",
                )}
              </p>
            ) : (
              <Table head={["Date", "Type", "Method", "Reference", "Amount", "Receipt"]}>
                {detail.data.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{shortDate(p.paid_on)}</td>
                    <td className="capitalize">
                      {t(
                        p.kind === "part"
                          ? "Part payment"
                          : p.kind === "final"
                            ? "Final payment"
                            : "Advance",
                      )}
                    </td>
                    <td className="uppercase">{p.method}</td>
                    <td className="font-mono text-sm">{p.reference || "—"}</td>
                    <td className="font-semibold tabular-nums">{rupees(p.amount)}</td>
                    <td>
                      {p.receipt_doc_id ? (
                        <Btn
                          size="sm"
                          variant="ghost"
                          icon={<FileText className="h-4 w-4" />}
                          onClick={() =>
                            openProtectedFile(documentPath(p.receipt_doc_id!)).catch((e: Error) =>
                              toast.error(e.message),
                            )
                          }
                        >
                          {t("Open")}
                        </Btn>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>

          <Expenses saleId={id} locked={sale.payout_count > 0} initial={sale} />

          <Distribution saleId={id} saved={sale.payout_count > 0} />

          {detail.data.payouts.length > 0 && (
            <section>
              <h3 className="mb-2 font-serif text-xl">{t("Farmer payments")}</h3>
              <Table head={["Farmer", "Share", "Gross", "Deductions", "Net payable", "Status", ""]}>
                {detail.data.payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.member_name}</td>
                    <td className="tabular-nums">{quintals(p.quantity_quintals)}</td>
                    <td className="tabular-nums">{rupees(p.gross)}</td>
                    <td className="tabular-nums">−{rupees(p.deductions)}</td>
                    <td className="font-semibold tabular-nums">{rupees(p.net)}</td>
                    <td>
                      <Badge status={p.status} />
                      {p.reference && (
                        <p className="font-mono text-xs text-muted-foreground">{p.reference}</p>
                      )}
                    </td>
                    <td>
                      {p.status === "due" && (
                        <Btn
                          size="sm"
                          disabled={sale.payment_status !== "fully_paid"}
                          title={
                            sale.payment_status !== "fully_paid"
                              ? t("Available after the buyer pays in full")
                              : undefined
                          }
                          onClick={() =>
                            setPayoutRef({ id: p.id, name: p.member_name, net: p.net })
                          }
                        >
                          {t("Mark paid")}
                        </Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
              {sale.payment_status !== "fully_paid" && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t(
                    "Farmers can be marked paid only after the buyer's full payment is received and there is no open dispute.",
                  )}
                </p>
              )}
            </section>
          )}
        </div>
      )}
      {paying && sale && (
        <PaymentModal
          saleId={id}
          pending={sale.pending_amount}
          hasPayments={(detail.data?.payments.length ?? 0) > 0}
          onClose={() => setPaying(false)}
        />
      )}
      {payoutRef && <PayoutModal payout={payoutRef} onClose={() => setPayoutRef(null)} />}
    </Modal>
  );
}

function Expenses({
  saleId,
  locked,
  initial,
}: {
  saleId: number;
  locked: boolean;
  initial: { transport_cost: number; storage_cost: number; handling_cost: number };
}) {
  const { t } = useI18n();
  const [f, setF] = useState({
    transport: String(initial.transport_cost),
    storage: String(initial.storage_cost),
    handling: String(initial.handling_cost),
  });
  const save = useFpoMutation(
    () =>
      fpoApi.updateExpenses(saleId, {
        transport_cost: Number(f.transport || 0),
        storage_cost: Number(f.storage || 0),
        handling_cost: Number(f.handling || 0),
      }),
    { success: "Expenses saved" },
  );
  return (
    <section>
      <h3 className="mb-1 font-serif text-xl">{t("Expenses for this sale")}</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        {t(
          "These are shared by farmers in proportion to their crop. Transport is filled in from the delivery estimate.",
        )}
      </p>
      <form
        className="grid gap-3 sm:grid-cols-4 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Input
          id="ex-t"
          label="Transport (₹)"
          type="number"
          min={0}
          disabled={locked}
          value={f.transport}
          onChange={(e) => setF({ ...f, transport: e.target.value })}
        />
        <Input
          id="ex-s"
          label="Storage (₹)"
          type="number"
          min={0}
          disabled={locked}
          value={f.storage}
          onChange={(e) => setF({ ...f, storage: e.target.value })}
        />
        <Input
          id="ex-h"
          label="Loading / handling (₹)"
          type="number"
          min={0}
          disabled={locked}
          value={f.handling}
          onChange={(e) => setF({ ...f, handling: e.target.value })}
        />
        <Btn type="submit" variant="outline" disabled={locked} busy={save.isPending}>
          {locked ? t("Locked") : t("Save expenses")}
        </Btn>
      </form>
    </section>
  );
}

function Distribution({ saleId, saved }: { saleId: number; saved: boolean }) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  const preview = useFpoQuery(
    ["distribution", saleId],
    () => fpoApi.distribution(saleId),
    show && !saved,
  );
  const create = useFpoMutation(() => fpoApi.createDistribution(saleId), {
    success: (r) => `${r.created} ${t("farmer payments calculated")}`,
  });
  if (saved) return null;
  return (
    <section className="rounded-2xl border border-dashed border-primary/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-serif text-xl">{t("Farmer payment distribution")}</h3>
          <p className="text-sm text-muted-foreground">
            {t(
              "Split the sale between farmers by their share of the lot, after expenses and the FPO service charge.",
            )}
          </p>
        </div>
        {!show && (
          <Btn
            variant="outline"
            icon={<Calculator className="h-4 w-4" />}
            onClick={() => setShow(true)}
          >
            {t("Preview")}
          </Btn>
        )}
      </div>
      {show && (
        <div className="mt-4">
          <ErrorNote error={preview.error} />
          {!preview.data ? (
            <Loading />
          ) : (
            <>
              <p className="mb-2 text-sm">
                {t("Expenses")}: {t("transport")} {rupees(preview.data.expenses.transport)} +{" "}
                {t("storage")} {rupees(preview.data.expenses.storage)} + {t("handling")}{" "}
                {rupees(preview.data.expenses.handling)} + {t("FPO service charge")}{" "}
                {preview.data.expenses.fpo_service_charge_pct}% (
                {rupees(preview.data.expenses.fpo_service_charge)})
              </p>
              <Table
                head={["Farmer", "Contributed", "Share", "Gross", "Deductions", "Net payable"]}
              >
                {preview.data.rows.map((r) => (
                  <tr key={r.contribution_id}>
                    <td className="font-medium">{r.member_name}</td>
                    <td className="tabular-nums">{quintals(r.contributed_quintals)}</td>
                    <td className="tabular-nums">{r.share_pct}%</td>
                    <td className="tabular-nums">{rupees(r.gross)}</td>
                    <td className="tabular-nums">−{rupees(r.deductions)}</td>
                    <td className="font-semibold tabular-nums">{rupees(r.net)}</td>
                  </tr>
                ))}
              </Table>
              <div className="mt-3 flex justify-end">
                <ConfirmButton
                  label="Save farmer payments"
                  busy={create.isPending}
                  confirmTitle="Save farmer payments?"
                  confirmBody="Expenses will be locked for this sale and each farmer's payable amount will be recorded."
                  onConfirm={() => create.mutate(undefined)}
                />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function PaymentModal({
  saleId,
  pending,
  hasPayments,
  onClose,
}: {
  saleId: number;
  pending: number;
  hasPayments: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [f, setF] = useState({
    amount: "",
    kind: (hasPayments ? "part" : "advance") as FpoPayment["kind"],
    method: "upi" as FpoPayment["method"],
    reference: "",
    paid_on: today(),
  });
  const [receipt, setReceipt] = useState<Upload | null>(null);
  const save = useFpoMutation(
    () =>
      fpoApi.recordPayment(saleId, {
        amount: Number(f.amount),
        kind: f.kind,
        method: f.method,
        reference: f.reference,
        paid_on: f.paid_on,
        receipt: receipt ?? undefined,
      }),
    {
      success: (s) => `${t("Payment recorded")} — ${t(s.payment_status.replace(/_/g, " "))}`,
      onSuccess: onClose,
    },
  );
  return (
    <Modal
      open
      onClose={onClose}
      title="Record payment received"
      subtitle={`${t("Pending")}: ${rupees(pending)}. ${t("Record only money you have confirmed in the bank account or cash in hand.")}`}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Input
          id="pay-amt"
          label="Amount received (₹)"
          type="number"
          min={1}
          max={pending}
          step="0.01"
          required
          value={f.amount}
          onChange={(e) => setF({ ...f, amount: e.target.value })}
        />
        <div className="flex flex-wrap gap-2">
          <Btn
            size="sm"
            variant="outline"
            onClick={() =>
              setF({ ...f, amount: String(Math.round(pending * 100) / 100), kind: "final" })
            }
          >
            {t("Full pending amount")}
          </Btn>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            id="pay-kind"
            label="Payment type"
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value as FpoPayment["kind"] })}
          >
            <option value="advance">{t("Advance")}</option>
            <option value="part">{t("Part payment")}</option>
            <option value="final">{t("Final payment")}</option>
          </Select>
          <Select
            id="pay-method"
            label="Payment method"
            value={f.method}
            onChange={(e) => setF({ ...f, method: e.target.value as FpoPayment["method"] })}
          >
            <option value="upi">UPI</option>
            <option value="neft">NEFT</option>
            <option value="rtgs">RTGS</option>
            <option value="cheque">{t("Cheque")}</option>
            <option value="cash">{t("Cash")}</option>
          </Select>
        </div>
        <Input
          id="pay-ref"
          label="UTR / transaction or cheque number"
          required={f.method !== "cash"}
          value={f.reference}
          onChange={(e) => setF({ ...f, reference: e.target.value })}
          hint="As shown in the bank statement"
        />
        <Input
          id="pay-date"
          label="Date received"
          type="date"
          required
          max={today()}
          value={f.paid_on}
          onChange={(e) => setF({ ...f, paid_on: e.target.value })}
        />
        <FileInput label="Receipt or bank slip (optional)" value={receipt} onChange={setReceipt} />
        <FormActions onCancel={onClose} submitLabel="Record payment" busy={save.isPending} />
      </form>
    </Modal>
  );
}

function PayoutModal({
  payout,
  onClose,
}: {
  payout: { id: number; name: string; net: number };
  onClose: () => void;
}) {
  const [ref, setRef] = useState("");
  const [date, setDate] = useState(today());
  const save = useFpoMutation(
    () => fpoApi.payPayout(payout.id, { reference: ref, paid_on: date }),
    { success: "Farmer payment marked as paid", onSuccess: onClose },
  );
  return (
    <Modal open onClose={onClose} title={`Pay ${payout.name}`} subtitle={`${rupees(payout.net)}`}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Input
          id="po-ref"
          label="UTR / transaction number"
          required
          minLength={4}
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        <Input
          id="po-date"
          label="Date paid"
          type="date"
          required
          max={today()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <FormActions onCancel={onClose} submitLabel="Mark paid" busy={save.isPending} />
      </form>
    </Modal>
  );
}

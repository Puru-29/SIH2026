/**
 * One farmer–buyer order: tracking timeline with the next step, payments
 * (buyer records, farmer confirms), and net realisation for the farmer.
 */

import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CheckCircle2, Circle, FileText, MapPin, Truck, Wallet } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Btn, FormActions, Input, Modal, Select, shortDate } from "@/components/fpo/fpo-ui";
import {
  useConfirmPayment,
  useOrderEvent,
  usePaymentNotReceived,
  useRecordPayment,
} from "@/hooks/use-market";
import type { OrderDetail, OrderPayment, OrderStep } from "@/services/api-client";
import { PaymentStatusPill } from "@/components/agri/deal-ui";
import { inrAmount, inrKg, ORDER_LABEL } from "@/lib/deal-format";

const STEP_HELP: Record<OrderStep, string> = {
  accepted: "Deal agreed",
  picked_up: "Crop loaded at the farm or mandi",
  in_transit: "On the way to the buyer",
  delivered: "Received by the buyer",
};

const METHOD_LABEL: Record<OrderPayment["method"], string> = {
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cash: "Cash",
  cheque: "Cheque",
};

/* --------------------------------- timeline -------------------------------- */

export function OrderTimeline({ detail }: { detail: OrderDetail }) {
  const { t } = useI18n();
  const move = useOrderEvent();
  const [next, setNext] = useState<OrderStep | null>(null);
  const [note, setNote] = useState("");
  const reached = detail.steps.indexOf(detail.current_step);
  const role = detail.my_role;
  const allowed = (s: OrderStep) =>
    detail.steps.indexOf(s) > reached &&
    (role === "farmer" || (role === "buyer" && s === "delivered"));
  const nextSteps = detail.steps.filter(allowed);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!next) return;
    move.mutate(
      {
        transactionId: detail.order.id,
        status: next,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast.success(`${t("Order marked as")} ${t(ORDER_LABEL[next] ?? next).toLowerCase()}`);
          setNext(null);
          setNote("");
        },
        onError: (err) =>
          toast.error(t("Could not update the order"), { description: err.message }),
      },
    );
  }

  return (
    <div>
      <ol className="space-y-4">
        {detail.steps.map((s, i) => {
          const event = detail.events.find((e) => e.status === s);
          const done = i <= reached;
          return (
            <li key={s} className="flex gap-3">
              {done ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              ) : (
                <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <p className={cn("font-medium", !done && "text-muted-foreground")}>
                  {t(ORDER_LABEL[s] ?? s)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {event
                    ? `${shortDate(event.created_at)}${event.created_by_name ? ` · ${event.created_by_name}` : ""}${event.note ? ` · ${event.note}` : ""}`
                    : t(STEP_HELP[s])}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {nextSteps.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {nextSteps.map((s) => (
            <Btn
              key={s}
              size="sm"
              variant={s === nextSteps[0] ? "primary" : "outline"}
              onClick={() => setNext(s)}
            >
              {t("Mark")} {t(ORDER_LABEL[s] ?? s).toLowerCase()}
            </Btn>
          ))}
        </div>
      )}
      {role === "buyer" && reached < 1 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("The farmer marks pickup and transit; you confirm delivery.")}
        </p>
      )}
      <Modal
        open={next !== null}
        onClose={() => setNext(null)}
        title={`${t("Mark")} ${t(ORDER_LABEL[next ?? "accepted"] ?? "").toLowerCase()}`}
        subtitle={`${t("Order")} #${detail.order.id} · ${t(detail.order.crop_name)}`}
      >
        <form onSubmit={submit}>
          <Input
            label="Note (optional)"
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("For example: truck number, or received in good condition")}
          />
          <FormActions onCancel={() => setNext(null)} submitLabel="Save" busy={move.isPending} />
        </form>
      </Modal>
    </div>
  );
}

/* --------------------------------- payments -------------------------------- */

export function OrderPayments({ detail }: { detail: OrderDetail }) {
  const { t } = useI18n();
  const order = detail.order;
  const record = useRecordPayment();
  const confirm = useConfirmPayment();
  const notReceived = usePaymentNotReceived();
  const unpaid = Math.max(0, order.total_amount - order.paid_confirmed - order.paid_awaiting);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<OrderPayment["method"]>("upi");
  const [reference, setReference] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    record.mutate(
      {
        transactionId: order.id,
        amount: Number(amount),
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast.success(t("Payment recorded"), {
            description: t("The farmer will confirm when it reaches their account."),
          });
          setOpen(false);
          setReference("");
        },
        onError: (err) => toast.error(t("Could not record payment"), { description: err.message }),
      },
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <PaymentStatusPill status={order.payment_status} />
          <span className="text-sm text-muted-foreground">
            {inrAmount(order.paid_confirmed)} {t("of")} {inrAmount(order.total_amount)}{" "}
            {t("received")}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {detail.my_role === "buyer" && unpaid > 0.5 && (
            <Btn
              size="sm"
              icon={<Wallet className="h-4 w-4" />}
              onClick={() => {
                setAmount(String(Math.round(unpaid)));
                setOpen(true);
              }}
            >
              {t("Mark payment as made")}
            </Btn>
          )}
          <Link
            to="/invoice/$id"
            params={{ id: String(order.id) }}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm hover:bg-secondary"
          >
            <FileText className="h-4 w-4" /> {t("Invoice")}
          </Link>
        </div>
      </div>

      {detail.payments.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {detail.my_role === "buyer"
            ? t("No payment recorded yet. Record each transfer so the farmer can confirm it.")
            : t("No payment recorded by the buyer yet.")}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-2xl border border-border">
          {detail.payments.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {inrAmount(p.amount)} · {t(METHOD_LABEL[p.method])}
                  {p.reference ? ` · ${p.reference}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("Paid")} {shortDate(p.paid_at)}
                  {p.confirmed_at ? ` · ${t("confirmed")} ${shortDate(p.confirmed_at)}` : ""}
                  {p.note ? ` · ${p.note}` : ""}
                </p>
              </div>
              {p.status === "marked_paid" && detail.my_role === "farmer" ? (
                <div className="flex gap-2">
                  <Btn
                    size="sm"
                    busy={confirm.isPending}
                    onClick={() =>
                      confirm.mutate(p.id, {
                        onSuccess: () => toast.success(t("Payment confirmed")),
                        onError: (err) =>
                          toast.error(t("Could not confirm"), { description: err.message }),
                      })
                    }
                  >
                    {t("Confirm received")}
                  </Btn>
                  <Btn
                    size="sm"
                    variant="ghost"
                    busy={notReceived.isPending}
                    onClick={() =>
                      notReceived.mutate(
                        { paymentId: p.id },
                        {
                          onSuccess: () =>
                            toast.success(t("Buyer told the payment has not arrived")),
                          onError: (err) =>
                            toast.error(t("Could not update"), { description: err.message }),
                        },
                      )
                    }
                  >
                    {t("Not received")}
                  </Btn>
                </div>
              ) : (
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium",
                    p.status === "confirmed" && "bg-accent text-accent-foreground",
                    p.status === "marked_paid" && "bg-amber-tag/20 text-amber-tag",
                    p.status === "not_received" && "bg-clay/15 text-clay",
                  )}
                >
                  {t(
                    p.status === "confirmed"
                      ? "Confirmed"
                      : p.status === "marked_paid"
                        ? "Waiting for farmer"
                        : "Not received",
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("Mark payment as made")}
        subtitle={`${t("Order")} #${order.id} · ${inrAmount(unpaid)} ${t("still unpaid")}`}
      >
        <form onSubmit={submit} className="space-y-3">
          <Input
            label="Amount (₹)"
            type="number"
            min={1}
            step="any"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Select
            label="Payment method"
            value={method}
            onChange={(e) => setMethod(e.target.value as OrderPayment["method"])}
          >
            {(Object.keys(METHOD_LABEL) as OrderPayment["method"][]).map((m) => (
              <option key={m} value={m}>
                {t(METHOD_LABEL[m])}
              </option>
            ))}
          </Select>
          <Input
            label="UTR / transaction or cheque number"
            maxLength={60}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <FormActions
            onCancel={() => setOpen(false)}
            submitLabel="Save payment"
            busy={record.isPending}
          />
        </form>
      </Modal>
    </div>
  );
}

/* ------------------------------ net realisation ----------------------------- */

export function NetRealisationCard({ detail }: { detail: OrderDetail }) {
  const { t } = useI18n();
  const n = detail.net_realisation;
  const o = detail.order;
  const rows: [string, string][] = [
    [
      `${t("Gross value")} (${o.quantity_quintals} q × ${inrKg(o.final_price)})`,
      inrAmount(n.gross),
    ],
    [
      n.freight_known
        ? `${t("Freight")} (${inrKg(n.freight_per_quintal)})`
        : `${t("Freight")} (${t("rate not known")})`,
      `− ${inrAmount(n.transport)}`,
    ],
    [`${t("Platform fee")} (${n.platform_fee_percent}%)`, `− ${inrAmount(n.platform_fee)}`],
  ];
  return (
    <div>
      <dl className="space-y-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-border pb-3">
            <dt className="text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 pt-2">
          <dt className="font-medium">{t("Net realisation")}</dt>
          <dd className="text-right">
            <span className="font-serif text-2xl">{inrAmount(n.net)}</span>
            <span className="block text-xs text-muted-foreground">{inrKg(n.net_per_quintal)}</span>
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">{t(detail.freight_note)}</p>
    </div>
  );
}

/* --------------------------------- route card ------------------------------- */

export function RouteSummary({ detail }: { detail: OrderDetail }) {
  const { t } = useI18n();
  const o = detail.order;
  // Full-width rows: readable at any panel width (a 3-column grid wrapped badly in narrow panels).
  const rows: [typeof MapPin, string, string, boolean][] = [
    [MapPin, "Pickup", o.pickup_location || t("Farmer's location not set"), !o.pickup_location],
    [MapPin, "Drop", o.delivery_location || t("Buyer's location not set"), !o.delivery_location],
    [
      Truck,
      "Freight",
      detail.net_realisation.freight_known
        ? `${inrKg(detail.net_realisation.freight_per_quintal)} · ${inrAmount(detail.net_realisation.transport)}`
        : t("Not known for this route"),
      !detail.net_realisation.freight_known,
    ],
  ];
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border text-sm">
      {rows.map(([Icon, label, value, missing]) => (
        <li key={label} className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
            <Icon className="h-4 w-4" /> {t(label)}
          </span>
          <span
            className={cn("min-w-0 text-right", missing ? "text-muted-foreground" : "font-medium")}
          >
            {value}
          </span>
        </li>
      ))}
    </ul>
  );
}

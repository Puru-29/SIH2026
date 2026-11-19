import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BarChart3, Download, Printer } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { fpoApi, type Report, type ReportKind } from "@/services/fpo-api";
import { useFpoQuery } from "@/hooks/use-fpo";
import {
  Btn,
  Card,
  Empty,
  ErrorNote,
  Input,
  Loading,
  PageTitle,
  Table,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/fpo/reports")({
  component: ReportsPage,
});

const REPORTS: { id: ReportKind; title: string; body: string }[] = [
  {
    id: "monthly_sales",
    title: "Monthly sales",
    body: "Deals, quantity, value and money received per month.",
  },
  {
    id: "farmer_contributions",
    title: "Farmer contributions",
    body: "Crop given by each farmer and what they have earned.",
  },
  {
    id: "inventory",
    title: "Crop aggregation & inventory",
    body: "Every bulk lot with available, reserved and sold stock.",
  },
  {
    id: "buyer_transactions",
    title: "Buyer transactions",
    body: "Each sale with buyer, price, payment and delivery status.",
  },
  {
    id: "payments",
    title: "Payments received",
    body: "Every buyer payment with method and reference.",
  },
  {
    id: "profit_expense",
    title: "Profit & expenses",
    body: "Sale value, expenses, FPO service charge and net to farmers.",
  },
];

function toCsv(r: Report) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [r.columns, ...r.rows].map((row) => row.map(esc).join(",")).join("\r\n");
}

function ReportsPage() {
  const { t } = useI18n();
  const [kind, setKind] = useState<ReportKind>("monthly_sales");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const report = useFpoQuery(["report", kind, from, to], () =>
    fpoApi.report(kind, from || undefined, to || undefined),
  );

  const download = () => {
    if (!report.data) return;
    // Excel opens UTF-8 CSV correctly with a BOM (needed for ₹ and Hindi names).
    const blob = new Blob(["﻿" + toCsv(report.data)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${kind}${from ? `_${from}` : ""}${to ? `_${to}` : ""}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };

  return (
    <>
      <PageTitle
        title="Reports"
        subtitle="Download reports for your members, board meetings and auditors."
      />
      <div className="no-print grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((r) => (
          <button
            key={r.id}
            onClick={() => setKind(r.id)}
            aria-pressed={kind === r.id}
            className={cn(
              "fpo-card p-5 text-left transition-colors",
              kind === r.id ? "ring-2 ring-primary" : "hover:bg-secondary",
            )}
          >
            <p className="text-lg font-semibold">{t(r.title)}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t(r.body)}</p>
          </button>
        ))}
      </div>
      <div className="no-print flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Input
            id="rp-from"
            label="From"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="w-44">
          <Input
            id="rp-to"
            label="To"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Btn
          variant="outline"
          icon={<Download className="h-4 w-4" />}
          disabled={!report.data?.rows.length}
          onClick={download}
        >
          {t("Download CSV")}
        </Btn>
        <Btn
          variant="outline"
          icon={<Printer className="h-4 w-4" />}
          disabled={!report.data?.rows.length}
          onClick={() => window.print()}
        >
          {t("Print / Save as PDF")}
        </Btn>
      </div>
      <ErrorNote error={report.error} />
      <Card
        title={report.data ? `${t(report.data.title)} — ${report.data.fpo}` : undefined}
        subtitle={from || to ? `${from || "…"} → ${to || "…"}` : t("All dates")}
      >
        {report.isLoading ? (
          <Loading />
        ) : !report.data?.rows.length ? (
          <Empty icon={<BarChart3 className="h-6 w-6" />} title="No data for this report yet" />
        ) : (
          <Table head={report.data.columns}>
            {report.data.rows.map((row, i) => (
              <tr key={i}>
                {row.map((c, j) => (
                  <td key={j} className={typeof c === "number" ? "tabular-nums" : undefined}>
                    {c === null
                      ? "—"
                      : typeof c === "number"
                        ? c.toLocaleString("en-IN", { maximumFractionDigits: 2 })
                        : t(String(c).replace(/_/g, " "))}
                  </td>
                ))}
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { BadgeCheck, Boxes, ClipboardList, IndianRupee, Scale, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { adminApi } from "@/services/admin-api";
import { useFpoQuery } from "@/hooks/use-fpo";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Card,
  Empty,
  ErrorNote,
  Loading,
  PageTitle,
  quintals,
  rupees,
  Stat,
  Table,
} from "@/components/fpo/fpo-ui";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/")({
  component: Overview,
});

const gmvConfig = {
  gmv: { label: "GMV (₹)", color: "oklch(0.38 0.06 172)" },
} satisfies ChartConfig;
const regConfig = {
  count: { label: "New users", color: "oklch(0.65 0.13 70)" },
} satisfies ChartConfig;

function Overview() {
  const { t } = useI18n();
  const { data, isLoading, error } = useFpoQuery(["admin", "overview"], adminApi.overview);
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorNote error={error} />;

  const roles = ["farmer", "buyer", "fpo", "admin"].map((role) => ({
    role,
    total: data.users_by_role.filter((r) => r.role === role).reduce((s, r) => s + r.count, 0),
    pending: data.users_by_role.find((r) => r.role === role && r.status === "pending")?.count ?? 0,
    suspended:
      data.users_by_role.find((r) => r.role === role && r.status === "suspended")?.count ?? 0,
    new: data.new_this_week.find((r) => r.role === role)?.count ?? 0,
  }));
  const pending = data.pending_verifications.fpos + data.pending_verifications.buyers;
  const gmv = data.gmv_by_month.map((m) => ({
    ...m,
    label: new Date(`${m.month}-01T00:00:00`).toLocaleDateString("en-IN", {
      month: "short",
      year: "2-digit",
    }),
  }));
  const regs = data.registrations_by_week.map((w) => ({
    ...w,
    label: new Date(`${w.week}T00:00:00`).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
    }),
  }));

  return (
    <>
      <PageTitle
        title="Platform overview"
        subtitle="Who is using AgriSense, what is being traded, and what needs an administrator."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat
          label="Gross merchandise value"
          value={rupees(data.transactions.gmv)}
          hint={`${data.transactions.farmer} ${t("farmer deals")} · ${data.transactions.fpo} ${t("FPO bulk deals")}`}
          icon={<IndianRupee className="h-5 w-5" />}
        />
        <Stat
          label="Active lots"
          value={data.active_lots.farmer + data.active_lots.fpo}
          hint={`${quintals(data.active_lots.farmer_quintals + data.active_lots.fpo_quintals)} ${t("on offer")}`}
          icon={<Boxes className="h-5 w-5" />}
        />
        <Stat
          label="Open buyer demand"
          value={data.open_demands.count}
          hint={quintals(data.open_demands.quintals)}
          icon={<ClipboardList className="h-5 w-5" />}
        />
        <Link to="/admin/verification" className="block">
          <Stat
            label="Pending verifications"
            value={pending}
            hint={`${data.pending_verifications.fpos} ${t("FPOs")} · ${data.pending_verifications.buyers} ${t("buyers")}`}
            icon={<BadgeCheck className="h-5 w-5" />}
          />
        </Link>
        <Link to="/admin/disputes" className="block">
          <Stat
            label="Open disputes"
            value={data.open_disputes}
            icon={<Scale className="h-5 w-5" />}
          />
        </Link>
        <Stat
          label="New registrations this week"
          value={roles.reduce((s, r) => s + r.new, 0)}
          icon={<Users className="h-5 w-5" />}
        />
      </div>

      <Card title="Users by role">
        <Table head={["Role", "Total", "New this week", "Pending", "Suspended"]}>
          {roles.map((r) => (
            <tr key={r.role}>
              <td className="font-medium capitalize">{t(r.role === "fpo" ? "FPO" : r.role)}</td>
              <td className="tabular-nums">{r.total}</td>
              <td className="tabular-nums">{r.new}</td>
              <td className="tabular-nums">{r.pending}</td>
              <td className={cn("tabular-nums", r.suspended > 0 && "text-destructive")}>
                {r.suspended}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Traded value by month"
          subtitle="Farmer deals and FPO bulk deals, last 6 months"
        >
          {gmv.length === 0 ? (
            <Empty title="No deals yet" />
          ) : (
            <ChartContainer config={gmvConfig} className="h-64 w-full">
              <BarChart data={gmv} margin={{ left: 8, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `₹${Math.round(v / 1000)}k`}
                  width={56}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="gmv" fill="var(--color-gmv)" radius={6} isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
          )}
        </Card>
        <Card title="New registrations by week" subtitle="Last 8 weeks, all roles">
          {regs.length === 0 ? (
            <Empty title="No new registrations" />
          ) : (
            <ChartContainer config={regConfig} className="h-64 w-full">
              <LineChart data={regs} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  dataKey="count"
                  stroke="var(--color-count)"
                  strokeWidth={2.5}
                  dot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
          )}
        </Card>
      </div>

      <Card
        title="Price realised vs mandi"
        subtitle={`${t("Average price on AgriSense deals compared with today's mandi modal price in")} ${data.mandi_state}.`}
      >
        {data.price_vs_mandi.length === 0 ? (
          <Empty title="No completed deals yet" />
        ) : (
          <Table
            head={["Crop", "Traded", "Realised (₹/q)", "Mandi modal today (₹/q)", "Difference"]}
          >
            {data.price_vs_mandi.map((p) => (
              <tr key={p.crop}>
                <td className="font-medium">{t(p.crop)}</td>
                <td className="tabular-nums">{quintals(p.quantity_quintals)}</td>
                <td className="tabular-nums">{rupees(p.realised_per_quintal)}</td>
                <td className="tabular-nums">
                  {p.mandi_modal != null ? (
                    rupees(p.mandi_modal)
                  ) : (
                    <span className="text-muted-foreground">{t("Not available")}</span>
                  )}
                </td>
                <td
                  className={cn(
                    "tabular-nums font-medium",
                    p.difference_pct != null &&
                      (p.difference_pct >= 0 ? "text-[var(--fpo-good)]" : "text-destructive"),
                  )}
                >
                  {p.difference_pct != null
                    ? `${p.difference_pct >= 0 ? "+" : ""}${p.difference_pct}%`
                    : "—"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

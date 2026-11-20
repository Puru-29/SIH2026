import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  Boxes,
  Check,
  Handshake,
  IndianRupee,
  Layers,
  Plus,
  Search,
  Truck,
  Users,
  Wallet,
  Wheat,
  X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fpoApi } from "@/services/fpo-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorNote,
  Loading,
  quintals,
  rupees,
  shortDate,
  Stat,
  tonnes,
} from "@/components/fpo/fpo-ui";
import { cn } from "@/lib/utils";
import { PoolCard } from "@/components/fpo/pool-ui";

export const Route = createFileRoute("/fpo/")({
  component: FpoDashboard,
});

const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  fontSize: 13,
};

function FpoDashboard() {
  const { t } = useI18n();
  const { data, isLoading, error } = useFpoQuery(["dashboard"], fpoApi.dashboard);
  const review = useFpoMutation(
    ({ id, action }: { id: number; action: "approve" | "reject" }) =>
      fpoApi.reviewContribution(id, action),
    {
      success: (r) =>
        r.status === "approved" ? t("Contribution approved") : t("Contribution rejected"),
    },
  );

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorNote error={error} />;

  const stock = data.stock_by_crop.map((s) => ({
    crop: s.crop,
    [t("Available")]: +(s.available / 10).toFixed(2),
    [t("Reserved")]: +(s.reserved / 10).toFixed(2),
    [t("Sold")]: +(s.sold / 10).toFixed(2),
  }));
  const sales = data.sales_by_month.map((m) => ({
    month: new Date(`${m.month}-01T00:00:00`).toLocaleDateString("en-IN", {
      month: "short",
      year: "2-digit",
    }),
    revenue: m.revenue,
    quantity: +(m.quantity / 10).toFixed(2),
  }));

  return (
    <>
      <section className="fpo-hero overflow-hidden rounded-[1.75rem] p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-sm uppercase tracking-[0.16em] text-white/70">
              {t("FPO dashboard")}
            </p>
            <h1 className="mt-2 font-serif text-3xl text-white md:text-4xl">{data.org.name}</h1>
            <p className="mt-2 max-w-xl text-base text-white/80">
              {[data.org.district, data.org.state].filter(Boolean).join(", ")}
              {data.org.verified ? (
                <span className="ml-2 rounded-full bg-white/15 px-2.5 py-0.5 text-sm">
                  ✓ {t("Verified FPO")}
                </span>
              ) : (
                <span className="ml-2 rounded-full bg-[var(--fpo-gold)] px-2.5 py-0.5 text-sm font-semibold text-[var(--fpo-gold-ink)]">
                  {t("Verification pending")}
                </span>
              )}
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2.5 sm:w-auto sm:grid-cols-4">
            {[
              { to: "/fpo/farmers", label: "Add Farmer", icon: Users },
              { to: "/fpo/aggregation", label: "Add Crop", icon: Plus },
              { to: "/fpo/aggregation", label: "Combine Crops", icon: Layers },
              { to: "/fpo/market", label: "Find Buyers", icon: Search },
            ].map((a) => (
              <Link
                key={a.label}
                to={a.to}
                className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl bg-white/12 px-3 text-center text-sm font-medium text-white transition-colors hover:bg-white/20"
              >
                <a.icon className="h-5 w-5 text-[var(--fpo-gold)]" />
                {t(a.label)}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {data.demand_highlights.length > 0 && (
        <Card
          title="Buyers are asking for"
          subtitle="Open buyer requirements for crops you pool or stock."
        >
          <ul className="grid gap-3 md:grid-cols-2">
            {data.demand_highlights.map((h, i) => (
              <li
                key={i}
                className={cn(
                  "rounded-2xl border p-4",
                  h.can_cover
                    ? "border-[var(--fpo-good)]/40 bg-[var(--fpo-good-soft)]"
                    : "border-border",
                )}
              >
                <p className="text-base">
                  <strong>{h.buyer}</strong> {t("wants")}{" "}
                  <strong>{quintals(h.quantity_quintals)}</strong> {h.quality} {t(h.crop)} {t("in")}{" "}
                  {h.location} {t("by")} {shortDate(h.required_by)}
                  <span className="text-muted-foreground">
                    {" "}
                    · {t("up to")} {rupees(h.max_price)}/q
                  </span>
                </p>
                <p className="mt-1 text-sm">
                  {t("You have")} <strong>{quintals(h.pledged_quintals)}</strong> {t("pledged")}{" "}
                  {t("and")} <strong>{quintals(h.in_stock_quintals)}</strong> {t("in stock")}.{" "}
                  {h.can_cover
                    ? t("Enough to supply this buyer.")
                    : t("Collect more to supply this buyer.")}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.pools.length > 0 && (
        <Card
          title="Active pools"
          action={
            <Link
              to="/fpo/aggregation"
              className="text-sm font-medium text-primary hover:underline"
            >
              {t("View all")}
            </Link>
          }
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {data.pools.slice(0, 4).map((p) => (
              <PoolCard key={p.id} pool={p} />
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat
          label="Registered farmers"
          value={data.farmers}
          hint={t("Active members")}
          icon={<Users className="h-5 w-5" />}
        />
        <Stat
          label="Crop stock available"
          value={tonnes(data.available_quintals)}
          hint={`${quintals(data.available_quintals)} · ${t("Reserved")} ${tonnes(data.reserved_quintals)}`}
          icon={<Boxes className="h-5 w-5" />}
        />
        <Stat
          label="Active buyer offers"
          value={data.active_offers}
          hint={t("Open negotiations")}
          icon={<Handshake className="h-5 w-5" />}
        />
        <Stat
          label="Total sales"
          value={rupees(data.revenue)}
          hint={`${t("Received")} ${rupees(data.received)}`}
          icon={<IndianRupee className="h-5 w-5" />}
        />
        <Stat
          label="Pending payments"
          value={rupees(data.pending_payments)}
          hint={t("Still to be received from buyers")}
          icon={<Wallet className="h-5 w-5" />}
        />
        <Stat
          label="Active bulk deals"
          value={data.active_deals}
          hint={t("Not yet delivered or fully paid")}
          icon={<Truck className="h-5 w-5" />}
        />
      </div>

      {data.notifications.length > 0 && (
        <Card title="Needs your attention">
          <ul className="grid gap-2 md:grid-cols-2">
            {data.notifications.map((n, i) => (
              <li key={i}>
                <Link
                  to={n.link as "/fpo"}
                  className="flex items-center gap-3 rounded-xl border border-border p-3.5 text-[0.95rem] hover:bg-secondary"
                >
                  <span
                    className={cn(
                      "h-2.5 w-2.5 shrink-0 rounded-full",
                      n.tone === "bad"
                        ? "bg-destructive"
                        : n.tone === "warn"
                          ? "bg-[var(--fpo-warn)]"
                          : "bg-primary",
                    )}
                  />
                  <span className="flex-1">{n.message}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Crop stock" subtitle="In metric tonnes (MT)">
          {stock.length === 0 ? (
            <Empty
              icon={<Wheat className="h-6 w-6" />}
              title="No bulk lots yet"
              body="Combine approved crop contributions to create your first lot."
            />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stock} margin={{ left: -12, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="crop" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  <Bar dataKey={t("Available")} stackId="s" fill="oklch(0.43 0.09 118)" />
                  <Bar dataKey={t("Reserved")} stackId="s" fill="oklch(0.8 0.14 82)" />
                  <Bar
                    dataKey={t("Sold")}
                    stackId="s"
                    fill="oklch(0.3 0.06 150)"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card title="Sales and revenue" subtitle="Last 6 months">
          {sales.length === 0 ? (
            <Empty
              icon={<IndianRupee className="h-6 w-6" />}
              title="No sales yet"
              body="Accepted buyer offers will show here."
            />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={sales} margin={{ left: 4, right: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                  <YAxis
                    yAxisId="r"
                    tick={{ fontSize: 12 }}
                    stroke="var(--muted-foreground)"
                    tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
                  />
                  <YAxis
                    yAxisId="q"
                    orientation="right"
                    tick={{ fontSize: 12 }}
                    stroke="var(--muted-foreground)"
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  <Bar
                    yAxisId="r"
                    dataKey="revenue"
                    name={t("Revenue (₹)")}
                    fill="oklch(0.43 0.09 118)"
                    radius={[6, 6, 0, 0]}
                  />
                  <Line
                    yAxisId="q"
                    dataKey="quantity"
                    name={t("Quantity (MT)")}
                    stroke="oklch(0.7 0.15 75)"
                    strokeWidth={2.5}
                    dot={{ r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Pending crop contributions"
          subtitle="Approve before combining into a lot"
          action={
            <Link
              to="/fpo/aggregation"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("View all")}
            </Link>
          }
        >
          {data.pending_contributions.length === 0 ? (
            <Empty
              title="Nothing waiting"
              body="New contributions you record will appear here for approval."
            />
          ) : (
            <ul className="divide-y divide-border">
              {data.pending_contributions.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {c.member_name} · {t(c.crop_name)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {quintals(c.quantity_quintals)} · {t("Harvest")} {shortDate(c.harvest_date)}
                    </p>
                  </div>
                  <Btn
                    size="sm"
                    icon={<Check className="h-4 w-4" />}
                    busy={review.isPending}
                    onClick={() => review.mutate({ id: c.id, action: "approve" })}
                  >
                    {t("Approve")}
                  </Btn>
                  <Btn
                    size="sm"
                    variant="danger"
                    icon={<X className="h-4 w-4" />}
                    onClick={() => review.mutate({ id: c.id, action: "reject" })}
                  >
                    {t("Reject")}
                  </Btn>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Recent buyer offers"
          action={
            <Link
              to="/fpo/marketplace"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("Compare offers")}
            </Link>
          }
        >
          {data.recent_offers.length === 0 ? (
            <Empty
              title="No offers yet"
              body="Use Find Buyers to send your lot to matching buyers."
            />
          ) : (
            <ul className="divide-y divide-border">
              {data.recent_offers.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{o.buyer_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {o.lot_code} · {quintals(o.quantity_quintals)} · {rupees(o.price_per_quintal)}
                      /q
                    </p>
                  </div>
                  {o.status === "open" ? (
                    <Badge
                      label={o.awaiting === "fpo" ? "Your reply needed" : "Waiting for buyer"}
                      tone={o.awaiting === "fpo" ? "amber" : "gray"}
                    />
                  ) : (
                    <Badge status={o.status} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Recent transactions"
          action={
            <Link
              to="/fpo/transactions"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("Track Payment")}
            </Link>
          }
        >
          {data.recent_sales.length === 0 ? (
            <Empty title="No sales yet" />
          ) : (
            <ul className="divide-y divide-border">
              {data.recent_sales.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {s.buyer_name} · {rupees(s.amount)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {s.lot_code} · {quintals(s.quantity_quintals)} · {t("Pending")}{" "}
                      {rupees(s.pending_amount)}
                    </p>
                  </div>
                  <Badge status={s.payment_status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Upcoming deliveries"
          action={
            <Link
              to="/fpo/logistics"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("Arrange Transport")}
            </Link>
          }
        >
          {data.upcoming_shipments.length === 0 ? (
            <Empty title="No deliveries planned" />
          ) : (
            <ul className="divide-y divide-border">
              {data.upcoming_shipments.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {s.buyer_name} · {shortDate(s.expected_date)}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {s.lot_code} · {s.vehicle_number ?? t("Buyer pickup")} · {s.delivery_address}
                    </p>
                  </div>
                  <Badge status={s.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

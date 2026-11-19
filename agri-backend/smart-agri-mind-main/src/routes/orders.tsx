import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Handshake,
  IndianRupee,
  Loader2,
  Package,
  Scale,
  Search,
  UserCheck,
  Users,
} from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { inr, kg } from "@/services";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { cropEmoji } from "@/lib/crop-catalog";
import { getSession } from "@/services/session";
import { useTransactions, type BackendTransaction } from "@/hooks/use-transactions";

export const Route = createFileRoute("/orders")({
  head: () => ({
    meta: [
      { title: "Order Tracking — AgriSense" },
      {
        name: "description",
        content: "Track every consignment from accepted offer to released payment.",
      },
      { property: "og:title", content: "Order Tracking — AgriSense" },
      {
        property: "og:description",
        content: "Follow pickup, transit, delivery and settlement in one timeline.",
      },
    ],
  }),
  component: Orders,
});

/** final_price is ₹/quintal; quantity is in quintals. */
const orderValue = (tx: BackendTransaction) => tx.final_price * tx.quantity_quintals;

/** SQLite CURRENT_TIMESTAMP is UTC "YYYY-MM-DD HH:MM:SS". */
function formatDate(value: string) {
  const d = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Orders() {
  const { t } = useI18n();
  const session = getSession();
  const myRole: "farmer" | "buyer" = session?.role === "buyer" ? "buyer" : "farmer";
  const otherRole = myRole === "farmer" ? "buyer" : "farmer";
  const [query, setQuery] = useState("");

  const { data: transactions = [], isLoading, error } = useTransactions();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter((tx) =>
      [tx.crop_name, tx.buyer_name, tx.farmer_name, `#${tx.id}`, `lot-${tx.lot_id}`].some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
  }, [transactions, query]);

  const acceptedByMe = filtered.filter((tx) => tx.accepted_by_role === myRole);
  const acceptedByThem = filtered.filter((tx) => tx.accepted_by_role !== myRole);

  const totalValue = transactions.reduce((sum, tx) => sum + orderValue(tx), 0);
  const totalQuintals = transactions.reduce((sum, tx) => sum + tx.quantity_quintals, 0);
  const avgPerKg = totalQuintals > 0 ? totalValue / (totalQuintals * 100) : 0;

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Orders"
        title="Order tracking"
        description="Every accepted offer in one place — split by who accepted the deal."
        action={
          <Link
            to={myRole === "buyer" ? "/browse-produce" : "/buyers"}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm transition-colors hover:bg-secondary"
          >
            <Handshake className="h-4 w-4" />{" "}
            {myRole === "buyer" ? t("Browse produce") : t("Find buyers")}
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Accepted orders"
          value={transactions.length}
          hint={`${acceptedByMe.length} by you · ${acceptedByThem.length} by ${otherRole}s`}
          icon={<Package className="h-4 w-4" />}
        />
        <Metric
          label="Order value"
          value={inr(totalValue)}
          hint="At agreed prices"
          icon={<IndianRupee className="h-4 w-4" />}
        />
        <Metric
          label="Volume"
          value={kg(Math.round(totalQuintals * 100))}
          hint={`${totalQuintals.toLocaleString("en-IN")} quintals`}
          icon={<Scale className="h-4 w-4" />}
        />
        <Metric
          label="Avg. price"
          value={`${inr(avgPerKg)}/kg`}
          hint="Weighted by quantity"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-card px-4 sm:max-w-sm">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search crop, buyer, farmer or order #")}
            aria-label={t("Search orders")}
            className="w-full bg-transparent py-2.5 text-sm outline-none"
          />
        </label>
        {isLoading && (
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("Loading orders…")}
          </span>
        )}
      </div>

      {error && (
        <Panel className="border-destructive/40 text-sm text-destructive">
          {t("Could not load orders")}: {error.message}
        </Panel>
      )}
      {!session && (
        <Panel className="text-sm text-muted-foreground">
          {t("Sign in to see your accepted orders.")}{" "}
          <Link to="/auth" className="text-primary underline underline-offset-4">
            {t("Sign in")}
          </Link>
        </Panel>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <OrdersPanel
          icon={<UserCheck className="h-5 w-5" />}
          title={t("Accepted by you")}
          subtitle={
            myRole === "farmer"
              ? t("Buyer offers you accepted on your lots")
              : t("Farmer offers you accepted")
          }
          orders={acceptedByMe}
          myRole={myRole}
          empty={
            myRole === "farmer"
              ? t("Offers you accept from buyers will appear here.")
              : t("Farmer offers you accept will appear here.")
          }
          accent
        />
        <OrdersPanel
          icon={<Users className="h-5 w-5" />}
          title={myRole === "farmer" ? t("Accepted by buyers") : t("Accepted by farmers")}
          subtitle={
            myRole === "farmer"
              ? t("Your offers that buyers accepted")
              : t("Your bids that farmers accepted")
          }
          orders={acceptedByThem}
          myRole={myRole}
          empty={
            myRole === "farmer"
              ? t("When a buyer accepts your offer, it will appear here.")
              : t("When a farmer accepts your bid, it will appear here.")
          }
        />
      </div>
    </PortalLayout>
  );
}

function OrdersPanel({
  icon,
  title,
  subtitle,
  orders,
  myRole,
  empty,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  orders: BackendTransaction[];
  myRole: "farmer" | "buyer";
  empty: string;
  accent?: boolean;
}) {
  const value = orders.reduce((sum, tx) => sum + orderValue(tx), 0);
  return (
    <Panel className="p-0">
      <div className="flex items-start justify-between gap-3 border-b border-border p-5">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
              accent ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
            )}
          >
            {icon}
          </span>
          <div>
            <h2 className="font-serif text-2xl leading-tight">{title}</h2>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="text-right">
          <Pill tone={accent ? "solid" : "muted"}>{orders.length}</Pill>
          {orders.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{inr(value)}</p>}
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <Package className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{empty}</p>
        </div>
      ) : (
        <ul className="max-h-[640px] divide-y divide-border overflow-y-auto">
          {orders.map((tx) => (
            <OrderRow key={tx.id} tx={tx} myRole={myRole} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function OrderRow({ tx, myRole }: { tx: BackendTransaction; myRole: "farmer" | "buyer" }) {
  const { t } = useI18n();
  const completed = tx.status === "completed";
  const counterparty = myRole === "farmer" ? tx.buyer_name : tx.farmer_name;
  const steps = [
    { label: t("Offer accepted"), done: true },
    { label: t("Order created"), done: true },
    { label: t("Completed"), done: completed },
  ];

  return (
    <li className="p-5 transition-colors hover:bg-secondary/40">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-secondary text-xl">
          {cropEmoji(tx.crop_name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              {t(tx.crop_name)}{" "}
              <span className="text-muted-foreground">
                · {kg(Math.round(tx.quantity_quintals * 100))}
              </span>
            </p>
            <Pill tone={completed ? "green" : "amber"}>
              {completed ? t("Completed") : t(tx.status)}
            </Pill>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("Order")} #{tx.id} · LOT-{tx.lot_id} ·{" "}
            {myRole === "farmer" ? t("Buyer") : t("Farmer")}: {counterparty}
          </p>

          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-[11px] text-muted-foreground">{t("Agreed price")}</p>
              <p>{inr(tx.final_price / 100)}/kg</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">{t("Order value")}</p>
              <p>{inr(orderValue(tx))}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">{t("Accepted")}</p>
              <p className="truncate">{formatDate(tx.completed_at)}</p>
            </div>
          </div>

          <ol className="mt-4 flex items-center gap-2" aria-label={t("Order progress")}>
            {steps.map((step, i) => (
              <li key={step.label} className="flex flex-1 items-center gap-2">
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                    step.done
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card",
                  )}
                >
                  {step.done && <CheckCircle2 className="h-3.5 w-3.5" />}
                </span>
                <span
                  className={cn(
                    "text-[11px]",
                    step.done ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
                {i < steps.length - 1 && (
                  <span className={cn("h-px flex-1", step.done ? "bg-primary/50" : "bg-border")} />
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </li>
  );
}

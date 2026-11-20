import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Bell,
  CheckCheck,
  Gavel,
  MessageSquare,
  Megaphone,
  Truck,
  Wallet,
} from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { useNotifications, type FeedCategory } from "@/lib/notification-context";
import { splitLink, timeAgo } from "@/lib/deal-format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AnnouncementsList } from "@/components/fpo/farmer-fpo";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — AgriSense" },
      {
        name: "description",
        content: "Offers, order updates, payments and messages about your crop deals in one feed.",
      },
      { property: "og:title", content: "Notifications — AgriSense" },
      {
        property: "og:description",
        content: "Every alert that changes what your harvest earns.",
      },
    ],
  }),
  component: NotificationsPage,
});

const TABS: { key: "all" | FeedCategory; label: string }[] = [
  { key: "all", label: "All" },
  { key: "bids", label: "Offers" },
  { key: "orders", label: "Orders & delivery" },
  { key: "payments", label: "Payments" },
  { key: "messages", label: "Messages" },
  { key: "updates", label: "AgriSense updates" },
];

const ICONS: Record<FeedCategory, typeof Bell> = {
  bids: Gavel,
  orders: Truck,
  payments: Wallet,
  messages: MessageSquare,
  updates: Megaphone,
};

function NotificationsPage() {
  const { items, unread, isLoading, error, markAllRead, markRead } = useNotifications();
  const { t } = useI18n();
  const [tab, setTab] = useState<"all" | FeedCategory>("all");
  const list = tab === "all" ? items : items.filter((n) => n.category === tab);

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Alerts"
        title="Notifications"
        description="Offers on your lots, order and payment updates, and new messages."
        action={
          unread > 0 ? (
            <button
              onClick={() => {
                markAllRead();
                toast.success(t("All notifications marked as read"));
              }}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm"
            >
              <CheckCheck className="h-4 w-4" /> {t("Mark all as read")}
            </button>
          ) : undefined
        }
      />

      <AnnouncementsList limit={10} />

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((itemTab) => {
          const count =
            itemTab.key === "all"
              ? unread
              : items.filter((n) => n.category === itemTab.key && !n.read).length;
          return (
            <button
              key={itemTab.key}
              onClick={() => setTab(itemTab.key)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors",
                tab === itemTab.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              {t(itemTab.label)}
              {count > 0 ? (
                <span
                  className={cn(
                    "rounded-full px-2 text-xs",
                    tab === itemTab.key ? "bg-primary-foreground/20" : "bg-clay/15 text-clay",
                  )}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
        <span className="ml-auto text-sm text-muted-foreground">
          {unread} {t("unread")}
        </span>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <Panel>
            <p className="text-sm text-muted-foreground">{t("Loading notifications…")}</p>
          </Panel>
        ) : error ? (
          <Panel>
            <p className="text-sm text-destructive">
              {t("Could not load notifications.")} {error.message}
            </p>
          </Panel>
        ) : null}
        {list.map((n) => {
          const Icon = ICONS[n.category];
          const { to, search } = splitLink(n.link);
          return (
            <Panel
              key={n.id}
              className={cn("flex flex-wrap items-start gap-4", !n.read && "border-primary/40")}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-secondary">
                <Icon className="h-4 w-4 text-primary" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{n.title}</p>
                  {!n.read ? <Pill tone="clay">{t("New")}</Pill> : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t(timeAgo(n.createdAt))}</p>
              </div>
              <div className="flex items-center gap-2">
                {!n.read ? (
                  <button
                    onClick={() => markRead(n.id)}
                    className="rounded-full border border-border px-4 py-2 text-xs"
                  >
                    {t("Mark read")}
                  </button>
                ) : null}
                <Link
                  to={to as "/"}
                  search={search as never}
                  onClick={() => {
                    if (!n.read) markRead(n.id);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs text-primary-foreground"
                >
                  {t(n.linkLabel)} <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </Panel>
          );
        })}
        {!isLoading && !error && list.length === 0 ? (
          <Panel>
            <p className="text-sm text-muted-foreground">
              {tab === "all"
                ? t(
                    "No notifications yet. You will hear here when a buyer makes an offer, an order moves or a payment arrives.",
                  )
                : t("Nothing in this category yet.")}
            </p>
          </Panel>
        ) : null}
      </div>
    </PortalLayout>
  );
}

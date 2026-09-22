import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, Bell, CheckCheck } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { useNotifications } from "@/lib/notification-context";
import { useI18n } from "@/lib/i18n";
import type { NotificationCategory } from "@/services";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — AgriSense" },
      {
        name: "description",
        content:
          "Price alerts, buyer bids, logistics events and settlement updates for your crop lots in one feed.",
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

const TABS: { key: "all" | NotificationCategory; label: string }[] = [
  { key: "all", label: "All" },
  { key: "price", label: "Price alerts" },
  { key: "bids", label: "Buyer bids" },
  { key: "logistics", label: "Logistics" },
  { key: "settlements", label: "Settlements" },
];

function NotificationsPage() {
  const { items, unread, markAllRead, markRead } = useNotifications();
  const { t } = useI18n();
  const [tab, setTab] = useState<"all" | NotificationCategory>("all");
  const list = tab === "all" ? items : items.filter((n) => n.category === tab);

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Alerts"
        title="Notifications"
        description="Everything that moved your price, your buyer or your money."
        action={
          <button
            onClick={() => {
              markAllRead();
              toast.success(t("All notifications marked as read"));
            }}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm"
          >
            <CheckCheck className="h-4 w-4" /> {t("Mark all as read")}
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((itemTab) => {
          const count =
            itemTab.key === "all"
              ? items.filter((n) => !n.read).length
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
        <span className="ml-auto text-sm text-muted-foreground">{unread} {t("unread")}</span>
      </div>

      <div className="space-y-3">
        {list.map((n) => (
          <Panel
            key={n.id}
            className={cn("flex flex-wrap items-start gap-4", !n.read && "border-primary/40")}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-secondary">
              <Bell className="h-4 w-4 text-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{t(n.title)}</p>
                {!n.read ? <Pill tone="clay">{t("New")}</Pill> : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t(n.body)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{n.time}</p>
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
                to={n.link.to}
                onClick={() => markRead(n.id)}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs text-primary-foreground"
              >
                {t(n.link.label)} <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </Panel>
        ))}
        {list.length === 0 ? (
          <Panel>
            <p className="text-sm text-muted-foreground">{t("Nothing in this category yet.")}</p>
          </Panel>
        ) : null}
      </div>
    </PortalLayout>
  );
}

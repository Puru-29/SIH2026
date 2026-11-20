import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useNotifications } from "@/lib/notification-context";
import { splitLink } from "@/lib/deal-format";

/**
 * Header bell for the FPO and admin portals. The badge is the unread count from
 * /api/notifications (the same table the farmer and buyer portals read).
 * `extra` renders below the list, e.g. the FPO's "needs attention" checklist.
 */
export function NotificationBell({
  className,
  badgeClassName,
  extra,
}: {
  className?: string;
  badgeClassName?: string;
  extra?: ReactNode;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { items, unread, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const latest = items.slice(0, 8);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card",
          className,
        )}
        aria-label={`${t("Notifications")}: ${unread} ${t("unread")}`}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span
            className={cn(
              "absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground",
              badgeClassName,
            )}
          >
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border bg-card p-2 shadow-lg">
          <div className="flex items-center justify-between px-3 py-2">
            <p className="text-sm font-semibold">{t("Notifications")}</p>
            {unread > 0 && (
              <button
                className="text-xs font-medium text-primary hover:underline"
                onClick={() => markAllRead()}
              >
                {t("Mark all read")}
              </button>
            )}
          </div>
          {latest.length === 0 ? (
            <p className="px-3 pb-3 text-sm text-muted-foreground">{t("No notifications yet.")}</p>
          ) : (
            latest.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  if (!n.read) markRead(n.id);
                  setOpen(false);
                  if (n.link && n.link !== "/notifications") {
                    const { to, search } = splitLink(n.link);
                    void navigate({ to: to as "/", search: search as never });
                  }
                }}
                className="flex w-full gap-3 rounded-xl p-3 text-left text-sm hover:bg-secondary"
              >
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    n.read ? "bg-transparent" : "bg-primary",
                  )}
                />
                <span className="min-w-0">
                  <span className={cn("block", !n.read && "font-semibold")}>{n.title}</span>
                  {n.body && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">{n.body}</span>
                  )}
                </span>
              </button>
            ))
          )}
          {extra}
        </div>
      )}
    </div>
  );
}

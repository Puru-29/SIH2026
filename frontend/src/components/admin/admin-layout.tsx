import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { BrandLogo } from "@/components/agri/brand-logo";
import { useState } from "react";
import {
  BadgeCheck,
  Database,
  FileClock,
  Gauge,
  LineChart,
  LogOut,
  Megaphone,
  Menu,
  Scale,
  Store,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { logout } from "@/services/api-client";
import { useRequireRole } from "@/hooks/use-require-role";
import { useFpoQuery } from "@/hooks/use-fpo";
import { adminApi } from "@/services/admin-api";
import { NotificationBell } from "@/components/agri/notification-bell";

const ADMIN_NAV = [
  { to: "/admin", label: "Overview", icon: Gauge },
  { to: "/admin/verification", label: "Verification", icon: BadgeCheck, badge: "verify" },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/marketplace", label: "Marketplace", icon: Store },
  { to: "/admin/disputes", label: "Disputes", icon: Scale, badge: "disputes" },
  { to: "/admin/intelligence", label: "Market intelligence", icon: LineChart },
  { to: "/admin/master-data", label: "Master data", icon: Database },
  { to: "/admin/announcements", label: "Announcements", icon: Megaphone },
  { to: "/admin/audit", label: "Audit log", icon: FileClock },
] as const;

export function AdminLayout() {
  const { t, lang, setLang } = useI18n();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const session = useRequireRole(["admin"]);
  const [open, setOpen] = useState(false);
  // Overview carries the counts for the menu badges.
  const overview = useFpoQuery(["admin", "overview"], adminApi.overview, session !== null);
  if (!session) return null;
  const badges: Record<string, number> = {
    verify:
      (overview.data?.pending_verifications.fpos ?? 0) +
      (overview.data?.pending_verifications.buyers ?? 0),
    disputes: overview.data?.open_disputes ?? 0,
  };
  const active = (to: string) =>
    to === "/admin" ? pathname === "/admin" || pathname === "/admin/" : pathname.startsWith(to);

  return (
    <div className="admin-portal min-h-screen">
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          "admin-rail fixed inset-y-0 left-0 z-50 flex w-64 flex-col px-3 py-5 transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label={t("Admin console")}
      >
        <div className="flex items-center gap-3 px-2">
          <BrandLogo size={40} />
          <div>
            <p className="font-serif text-lg leading-tight text-white">AgriSense Admin</p>
            <p className="text-xs text-white/60">{session.name}</p>
          </div>
          <button
            className="ml-auto rounded-full p-2 text-white/80 lg:hidden"
            onClick={() => setOpen(false)}
            aria-label={t("Close menu")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="mt-6 flex-1 space-y-1 overflow-y-auto">
          {ADMIN_NAV.map((item) => {
            const count = "badge" in item ? (badges[item.badge] ?? 0) : 0;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
                  active(item.to)
                    ? "bg-white/95 font-semibold text-[oklch(0.3_0.05_175)]"
                    : "text-white/80 hover:bg-white/10 hover:text-white",
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                <span className="flex-1">{t(item.label)}</span>
                {count > 0 && (
                  <span className="rounded-full bg-[oklch(0.75_0.14_75)] px-2 text-xs font-bold text-[oklch(0.25_0.05_70)]">
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur md:px-8">
          <button
            className="rounded-xl p-2 hover:bg-secondary lg:hidden"
            onClick={() => setOpen(true)}
            aria-label={t("Open menu")}
          >
            <Menu className="h-6 w-6" />
          </button>
          <p className="hidden text-sm text-muted-foreground md:block">
            {t("Platform administration")}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell className="h-10 w-10" />
            <div
              role="group"
              aria-label="Language"
              className="flex rounded-full border border-border bg-card p-0.5 text-sm"
            >
              {(["en", "hi"] as const).map((code) => (
                <button
                  key={code}
                  onClick={() => setLang(code)}
                  aria-pressed={lang === code}
                  className={cn(
                    "min-h-9 rounded-full px-3 font-medium",
                    lang === code ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {code === "en" ? "EN" : "हिंदी"}
                </button>
              ))}
            </div>
            <button
              onClick={async () => {
                await logout();
                void navigate({ to: "/admin/login" });
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
              aria-label={t("Sign out")}
              title={t("Sign out")}
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-7xl space-y-6 px-4 py-7 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { BrandLogo } from "@/components/agri/brand-logo";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Boxes,
  ClipboardCheck,
  Handshake,
  LayoutDashboard,
  LineChart,
  LogOut,
  Megaphone,
  Menu,
  MessageSquareWarning,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Truck,
  Users,
  Wallet,
  Wheat,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/agri/notification-bell";
import { useI18n } from "@/lib/i18n";
import { logout } from "@/services/api-client";
import { useRequireRole } from "@/hooks/use-require-role";
import type { FpoOrg } from "@/services/fpo-api";
import { fpoApi } from "@/services/fpo-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import { VerifiedBadge } from "./fpo-ui";

export const FPO_NAV = [
  { to: "/fpo", label: "Dashboard", icon: LayoutDashboard },
  { to: "/fpo/farmers", label: "Farmers", icon: Users },
  { to: "/fpo/aggregation", label: "Crop Aggregation", icon: Wheat },
  { to: "/fpo/inventory", label: "Inventory", icon: Boxes },
  { to: "/fpo/marketplace", label: "Buyer Marketplace", icon: Handshake },
  { to: "/fpo/quality", label: "Quality & Grading", icon: ClipboardCheck },
  { to: "/fpo/logistics", label: "Logistics", icon: Truck },
  { to: "/fpo/transactions", label: "Transactions", icon: Wallet },
  { to: "/fpo/market", label: "Market Intelligence", icon: LineChart },
  { to: "/fpo/grievances", label: "Grievances", icon: MessageSquareWarning },
  { to: "/fpo/announcements", label: "Announcements", icon: Megaphone },
  { to: "/fpo/reports", label: "Reports", icon: BarChart3 },
  { to: "/fpo/settings", label: "Settings", icon: Settings },
] as const;

function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div
      role="group"
      aria-label="Language"
      className="flex rounded-full border border-border bg-card p-0.5 text-sm"
    >
      {(
        [
          ["en", "EN"],
          ["hi", "हिंदी"],
        ] as const
      ).map(([code, label]) => (
        <button
          key={code}
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={cn(
            "min-h-9 rounded-full px-3 font-medium transition-colors",
            lang === code
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function FpoLayout() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const session = useRequireRole(["fpo"]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const isManager = session !== null;
  const pending = session?.status === "pending";

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("fpo_rail_collapsed") === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);

  const org = useFpoQuery(["org"], fpoApi.org, isManager);
  const notes = useFpoQuery(["notifications"], fpoApi.notifications, isManager && !pending);
  const count = notes.data?.length ?? 0;

  const signOut = async () => {
    await logout();
    void navigate({ to: "/auth" });
  };

  if (!session) return null;
  if (pending) return <PendingVerification org={org.data} onSignOut={signOut} />;

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("fpo_rail_collapsed", c ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !c;
    });
  };

  const isActive = (to: string) =>
    to === "/fpo" ? pathname === "/fpo" || pathname === "/fpo/" : pathname.startsWith(to);

  return (
    <div className="fpo-portal min-h-screen">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          "fpo-rail fixed inset-y-0 left-0 z-50 flex flex-col px-3 py-5 transition-all duration-200",
          collapsed ? "lg:w-20" : "lg:w-68",
          "w-72",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
        aria-label={t("FPO portal")}
      >
        <div
          className={cn("flex items-center gap-3 px-2", collapsed && "lg:justify-center lg:px-0")}
        >
          <BrandLogo size={44} />
          <div className={cn("min-w-0", collapsed && "lg:hidden")}>
            <p className="font-serif text-lg leading-tight text-white">AgriSense FPO</p>
            <p className="truncate text-xs text-white/70">
              {org.data?.name ?? t("Farmer Producer Organisation")}
            </p>
          </div>
          <button
            className="ml-auto rounded-full p-2 text-white/80 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label={t("Close menu")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="mt-6 flex-1 space-y-1 overflow-y-auto pr-1">
          {FPO_NAV.map((item) => {
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                title={collapsed ? t(item.label) : undefined}
                className={cn(
                  "flex min-h-12 items-center gap-3 rounded-xl px-3 text-[0.95rem] transition-colors",
                  collapsed && "lg:justify-center lg:px-0",
                  active
                    ? "bg-white/95 font-semibold text-[oklch(0.3_0.07_125)] shadow-sm"
                    : "text-white/85 hover:bg-white/12 hover:text-white",
                )}
              >
                <item.icon
                  className={cn("h-5 w-5 shrink-0", active && "text-[oklch(0.43_0.09_118)]")}
                />
                <span className={cn(collapsed && "lg:hidden")}>{t(item.label)}</span>
                {item.to === "/fpo" && count > 0 && !collapsed && (
                  <span className="ml-auto rounded-full bg-[var(--fpo-gold)] px-2 text-xs font-bold text-[var(--fpo-gold-ink)]">
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={toggleCollapsed}
          className="mt-3 hidden min-h-11 items-center gap-2 rounded-xl px-3 text-sm text-white/80 hover:bg-white/10 lg:flex"
          aria-label={collapsed ? t("Expand menu") : t("Collapse menu")}
        >
          {collapsed ? (
            <PanelLeftOpen className="mx-auto h-5 w-5" />
          ) : (
            <PanelLeftClose className="h-5 w-5" />
          )}
          {!collapsed && t("Collapse menu")}
        </button>
      </aside>

      <div className={cn("transition-all duration-200", collapsed ? "lg:pl-20" : "lg:pl-68")}>
        <header className="fpo-topbar sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur md:px-8">
          <button
            className="rounded-xl p-2 hover:bg-secondary lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label={t("Open menu")}
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="hidden min-w-0 items-center gap-3 md:flex">
            <span className="truncate font-medium">{org.data?.name}</span>
            {org.data && <VerifiedBadge verified={org.data.verified} />}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <LangToggle />
            <NotificationBell
              badgeClassName="bg-[var(--fpo-gold)] text-[var(--fpo-gold-ink)]"
              extra={
                count > 0 && (
                  <div className="mt-1 border-t border-border pt-2">
                    <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("Needs your attention")}
                    </p>
                    {notes.data!.map((n, i) => (
                      <Link
                        key={i}
                        to={n.link as "/fpo"}
                        className="flex gap-3 rounded-xl p-3 text-sm hover:bg-secondary"
                      >
                        <span
                          className={cn(
                            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                            n.tone === "bad"
                              ? "bg-destructive"
                              : n.tone === "warn"
                                ? "bg-[var(--fpo-warn)]"
                                : "bg-primary",
                          )}
                        />
                        {n.message}
                      </Link>
                    ))}
                  </div>
                )
              }
            />
            <span
              className="hidden h-11 w-11 items-center justify-center rounded-full bg-primary text-base font-semibold uppercase text-primary-foreground sm:flex"
              title={`${org.data?.name ?? ""} · ${t("Signed in as")} ${session.name ?? ""}`}
              aria-label={`${org.data?.name ?? ""} · ${t("Signed in as")} ${session.name ?? ""}`}
            >
              {/* Match the FPO name shown in the header and sidebar. */}
              {(org.data?.name || session.name || "F").trim().charAt(0)}
            </span>
            <button
              onClick={() => void signOut()}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
              aria-label={t("Sign out")}
              title={t("Sign out")}
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>
        <main className="fpo-main mx-auto max-w-7xl space-y-7 px-4 py-7 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Shown to FPO managers until an admin approves their organisation. */
function PendingVerification({
  org,
  onSignOut,
}: {
  org: FpoOrg | undefined;
  onSignOut: () => void;
}) {
  const { t } = useI18n();
  const [f, setF] = useState({ name: "", registration_no: "", district: "", state: "" });
  useEffect(() => {
    if (org)
      setF({
        name: org.name,
        registration_no: org.registration_no ?? "",
        district: org.district,
        state: org.state,
      });
  }, [org]);
  const save = useFpoMutation(
    () =>
      fpoApi.updateOrg({
        name: f.name,
        registration_no: f.registration_no,
        district: f.district,
        state: f.state,
        contact_phone: org?.contact_phone ?? null,
        commission_pct: org?.commission_pct ?? 2,
      }),
    { success: "Details updated and sent for review again" },
  );
  return (
    <div className="fpo-portal flex min-h-screen items-center justify-center px-4 py-10">
      <div className="fpo-card w-full max-w-xl p-7 md:p-9">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--fpo-gold)] text-[var(--fpo-gold-ink)]">
          <Wheat className="h-7 w-7" />
        </span>
        <h1 className="mt-5 font-serif text-3xl">
          {org?.rejection_reason ? t("Your details need a change") : t("Waiting for verification")}
        </h1>
        {org?.rejection_reason ? (
          <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <p className="font-medium">{t("Message from the AgriSense admin")}:</p>
            <p className="mt-1">{org.rejection_reason}</p>
          </div>
        ) : (
          <p className="mt-2 text-base text-muted-foreground">
            {t(
              "The AgriSense admin is checking your FPO registration. You can use the FPO portal as soon as it is approved. Sign in again later to check.",
            )}
          </p>
        )}
        {org && (
          <form
            className="mt-6 grid gap-3 rounded-2xl bg-secondary p-4 text-sm sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(undefined);
            }}
          >
            {(
              [
                ["name", "FPO name"],
                ["registration_no", "Registration number"],
                ["district", "District"],
                ["state", "State"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="grid gap-1">
                <span className="text-muted-foreground">{t(label)}</span>
                <input
                  id={`pv-${key}`}
                  value={f[key]}
                  onChange={(e) => setF({ ...f, [key]: e.target.value })}
                  readOnly={!org.rejection_reason}
                  className="min-h-10 rounded-lg border border-input bg-card px-3 read-only:border-transparent read-only:bg-transparent read-only:px-0 read-only:font-medium"
                />
              </label>
            ))}
            {org.rejection_reason && (
              <button
                type="submit"
                disabled={save.isPending}
                className="min-h-11 rounded-xl bg-primary px-4 font-medium text-primary-foreground sm:col-span-2"
              >
                {t("Save and send for review")}
              </button>
            )}
          </form>
        )}
        <button
          onClick={onSignOut}
          className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-5 font-medium hover:bg-secondary"
        >
          <LogOut className="h-4 w-4" /> {t("Sign out")}
        </button>
      </div>
    </div>
  );
}

import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  Bell,
  Bot,
  Boxes,
  Brain,
  ClipboardList,
  Building2,
  ChevronLeft,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Package,
  Receipt,
  Search,
  ShieldCheck,
  Snowflake,
  Sprout,
  Store,
  Truck,
  User,
  Users,
  Wallet,
  MessageSquare,
  Wheat,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LocationSelector } from "./location-selector";
import { useFarmLocation } from "@/lib/location-context";
import { useNotifications } from "@/lib/notification-context";
import { useI18n } from "@/lib/i18n";
import { LanguageSelector } from "./language-selector";
import { FontSizeControl } from "./font-size-control";
import type { UserRole } from "@/services/session";
import { logout } from "@/services/api-client";
import { useRequireRole } from "@/hooks/use-require-role";
import { useMyProfile } from "@/hooks/use-market";

const FARMER_NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/crops", label: "My Crops", icon: Sprout },
  { to: "/markets", label: "Markets", icon: Store },
  { to: "/decision", label: "AI Decision", icon: Brain },
  { to: "/forecast", label: "Price Forecast", icon: LineChart },
  { to: "/agribot", label: "AgriBot Assistant", icon: Bot },
  { to: "/buyers", label: "Buyers", icon: Users },
  { to: "/orders", label: "Orders", icon: Package },
  { to: "/logistics", label: "Logistics", icon: Truck },
  { to: "/storage", label: "Cold Chain & Storage", icon: Snowflake },
  { to: "/payments", label: "Settlements", icon: Wallet },
  { to: "/my-fpo", label: "My FPO", icon: Wheat },
  { to: "/messages", label: "Messages", icon: MessageSquare },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/profile", label: "Profile", icon: User },
] as const;

const BUYER_NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/browse-produce", label: "Browse Produce", icon: Search },
  { to: "/requirements", label: "My Requirements", icon: ClipboardList },
  { to: "/verification", label: "Verification", icon: ShieldCheck },
  { to: "/suppliers", label: "Suppliers", icon: Users },
  { to: "/orders", label: "Orders", icon: Package },
  { to: "/logistics", label: "Logistics", icon: Truck },
  { to: "/payments", label: "Payments & Invoices", icon: Receipt },
  { to: "/messages", label: "Messages", icon: MessageSquare },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/profile", label: "Profile", icon: User },
] as const;

export function PortalLayout({
  children,
  roles = ["farmer", "buyer"],
  wide = false,
}: {
  children: ReactNode;
  /** Full-width content (e.g. AgriBot's three columns). */
  wide?: boolean;
  /** Roles allowed on this page; others are sent to their own home page. */
  roles?: UserRole[];
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const { location } = useFarmLocation();
  const { unread } = useNotifications();
  const profile = useMyProfile();
  const { t } = useI18n();
  const navigate = useNavigate();
  // FPO managers are never allowed here: they have their own portal at /fpo.
  const session = useRequireRole(roles.filter((r) => r !== "fpo"));
  if (!session) return null;
  const userName = session.name ?? "";
  const isBuyer = session?.role === "buyer";
  const nav = isBuyer ? BUYER_NAV : FARMER_NAV;

  return (
    <div className={cn("min-h-screen bg-background", isBuyer && "buyer-portal")}>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 border-r border-border bg-sidebar px-4 py-6 transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Boxes className="h-4 w-4" />
            </span>
            <span
              className={cn(
                "font-serif text-lg font-semibold tracking-tight",
                isBuyer && "text-orange-950",
              )}
            >
              {isBuyer ? "AgriSense Market" : "AgriSense"}
            </span>
          </Link>
          <button
            className="lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>

        <nav className="mt-8 space-y-1">
          {nav.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {t(item.label)}
                {item.to === "/agribot" ? (
                  <span
                    className={cn(
                      "ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                      active ? "bg-primary-foreground/20" : "bg-primary/10 text-primary",
                    )}
                  >
                    AI
                  </span>
                ) : null}
                {item.to === "/notifications" && unread > 0 ? (
                  <span
                    className={cn(
                      "ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      active ? "bg-primary-foreground/20" : "bg-clay/15 text-clay",
                    )}
                  >
                    {unread}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="absolute inset-x-4 bottom-6 space-y-3">
          <div className="flex items-center justify-between gap-2 lg:hidden">
            <LanguageSelector className="flex-1" />
            <FontSizeControl />
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur md:px-8">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </button>
          <p className="hidden text-sm text-muted-foreground md:block">
            {session?.role === "buyer"
              ? t("Buyer portal")
              : session?.role === "admin"
                ? t("Admin")
                : t("Farmer portal")}{" "}
            · {userName}
          </p>
          <div className="ml-auto flex items-center gap-2.5">
            <FontSizeControl className="hidden sm:flex" />
            <LanguageSelector className="hidden sm:flex" />
            <LocationSelector />
            <Link
              to="/notifications"
              className="relative rounded-full border border-border bg-card p-2"
              aria-label={`Notifications, ${unread} unread`}
            >
              <Bell className="h-4 w-4" />
              {unread > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-clay px-1 text-[10px] font-semibold text-primary-foreground">
                  {unread}
                </span>
              ) : null}
            </Link>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground uppercase">
              {userName.charAt(0)}
            </span>
            <button
              onClick={async () => {
                await logout();
                void navigate({ to: "/auth" });
              }}
              className="ml-2 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              title={t("Sign out")}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {isBuyer && profile.data?.verified === false ? (
          <div
            role="status"
            className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 md:px-8"
          >
            <strong>{t("Your account is being verified")}</strong> —{" "}
            {t(
              "you can make offers once approved. Meanwhile you can browse produce and post requirements.",
            )}{" "}
            <Link to="/verification" className="font-medium underline">
              {t("Complete verification")}
            </Link>
          </div>
        ) : null}

        <main
          className={cn(
            "mx-auto space-y-8 px-4 md:px-8",
            wide ? "max-w-[100rem] py-5" : "max-w-6xl py-8",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

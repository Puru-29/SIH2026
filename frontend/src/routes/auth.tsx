import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BrandLogo } from "@/components/agri/brand-logo";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Loader2, ShieldCheck, Sprout, Store, Wheat } from "lucide-react";
import { cn } from "@/lib/utils";
import { LanguageSelector } from "@/components/agri/language-selector";
import { useI18n } from "@/lib/i18n";
import { homeFor, setSession, type UserRole } from "@/services/session";
import { getAuthErrorMessage, loginFarmer } from "@/services/api-client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — AgriSense" },
      {
        name: "description",
        content: "Sign in to AgriSense as a farmer, buyer, FPO or administrator.",
      },
      { property: "og:title", content: "Sign in — AgriSense" },
      { property: "og:description", content: "Access your AgriSense market intelligence portal." },
    ],
  }),
  component: AuthPage,
});

const ROLES = [
  { id: "farmer", label: "Farmer", icon: Sprout, sub: "Sell your crop lots" },
  { id: "buyer", label: "Buyer", icon: Store, sub: "Source verified produce" },
  { id: "fpo", label: "FPO", icon: Wheat, sub: "Pool crops and sell in bulk" },
  { id: "admin", label: "Admin", icon: ShieldCheck, sub: "Manage the network" },
] as const;

type PublicRole = (typeof ROLES)[number]["id"];

function AuthPage() {
  const [role, setRole] = useState<PublicRole>("farmer");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<"form" | PublicRole | null>(null);
  const navigate = useNavigate();
  const { t } = useI18n();

  async function signIn(p: string, code: string, r: UserRole, source: "form" | PublicRole) {
    setBusy(source);
    try {
      const user = await loginFarmer(p, code, r);
      setSession(user);
      toast.success(t("Login successful"), { description: `${t("Welcome back")}, ${user.name}.` });
      void navigate({ to: homeFor(user.role) });
    } catch (error) {
      toast.error(t("Login failed"), { description: getAuthErrorMessage(error, "login") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={cn(
        "auth-page flex min-h-screen items-center justify-center bg-background px-6 py-12",
        role === "buyer" && "buyer-auth",
        role === "fpo" && "fpo-portal",
      )}
    >
      <div className="w-full max-w-lg">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <BrandLogo size={48} />
          <span className="font-serif text-xl">AgriSense</span>
        </Link>

        <div className="mb-4 flex justify-center">
          <LanguageSelector />
        </div>

        <div className="rounded-[2rem] border border-border bg-card p-8">
          <h1 className="font-serif text-3xl">{t("Welcome back")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("Choose your role and sign in with your registered phone number.")}
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ROLES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRole(r.id)}
                aria-pressed={role === r.id}
                className={cn(
                  "rounded-2xl border p-4 text-left transition-colors",
                  role === r.id
                    ? "border-primary bg-accent"
                    : "border-border bg-background hover:bg-secondary",
                )}
              >
                <r.icon className="h-4 w-4 text-primary" />
                <p className="mt-2 text-sm font-medium">{t(r.label)}</p>
                <p className="text-xs text-muted-foreground">{t(r.sub)}</p>
              </button>
            ))}
          </div>

          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (phone.length !== 10) {
                toast.error(t("Please enter a valid 10-digit phone number."));
                return;
              }
              if (pin.length !== 4) {
                toast.error(t("Please enter your 4-digit PIN."));
                return;
              }
              void signIn(phone, pin, role, "form");
            }}
          >
            <div>
              <label className="text-sm text-muted-foreground" htmlFor="phone">
                {t("Phone number")}
              </label>
              <div className="relative mt-1 flex items-center">
                <span className="absolute left-4 text-sm text-muted-foreground">+91</span>
                <input
                  id="phone"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="98XXXXXXXX"
                  maxLength={10}
                  required
                  className="w-full rounded-xl border border-border bg-background py-3 pl-12 pr-4 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>
            <div>
              <label className="text-sm text-muted-foreground" htmlFor="pin">
                {t("4-digit PIN")}
              </label>
              <input
                id="pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="••••"
                required
                className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
              />
            </div>
            <button
              type="submit"
              disabled={busy !== null}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {busy === "form" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("Sign in")} {role !== "farmer" && `· ${t(role === "fpo" ? "FPO" : "Buyer")}`}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t("Don't have an account?")}{" "}
            <Link to="/register" className="font-medium text-primary hover:underline">
              {t("Create an account")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

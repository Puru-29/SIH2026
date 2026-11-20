import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { setSession } from "@/services/session";
import { getAuthErrorMessage, loginFarmer } from "@/services/api-client";

export const Route = createFileRoute("/admin_/login")({
  head: () => ({
    meta: [{ title: "Administrator sign in — AgriSense" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminLogin,
});

/** Admin accounts are created from ADMIN_PHONE / ADMIN_PIN on the server; there is no sign-up. */
function AdminLogin() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-[2rem] border border-border bg-card p-8">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <h1 className="mt-4 font-serif text-3xl">{t("Administrator sign in")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("For AgriSense platform administrators only.")}
          </p>
          <form
            className="mt-6 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (phone.length !== 10 || pin.length !== 4) {
                toast.error(t("Enter a 10-digit phone number and 4-digit PIN."));
                return;
              }
              setBusy(true);
              try {
                const user = await loginFarmer(phone, pin, "admin");
                setSession(user);
                void navigate({ to: "/admin" });
              } catch (error) {
                toast.error(t("Login failed"), {
                  description: getAuthErrorMessage(error, "login"),
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            <div>
              <label className="text-sm text-muted-foreground" htmlFor="admin-phone">
                {t("Phone number")}
              </label>
              <input
                id="admin-phone"
                inputMode="numeric"
                autoComplete="username"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                maxLength={10}
                required
                className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground" htmlFor="admin-pin">
                {t("4-digit PIN")}
              </label>
              <input
                id="admin-pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                maxLength={4}
                required
                className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("Sign in")} <ArrowRight className="h-4 w-4" />
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            <Link to="/auth" className="hover:text-foreground hover:underline">
              {t("Farmer, buyer or FPO sign in")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

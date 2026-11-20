import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Loader2, Sprout, Store, Wheat } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { LanguageSelector } from "@/components/agri/language-selector";
import { homeFor, setSession } from "@/services/session";
import { getAuthErrorMessage, registerFarmer } from "@/services/api-client";
import { INDIAN_STATES } from "@/lib/states";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Create an Account — AgriSense" },
      { name: "description", content: "Register a new AgriSense account." },
    ],
  }),
  component: RegisterPage,
});

const ROLES = [
  { id: "farmer", label: "Farmer", icon: Sprout, sub: "Sell your crop lots" },
  { id: "buyer", label: "Buyer", icon: Store, sub: "Source verified produce" },
  { id: "fpo", label: "FPO", icon: Wheat, sub: "Register your producer organisation" },
] as const;

type Role = (typeof ROLES)[number]["id"];

const inputCls =
  "mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary";

function RegisterPage() {
  const [role, setRole] = useState<Role>("farmer");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [fpo, setFpo] = useState({
    registration_no: "",
    district: "",
    state: "",
    primary_crops: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { t } = useI18n();

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
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sprout className="h-4 w-4" />
          </span>
          <span className="font-serif text-xl">AgriSense</span>
        </Link>

        <div className="mb-4 flex justify-center">
          <LanguageSelector />
        </div>

        <div className="rounded-[2rem] border border-border bg-card p-8">
          <h1 className="font-serif text-3xl">{t("Create an account")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("Join AgriSense to access market intelligence and trading tools.")}
          </p>

          <div className="mt-6 grid grid-cols-3 gap-3">
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
            onSubmit={async (e) => {
              e.preventDefault();
              if (phone.length !== 10) {
                toast.error(t("Please enter a valid 10-digit phone number."));
                return;
              }
              if (pin.length !== 4) {
                toast.error(t("Please set a 4-digit PIN."));
                return;
              }
              if (role !== "buyer" && (!fpo.district.trim() || !fpo.state)) {
                toast.error(t("Enter your district and choose your state."));
                return;
              }
              if (role === "fpo" && !fpo.registration_no.trim()) {
                toast.error(t("Enter your FPO registration number."));
                return;
              }
              setIsSubmitting(true);
              try {
                const user = await registerFarmer(
                  name,
                  phone,
                  pin,
                  role,
                  role === "fpo"
                    ? fpo
                    : role === "farmer"
                      ? { district: fpo.district, state: fpo.state }
                      : undefined,
                );
                setSession(user);
                toast.success(t("Account created successfully"), {
                  description:
                    user.status === "pending"
                      ? t(
                          "Your FPO will be reviewed by the AgriSense admin before you can start trading.",
                        )
                      : `${t("Welcome to AgriSense")}, ${user.name}!`,
                });
                void navigate({ to: homeFor(user.role) });
              } catch (error) {
                toast.error(t("Registration failed"), {
                  description: getAuthErrorMessage(error, "register"),
                });
              } finally {
                setIsSubmitting(false);
              }
            }}
          >
            <div>
              <label className="text-sm text-muted-foreground" htmlFor="name">
                {role === "fpo" ? t("FPO name") : t("Full name")}
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={role === "fpo" ? "Kadwa Valley Farmer Producer Co." : "Ramesh Patil"}
                required
                minLength={2}
                className={inputCls}
              />
            </div>
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
                {t("Set a 4-digit PIN")}
              </label>
              <input
                id="pin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="••••"
                required
                className={inputCls}
              />
            </div>

            {role !== "buyer" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm text-muted-foreground" htmlFor="district">
                    {t("District")}
                  </label>
                  <input
                    id="district"
                    value={fpo.district}
                    onChange={(e) => setFpo({ ...fpo, district: e.target.value })}
                    placeholder={role === "farmer" ? "Ludhiana" : undefined}
                    required
                    minLength={2}
                    maxLength={60}
                    autoComplete="address-level2"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground" htmlFor="state">
                    {t("State")}
                  </label>
                  <select
                    id="state"
                    value={fpo.state}
                    onChange={(e) => setFpo({ ...fpo, state: e.target.value })}
                    required
                    className={inputCls}
                  >
                    <option value="">{t("Choose state")}</option>
                    {INDIAN_STATES.map((s) => (
                      <option key={s} value={s}>
                        {t(s)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {role === "fpo" && (
              <fieldset className="space-y-4 rounded-2xl border border-border p-4">
                <legend className="px-1 text-sm font-medium">{t("FPO details")}</legend>
                <div>
                  <label className="text-sm text-muted-foreground" htmlFor="reg-no">
                    {t("Registration number")}
                  </label>
                  <input
                    id="reg-no"
                    value={fpo.registration_no}
                    onChange={(e) => setFpo({ ...fpo, registration_no: e.target.value })}
                    placeholder="e.g. U01400MH2019PTC123456"
                    required
                    maxLength={60}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground" htmlFor="crops">
                    {t("Primary crops")}
                  </label>
                  <input
                    id="crops"
                    value={fpo.primary_crops}
                    onChange={(e) => setFpo({ ...fpo, primary_crops: e.target.value })}
                    placeholder="Wheat, Onion, Soybean"
                    maxLength={300}
                    className={inputCls}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "New FPOs are reviewed by the AgriSense admin. You can sign in while you wait.",
                  )}
                </p>
              </fieldset>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {role === "buyer"
                ? t("Create buyer account")
                : role === "fpo"
                  ? t("Register FPO")
                  : t("Create farmer account")}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t("Already have an account?")}{" "}
            <Link to="/auth" className="font-medium text-primary hover:underline">
              {t("Sign in")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Sprout, Store, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { LocationSelector } from "@/components/agri/location-selector";
import { LanguageSelector } from "@/components/agri/language-selector";
import { useI18n } from "@/lib/i18n";
import { loginAsDemo, setUser, type UserRole } from "@/services/session";
import { getAuthErrorMessage, loginFarmer } from "@/services/api-client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — AgriSense" },
      { name: "description", content: "Sign in to AgriSense as a farmer, buyer, FPO or admin." },
      { property: "og:title", content: "Sign in — AgriSense" },
      { property: "og:description", content: "Access your AgriSense market intelligence portal." },
    ],
  }),
  component: AuthPage,
});

const ROLES = [
  { id: "farmer", label: "Farmer", icon: Sprout, sub: "Sell your crop lots" },
  { id: "buyer", label: "Buyer", icon: Store, sub: "Source verified produce" },
];

function AuthPage() {
  const [role, setRole] = useState("farmer");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [step, setStep] = useState<"form" | "otp">("form");
  const [otp, setOtp] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <div className={cn("auth-page flex min-h-screen items-center justify-center bg-background px-6 py-12", role === "buyer" && "buyer-auth")}>
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
          <h1 className="font-serif text-3xl">{t("Welcome back")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("Choose your role and sign in with the phone number registered with your mandi.")}
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3">
            {ROLES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRole(r.id)}
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

          {step === "form" ? (
            <form
              className="mt-6 space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (phone.length !== 10) {
                  toast.error("Please enter a valid 10-digit phone number.");
                  return;
                }
                if (pin.length !== 4) {
                  toast.error("Please enter your 4-digit PIN.");
                  return;
                }
                setIsSubmitting(true);
                try {
                  if (role !== "farmer" && role !== "buyer") {
                    toast.error("Only farmer and buyer sign in is currently available.");
                    return;
                  }
                  const user = await loginFarmer(phone, pin, role);
                  setUser(user.user_id, user.role, user.name);
                  toast.success("Login successful", {
                    description: `Welcome back, ${user.name}.`,
                  });
                  navigate({ to: "/dashboard" });
                } catch (error) {
                  toast.error("Login failed", {
                    description: getAuthErrorMessage(error, "login"),
                  });
                } finally {
                  setIsSubmitting(false);
                }
              }}
            >
              <div>
                <label className="text-sm text-muted-foreground" htmlFor="phone">
                  {t("Phone number")}
                </label>
                <div className="relative mt-1 flex items-center">
                  <span className="absolute left-4 text-sm text-muted-foreground">
                    +91
                  </span>
                  <input
                    id="phone"
                    inputMode="numeric"
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
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••"
                  required
                  className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">{t("Farm location")}</span>
                <LocationSelector compact />
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                {isSubmitting
                  ? role === "buyer" ? "Signing in as buyer..." : "Signing in as farmer..."
                  : role === "buyer" ? "Sign in as buyer" : t("Sign in")} <ArrowRight className="h-4 w-4" />
              </button>
              
              <div className="relative my-6 text-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border"></div>
                </div>
                <span className="relative bg-card px-4 text-xs text-muted-foreground">
                  OR
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  loginAsDemo();
                  navigate({ to: "/dashboard" });
                }}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-6 py-3 text-sm transition-colors hover:bg-secondary"
              >
                <User className="h-4 w-4" /> {t("Continue as demo farmer (Ramesh)")}
              </button>
            </form>
          ) : (
            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (otp.length !== 4) {
                  toast.error("Please enter the 4-digit OTP.");
                  return;
                }
                setUser(1, role as UserRole, "Ramesh Patil");
                navigate({ to: "/dashboard" });
              }}
            >
              <div>
                <label className="text-sm text-muted-foreground" htmlFor="otp">
                  {t("Enter OTP sent to +91 ")} {phone}
                </label>
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="1234"
                  maxLength={4}
                  required
                  className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-center text-xl tracking-[0.5em] outline-none focus:border-primary"
                />
              </div>
              <button
                type="submit"
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                {t("Verify OTP & Sign in")} <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setStep("form")}
                className="mt-2 w-full text-center text-sm text-primary hover:underline"
              >
                {t("Edit phone number")}
              </button>
            </form>
          )}
          
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

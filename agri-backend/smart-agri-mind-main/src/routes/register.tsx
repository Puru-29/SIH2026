import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Sprout, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { LanguageSelector } from "@/components/agri/language-selector";
import { setUser, type UserRole } from "@/services/session";
import { getAuthErrorMessage, registerFarmer } from "@/services/api-client";
import { useGoogleLogin } from "@react-oauth/google";

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
];

function RegisterPage() {
  const [role, setRole] = useState("farmer");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [step, setStep] = useState<"form" | "otp">("form");
  const [otp, setOtp] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { t } = useI18n();

  const handleGoogleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      try {
        const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
        });
        const userInfo = await res.json();
        setUser(1, role as UserRole, userInfo.name || "Google User");
        toast.success(`Welcome to AgriSense, ${userInfo.name}!`);
        navigate({ to: "/dashboard" });
      } catch (err) {
        toast.error("Failed to fetch Google profile");
      }
    },
    onError: (error) => toast.error("Google Login Failed"),
  });

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
          <h1 className="font-serif text-3xl">{t("Create an account")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("Join AgriSense to access market intelligence and trading tools.")}
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
                  toast.error("Please set a 4-digit PIN.");
                  return;
                }
                if (role !== "farmer" && role !== "buyer") {
                  toast.error("Only farmer and buyer registration is currently available.");
                  return;
                }
                setIsSubmitting(true);
                try {
                  const user = await registerFarmer(name, phone, pin, role);
                  setUser(user.user_id, user.role, user.name);
                  toast.success("Account created successfully", {
                    description: `Welcome to AgriSense, ${user.name}!`,
                  });
                  navigate({ to: "/dashboard" });
                } catch (error) {
                  toast.error("Registration failed", {
                    description: getAuthErrorMessage(error, "register"),
                  });
                } finally {
                  setIsSubmitting(false);
                }
              }}
            >
              <div>
                <label className="text-sm text-muted-foreground" htmlFor="name">
                  {t("Full name")}
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ramesh Patil"
                  required
                  className="mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
                />
              </div>
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
                  {t("Set a 4-digit PIN")}
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
              
              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                {isSubmitting
                  ? role === "buyer" ? "Creating buyer account..." : "Creating farmer account..."
                  : role === "buyer" ? "Create buyer account" : t("Create farmer account")} <ArrowRight className="h-4 w-4" />
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
                onClick={() => handleGoogleLogin()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                {t("Continue with Google")}
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
                setUser(1, role as UserRole, name);
                toast.success("Account created successfully", {
                  description: `Welcome to AgriSense, ${name}!`,
                });
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
                {t("Verify OTP & Create account")} <ArrowRight className="h-4 w-4" />
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

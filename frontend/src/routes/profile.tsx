import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { BadgeCheck, Save, ShieldAlert } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { getSession, refreshSession } from "@/services/session";
import { LANGUAGES, useI18n, type LangCode } from "@/lib/i18n";
import { MyFpoCard } from "@/components/fpo/farmer-fpo";
import { useMyProfile, useUpdateProfile } from "@/hooks/use-market";
import { ErrorNote, Input, Loading, Select, shortDate } from "@/components/fpo/fpo-ui";
import { inrAmount } from "@/lib/deal-format";
import type { UrgencyLevel } from "@/services/api-client";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile — AgriSense" },
      {
        name: "description",
        content: "Your name, location, selling urgency and language, used across AgriSense.",
      },
      { property: "og:title", content: "Profile — AgriSense" },
      {
        property: "og:description",
        content: "Keep your location and preferences up to date for accurate prices and freight.",
      },
    ],
  }),
  component: ProfilePage,
});

const URGENCY: { value: UrgencyLevel; label: string }[] = [
  { value: "high", label: "High — I need to sell soon" },
  { value: "medium", label: "Medium — I can wait a little" },
  { value: "low", label: "Low — I can store and wait for a better price" },
];

function ProfilePage() {
  const { t, setLang } = useI18n();
  const isBuyer = getSession()?.role === "buyer";
  const profile = useMyProfile();
  const save = useUpdateProfile();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [urgency, setUrgency] = useState<UrgencyLevel>("medium");
  const [language, setLanguage] = useState("en");

  // Fill the form once the profile arrives.
  useEffect(() => {
    const p = profile.data;
    if (!p) return;
    setName(p.name);
    setLocation(p.location ?? "");
    setUrgency(p.urgency_level ?? "medium");
    setLanguage(p.preferred_language ?? "en");
  }, [profile.data]);

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate(
      {
        name: name.trim(),
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(isBuyer ? {} : { urgency_level: urgency }),
        preferred_language: language,
      },
      {
        onSuccess: (p) => {
          const session = getSession();
          if (session)
            refreshSession({
              user_id: session.userId,
              role: session.role,
              name: p.name,
              status: session.status,
            });
          setLang(language as LangCode);
          toast.success(t("Profile saved"));
        },
        onError: (err) => toast.error(t("Could not save profile"), { description: err.message }),
      },
    );
  }

  const p = profile.data;

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Account"
        title="Profile"
        description={
          isBuyer
            ? "Your business name and delivery location, used on offers, orders and invoices."
            : "Your location and selling urgency feed the mandi prices, freight and sell/hold advice you see."
        }
        action={
          p && isBuyer ? (
            p.verified ? (
              <Pill tone="green">
                <BadgeCheck className="h-3.5 w-3.5" /> {t("Verified buyer")}
              </Pill>
            ) : (
              <Pill tone="amber">
                <ShieldAlert className="h-3.5 w-3.5" /> {t("Verification pending")}
              </Pill>
            )
          ) : undefined
        }
      />

      {!isBuyer && <MyFpoCard />}

      <ErrorNote error={profile.error} />
      {profile.isLoading ? (
        <Loading />
      ) : p ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {isBuyer ? (
              <>
                <Metric label="Open requirements" value={p.stats.open_requirements} />
                <Metric label="Orders" value={p.stats.deals} />
                <Metric label="Order value" value={inrAmount(p.stats.deal_value)} />
                <Metric
                  label="Trust score"
                  value={p.trust_score != null ? `${p.trust_score.toFixed(1)}/5` : "—"}
                  hint={t("Set by the AgriSense admin")}
                />
              </>
            ) : (
              <>
                <Metric
                  label="Lots listed"
                  value={p.stats.lots}
                  hint={`${p.stats.open_lots} ${t("open")}`}
                />
                <Metric label="Orders" value={p.stats.deals} />
                <Metric label="Sales value" value={inrAmount(p.stats.deal_value)} />
                <Metric label="Member since" value={shortDate(p.member_since)} />
              </>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel>
              <h2 className="font-serif text-2xl">{t("Personal details")}</h2>
              <form onSubmit={submit} className="mt-5 space-y-4">
                <Input
                  label={isBuyer ? "Business name" : "Full name"}
                  required
                  minLength={2}
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Input
                  label={isBuyer ? "Delivery location" : "Farm location"}
                  maxLength={100}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder={t("For example: Ludhiana, Punjab")}
                  hint={
                    p.state
                      ? `${t("Prices and freight use")} ${p.state}.`
                      : t(
                          "Add your district and state so we can pick the right mandi prices and freight.",
                        )
                  }
                />
                {!isBuyer && (
                  <Select
                    label="How soon do you need to sell?"
                    value={urgency}
                    onChange={(e) => setUrgency(e.target.value as UrgencyLevel)}
                  >
                    {URGENCY.map((u) => (
                      <option key={u.value} value={u.value}>
                        {t(u.label)}
                      </option>
                    ))}
                  </Select>
                )}
                <Select
                  label="Preferred language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.native} ({l.label})
                    </option>
                  ))}
                </Select>
                <button
                  type="submit"
                  disabled={save.isPending}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground disabled:opacity-60"
                >
                  <Save className="h-4 w-4" /> {t("Save changes")}
                </button>
              </form>
            </Panel>

            <Panel>
              <h2 className="font-serif text-2xl">{t("Account")}</h2>
              <dl className="mt-5 space-y-3 text-sm">
                {(
                  [
                    ["Mobile number", p.phone],
                    ["Account type", isBuyer ? t("Buyer") : t("Farmer")],
                    ["Status", t(p.status === "active" ? "Active" : p.status)],
                    ["Member since", shortDate(p.member_since)],
                  ] as const
                ).map(([k, v]) => (
                  <div
                    key={k}
                    className="flex justify-between gap-4 border-b border-border pb-3 last:border-0"
                  >
                    <dt className="text-muted-foreground">{t(k)}</dt>
                    <dd className="text-right">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs text-muted-foreground">
                {t("To change your mobile number, contact the AgriSense team.")}
              </p>
            </Panel>
          </div>
        </>
      ) : null}
    </PortalLayout>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, MapPin, Save } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { getProfile, updateProfile, type FarmerProfile } from "@/services";
import { getSession } from "@/services/session";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile & settlement details — AgriSense" },
      {
        name: "description",
        content:
          "Personal details, farm records, bank and settlement account, notification preferences and KYC status.",
      },
      { property: "og:title", content: "Profile & settlement details — AgriSense" },
      {
        property: "og:description",
        content: "Keep farm, bank and alert preferences up to date for accurate payouts.",
      },
    ],
  }),
  component: ProfilePage,
});

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary"
      />
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-border bg-background px-4 py-3 text-left"
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-primary" : "bg-secondary"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-card transition-all ${
            checked ? "left-[1.375rem]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function ProfilePage() {
  const { t } = useI18n();
  const session = getSession();
  const userName = session?.name || "Ramesh Patil";
  const userEmail = `${userName.toLowerCase().replace(/\s+/g, ".")}@agrisense.in`;

  const [profile, setProfile] = useState<FarmerProfile>(() => {
    const p = getProfile();
    // Override mock data with the currently logged in session user
    if (userName !== "Ramesh Patil") {
      p.name = userName;
      p.email = userEmail;
      p.bank.holder = userName;
      p.bank.upiId = `${userName.toLowerCase().replace(/\s+/g, ".")}@upi`;
    }
    return p;
  });

  const set = <K extends keyof FarmerProfile>(key: K, value: FarmerProfile[K]) =>
    setProfile((p) => ({ ...p, [key]: value }));

  const save = async (section: string) => {
    await updateProfile(profile);
    toast.success(`${t(section)} ${t("saved")}`, { description: t("Changes stored on this device.") });
  };

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Account"
        title="Profile"
        description="Personal, farm, settlement and alert details used across every decision on AgriSense."
        action={
          <Pill tone="green">
            <BadgeCheck className="h-3.5 w-3.5" />
            KYC {profile.kyc}
          </Pill>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="space-y-4">
          <h2 className="font-serif text-2xl">{t("Personal details")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Full name")} value={profile.name} onChange={(v) => set("name", v)} />
            <Field label={t("Mobile number")} value={profile.phone} onChange={(v) => set("phone", v)} />
            <Field label={t("Email")} value={profile.email} onChange={(v) => set("email", v)} />
            <Field label={t("Language")} value={profile.language} onChange={(v) => set("language", v)} />
          </div>
          <button
            onClick={() => save("Personal details")}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
          >
            <Save className="h-4 w-4" /> {t("Save changes")}
          </button>
        </Panel>

        <Panel className="space-y-4">
          <h2 className="font-serif text-2xl">{t("Farm details")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Village")} value={profile.village} onChange={(v) => set("village", v)} />
            <Field label={t("District")} value={profile.district} onChange={(v) => set("district", v)} />
            <Field
              label={t("Landholding (acres)")}
              type="number"
              value={profile.landholdingAcres}
              onChange={(v) => set("landholdingAcres", Number(v) || 0)}
            />
            <Field
              label={t("Primary crops")}
              value={profile.primaryCrops}
              onChange={(v) => set("primaryCrops", v)}
            />
            <Field label={t("Soil type")} value={profile.soilType} onChange={(v) => set("soilType", v)} />
            <Field
              label={t("Irrigation")}
              value={profile.irrigation}
              onChange={(v) => set("irrigation", v)}
            />
            <Field
              label={t("Latitude")}
              type="number"
              value={profile.lat}
              onChange={(v) => set("lat", Number(v) || 0)}
            />
            <Field
              label={t("Longitude")}
              type="number"
              value={profile.lng}
              onChange={(v) => set("lng", Number(v) || 0)}
            />
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            {t("Farm gate at")} {profile.lat}, {profile.lng} · {profile.village}, {profile.district},{" "}
            {profile.state}
          </p>
          <button
            onClick={() => save("Farm details")}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
          >
            <Save className="h-4 w-4" /> {t("Save changes")}
          </button>
        </Panel>

        <Panel className="space-y-4">
          <h2 className="font-serif text-2xl">{t("Bank & settlement")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("Account holder")}
              value={profile.bank.holder}
              onChange={(v) => set("bank", { ...profile.bank, holder: v })}
            />
            <Field
              label={t("Account number")}
              value={profile.bank.accountNumber}
              onChange={(v) => set("bank", { ...profile.bank, accountNumber: v })}
            />
            <Field
              label={t("IFSC")}
              value={profile.bank.ifsc}
              onChange={(v) => set("bank", { ...profile.bank, ifsc: v })}
            />
            <Field
              label={t("UPI ID")}
              value={profile.bank.upiId}
              onChange={(v) => set("bank", { ...profile.bank, upiId: v })}
            />
          </div>
          <Toggle
            label={t("Auto-settlement")}
            hint={t("Release balance automatically on delivery confirmation")}
            checked={profile.bank.autoSettlement}
            onChange={(v) => set("bank", { ...profile.bank, autoSettlement: v })}
          />
          <button
            onClick={() => save("Bank details")}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
          >
            <Save className="h-4 w-4" /> {t("Save changes")}
          </button>
        </Panel>

        <Panel className="space-y-4">
          <h2 className="font-serif text-2xl">{t("Notification preferences")}</h2>
          <div className="space-y-3">
            <Toggle
              label={t("Price alerts")}
              hint={t("Mandi price moves above your threshold")}
              checked={profile.notifications.priceAlerts}
              onChange={(v) => set("notifications", { ...profile.notifications, priceAlerts: v })}
            />
            <Toggle
              label={t("Buyer bids")}
              hint={t("New or raised offers on your lots")}
              checked={profile.notifications.buyerBids}
              onChange={(v) => set("notifications", { ...profile.notifications, buyerBids: v })}
            />
            <Toggle
              label={t("Logistics updates")}
              hint={t("Pickup, transit and delivery events")}
              checked={profile.notifications.logistics}
              onChange={(v) => set("notifications", { ...profile.notifications, logistics: v })}
            />
            <Toggle
              label={t("Settlement updates")}
              hint={t("Advances, balances and payment references")}
              checked={profile.notifications.settlements}
              onChange={(v) => set("notifications", { ...profile.notifications, settlements: v })}
            />
            <Toggle
              label={t("WhatsApp delivery")}
              hint={t("Send the same alerts on WhatsApp")}
              checked={profile.notifications.whatsapp}
              onChange={(v) => set("notifications", { ...profile.notifications, whatsapp: v })}
            />
          </div>
          <button
            onClick={() => save("Notification preferences")}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
          >
            <Save className="h-4 w-4" /> {t("Save changes")}
          </button>
        </Panel>
      </div>
    </PortalLayout>
  );
}

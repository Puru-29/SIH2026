import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BadgeCheck, Clock, Save } from "lucide-react";
import { LANGUAGES, useI18n, type LangCode } from "@/lib/i18n";
import { fpoApi, type FpoOrg } from "@/services/fpo-api";
import { PhoneVerifyCard } from "@/components/agri/trust-ui";
import { PlaceFields } from "@/components/agri/place-fields";
import { useMyProfile } from "@/hooks/use-market";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import {
  Btn,
  Card,
  ErrorNote,
  Input,
  Loading,
  PageTitle,
  Select,
  shortDate,
  Table,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/fpo/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const org = useFpoQuery(["org"], fpoApi.org);
  const audit = useFpoQuery(["audit"], fpoApi.audit);
  const [f, setF] = useState<Partial<FpoOrg>>({});
  useEffect(() => {
    if (org.data) setF(org.data);
  }, [org.data]);
  const save = useFpoMutation(
    () =>
      fpoApi.updateOrg({
        name: f.name ?? "",
        registration_no: f.registration_no ?? null,
        district: f.district ?? "",
        state: f.state ?? "",
        contact_phone: f.contact_phone ?? null,
        commission_pct: Number(f.commission_pct ?? 0),
        primary_crops: f.primary_crops ?? "",
      }),
    { success: "Settings saved" },
  );

  if (org.isLoading) return <Loading />;
  return (
    <>
      <PageTitle title="Settings" subtitle="Your FPO profile, service charge and language." />
      <ErrorNote error={org.error} />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card title="FPO profile">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(undefined);
            }}
          >
            <Input
              id="st-name"
              label="FPO name"
              required
              value={f.name ?? ""}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
            <Input
              id="st-reg"
              label="Registration number"
              value={f.registration_no ?? ""}
              onChange={(e) => setF({ ...f, registration_no: e.target.value })}
              hint="Companies Act / Co-operative registration, used for verification"
            />
            <PlaceFields
              idPrefix="st"
              state={f.state ?? ""}
              district={f.district ?? ""}
              onChange={(p) => setF({ ...f, ...p })}
              selectClassName="mt-1 min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                id="st-phone"
                label="Contact mobile"
                inputMode="numeric"
                maxLength={10}
                value={f.contact_phone ?? ""}
                onChange={(e) => setF({ ...f, contact_phone: e.target.value.replace(/\D/g, "") })}
              />
              <Input
                id="st-comm"
                label="FPO service charge (%)"
                type="number"
                min={0}
                max={20}
                step="0.1"
                value={f.commission_pct ?? 0}
                onChange={(e) => setF({ ...f, commission_pct: Number(e.target.value) })}
                hint="Deducted from each sale before farmers are paid"
              />
            </div>
            <Input
              id="st-crops"
              label="Primary crops"
              value={f.primary_crops ?? ""}
              onChange={(e) => setF({ ...f, primary_crops: e.target.value })}
              hint="Used to show you matching buyer demand"
              placeholder="Wheat, Onion, Soybean"
            />
            <div className="flex justify-end">
              <Btn
                type="submit"
                size="lg"
                icon={<Save className="h-5 w-5" />}
                busy={save.isPending}
              >
                {t("Save changes")}
              </Btn>
            </div>
          </form>
        </Card>
        <div className="space-y-5">
          <Card title="Verification">
            {org.data?.verified ? (
              <p className="flex items-center gap-2 text-[var(--fpo-good)]">
                <BadgeCheck className="h-6 w-6" /> {t("Verified by AgriSense admin on")}{" "}
                {shortDate(org.data.verified_at)}
              </p>
            ) : (
              <p className="flex items-start gap-2 text-[var(--fpo-warn)]">
                <Clock className="mt-0.5 h-5 w-5 shrink-0" />
                {t(
                  "Waiting for admin verification. Buyers see your lots as “Not verified” until then. Add your registration number to speed this up.",
                )}
              </p>
            )}
          </Card>
          <PhonePanel />
          <Card title="Language">
            <Select
              id="st-lang"
              label="App language"
              value={lang}
              onChange={(e) => setLang(e.target.value as LangCode)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.native} · {l.label}
                </option>
              ))}
            </Select>
          </Card>
        </div>
      </div>
      <Card title="Activity log" subtitle="Every change made in the FPO portal, newest first.">
        {audit.isLoading ? (
          <Loading />
        ) : (
          <Table head={["When", "Who", "Action", "Details"]}>
            {audit.data?.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap text-sm">{shortDate(a.created_at)}</td>
                <td>{a.actor}</td>
                <td className="whitespace-nowrap">
                  {a.action} · {a.entity}
                  {a.entity_id ? ` #${a.entity_id}` : ""}
                </td>
                <td className="text-sm text-muted-foreground">{a.detail || "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function PhonePanel() {
  const me = useMyProfile();
  return <PhoneVerifyCard verified={Boolean(me.data?.phone_verified)} />;
}

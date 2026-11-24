import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, CheckCircle2, Circle, FileUp, Trash2 } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { PageHeader, Panel } from "@/components/agri/ui-bits";
import { BuyerTrustBadge, PhoneVerifyCard } from "@/components/agri/trust-ui";
import { CameraCapture } from "@/components/agri/camera-capture";
import { Input, Loading, Select } from "@/components/fpo/fpo-ui";
import { useI18n } from "@/lib/i18n";
import { INDIAN_STATES } from "@/lib/states";
import { cn } from "@/lib/utils";
import { inrAmount as rupees } from "@/lib/deal-format";
import {
  openDocument,
  readFile,
  verificationApi,
  type BusinessType,
  type DocKind,
  type Verification,
} from "@/services/verification-api";

export const Route = createFileRoute("/verification")({
  head: () => ({ meta: [{ title: "Verification — AgriSense" }] }),
  component: () => (
    <PortalLayout roles={["buyer"]}>
      <VerificationPage />
    </PortalLayout>
  ),
});

const TYPES: { id: BusinessType; label: string }[] = [
  { id: "individual", label: "Individual trader / commission agent" },
  { id: "proprietorship", label: "Proprietorship" },
  { id: "partnership", label: "Partnership / LLP" },
  { id: "company", label: "Company" },
];

const ID_TYPES = ["PAN card", "Voter ID", "Driving licence", "Passport", "Masked Aadhaar"];
const BIZ_TYPES: Record<BusinessType, string[]> = {
  individual: ["APMC trader licence", "Udyam certificate", "3-month bank statement"],
  proprietorship: [
    "GST certificate",
    "Udyam certificate",
    "Shop & Establishment certificate",
    "APMC licence",
    "FSSAI licence",
  ],
  partnership: ["Partnership deed + firm PAN", "LLP certificate + firm PAN"],
  company: ["Certificate of incorporation + company PAN"],
};

function VerificationPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["my-verification"], queryFn: verificationApi.mine });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["my-verification"] });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <p className="text-destructive">{q.error?.message}</p>;
  const v = q.data;

  return (
    <>
      <PageHeader
        eyebrow="Buyer verification"
        title="Get verified to trade"
        description="Farmers and FPOs see your badge on every offer. Aadhaar and GST are never compulsory."
      />
      <Status v={v} onDeleted={refresh} />
      <Panel>
        <Step n={1} done={v.phone_verified} title="Verify your phone" />
        <div className="mt-3">
          <PhoneVerifyCard verified={v.phone_verified} onVerified={refresh} />
        </div>
      </Panel>
      <DetailsForm v={v} onSaved={refresh} />
      <Documents v={v} onChange={refresh} />
      <Submit v={v} onDone={refresh} />
    </>
  );
}

function Step({ n, done, title }: { n: number; done: boolean; title: string }) {
  const { t } = useI18n();
  return (
    <p className="flex items-center gap-2 font-serif text-xl">
      {done ? (
        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
      ) : (
        <Circle className="h-5 w-5 text-muted-foreground" />
      )}
      {n}. {t(title)}
    </p>
  );
}

function Status({ v, onDeleted }: { v: Verification; onDeleted: () => void }) {
  const { t } = useI18n();
  const level = v.badge.level;
  return (
    <Panel className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <BuyerTrustBadge badge={v.badge} className="text-sm" />
        <span className="text-sm text-muted-foreground">
          {level === 0
            ? t("You can browse and post requirements. Offers unlock at ID Verified.")
            : level === 1
              ? `${t("Offers up to")} ${rupees(v.order_limit)} ${t("per order.")}`
              : t("No order limit.")}
        </span>
        <span className="ml-auto rounded-full bg-secondary px-3 py-1 text-xs">
          {t("Application")}: {t(v.status)}
        </span>
      </div>
      {v.details?.admin_note && v.status === "rejected" && (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-900">{v.details.admin_note}</p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {level < 1 && <Missing title="Still needed for ID Verified" items={v.missing_level1} />}
        {level < 2 && (
          <Missing title="Still needed for Verified Business" items={v.missing_level2} />
        )}
      </div>
      {v.documents.length > 0 && (
        <button
          onClick={async () => {
            if (!window.confirm(t("Delete all your uploaded documents? This cannot be undone.")))
              return;
            await verificationApi.deleteMyDocuments();
            toast.success(t("Your documents were deleted"));
            onDeleted();
          }}
          className="inline-flex items-center gap-1.5 text-xs text-destructive hover:underline"
        >
          <Trash2 className="h-3.5 w-3.5" /> {t("Delete my documents")}
        </button>
      )}
    </Panel>
  );
}

function Missing({ title, items }: { title: string; items: string[] }) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl bg-secondary p-4 text-sm">
      <p className="font-medium">{t(title)}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-emerald-700">{t("Everything is in. Waiting for admin review.")}</p>
      ) : (
        <ul className="mt-1 list-disc pl-5 text-muted-foreground">
          {items.map((i) => (
            <li key={i}>{t(i)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DetailsForm({ v, onSaved }: { v: Verification; onSaved: () => void }) {
  const { t } = useI18n();
  const d = v.details;
  const [f, setF] = useState({
    business_type: (d?.business_type ?? "individual") as BusinessType,
    business_name: d?.business_name || v.name,
    address: d?.address ?? "",
    district: d?.district ?? "",
    state: d?.state ?? "",
    pincode: d?.pincode ?? "",
    crops_bought: d?.crops_bought ?? "",
    monthly_capacity_quintals: d?.monthly_capacity_quintals
      ? String(d.monthly_capacity_quintals)
      : "",
    gstin: d?.gstin ?? "",
    pan: d?.pan ?? "",
    bank_holder_name: d?.bank_holder_name ?? "",
    bank_account: "",
    bank_account_confirm: "",
    bank_ifsc: d?.bank_ifsc ?? "",
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (d?.business_type) setF((x) => ({ ...x, business_type: d.business_type! }));
  }, [d?.business_type]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const opt = (s: string) => (s.trim() ? s.trim() : undefined);
      await verificationApi.saveDetails({
        business_type: f.business_type,
        business_name: f.business_name,
        address: f.address,
        district: f.district,
        state: f.state,
        pincode: f.pincode,
        crops_bought: f.crops_bought,
        monthly_capacity_quintals: Number(f.monthly_capacity_quintals),
        ...(opt(f.gstin) ? { gstin: opt(f.gstin)! } : {}),
        ...(opt(f.pan) ? { pan: opt(f.pan)! } : {}),
        ...(opt(f.bank_holder_name) ? { bank_holder_name: opt(f.bank_holder_name)! } : {}),
        ...(opt(f.bank_account)
          ? { bank_account: f.bank_account, bank_account_confirm: f.bank_account_confirm }
          : {}),
        ...(opt(f.bank_ifsc) ? { bank_ifsc: opt(f.bank_ifsc)! } : {}),
      });
      setF((x) => ({ ...x, bank_account: "", bank_account_confirm: "" }));
      toast.success(t("Details saved"));
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <form onSubmit={save} className="space-y-6">
        <div>
          <Step
            n={2}
            done={v.missing_level1.every((m) => !m.startsWith("Business type"))}
            title="Business details"
          />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {TYPES.map((ty) => (
              <button
                type="button"
                key={ty.id}
                onClick={() => setF({ ...f, business_type: ty.id })}
                aria-pressed={f.business_type === ty.id}
                className={cn(
                  "min-h-12 rounded-xl border px-4 text-left text-sm",
                  f.business_type === ty.id ? "border-primary bg-accent" : "border-border",
                )}
              >
                {t(ty.label)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Business or shop name"
            required
            value={f.business_name}
            onChange={set("business_name")}
          />
          <Input
            label="Crops you buy"
            required
            placeholder="Onion, Potato"
            value={f.crops_bought}
            onChange={set("crops_bought")}
          />
          <Input label="Address" required value={f.address} onChange={set("address")} />
          <Input label="District" value={f.district} onChange={set("district")} />
          <Select label="State" value={f.state} onChange={set("state")}>
            <option value="">{t("Choose state")}</option>
            {INDIAN_STATES.map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </Select>
          <Input
            label="PIN code"
            required
            inputMode="numeric"
            maxLength={6}
            value={f.pincode}
            onChange={set("pincode")}
          />
          <Input
            label="Monthly buying capacity (quintals)"
            required
            type="number"
            min={1}
            value={f.monthly_capacity_quintals}
            onChange={set("monthly_capacity_quintals")}
          />
          <Input
            label="PAN (optional)"
            placeholder="ABCDE1234F"
            maxLength={10}
            value={f.pan}
            onChange={set("pan")}
          />
          <Input
            label="GSTIN (optional)"
            placeholder="27AAPFU0939F1ZV"
            maxLength={15}
            value={f.gstin}
            onChange={set("gstin")}
            hint={
              d?.gst_registered
                ? "GST registered ✓"
                : "Not required. Shown as “GST registered” if valid."
            }
          />
        </div>
        <div>
          <p className="font-medium">{t("Bank account (for Verified Business)")}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Input
              label="Account holder name"
              value={f.bank_holder_name}
              onChange={set("bank_holder_name")}
            />
            <Input
              label="IFSC"
              placeholder="SBIN0001234"
              maxLength={11}
              value={f.bank_ifsc}
              onChange={set("bank_ifsc")}
            />
            <Input
              label={
                d?.bank_account_masked
                  ? `Account number (saved: ${d.bank_account_masked})`
                  : "Account number"
              }
              inputMode="numeric"
              autoComplete="off"
              value={f.bank_account}
              onChange={set("bank_account")}
            />
            <Input
              label="Account number again"
              inputMode="numeric"
              autoComplete="off"
              value={f.bank_account_confirm}
              onChange={set("bank_account_confirm")}
            />
          </div>
          {d?.bank_holder_mismatch && (
            <p className="mt-2 text-xs text-amber-800">
              {t(
                "The account holder name doesn't match your name or business name. The admin will check this.",
              )}
            </p>
          )}
        </div>
        <button
          disabled={busy}
          className="min-h-12 rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {t("Save details")}
        </button>
      </form>
    </Panel>
  );
}

function Documents({ v, onChange }: { v: Verification; onChange: () => void }) {
  const { t } = useI18n();
  const bt = (v.details?.business_type ?? "individual") as BusinessType;
  const kinds: { kind: DocKind; title: string; options: string[] }[] = [
    { kind: "id_proof", title: "ID proof", options: ID_TYPES },
    ...(bt === "company"
      ? [
          {
            kind: "authorisation" as DocKind,
            title: "Authorisation letter",
            options: ["Authorisation letter", "Board resolution"],
          },
        ]
      : []),
    { kind: "business_proof", title: "Business proof", options: BIZ_TYPES[bt] },
    { kind: "bank_proof", title: "Bank proof", options: ["Cancelled cheque", "Passbook page"] },
  ];
  return (
    <Panel className="space-y-5">
      <Step n={3} done={v.missing_level2.length === 0} title="Documents" />
      <p className="text-sm text-muted-foreground">
        {t(
          "PDF, JPG, PNG or WEBP, up to 2 MB. Files are encrypted and only you and the AgriSense admin can open them.",
        )}
      </p>
      {kinds.map((k) => (
        <DocRow
          key={k.kind}
          v={v}
          kind={k.kind}
          title={k.title}
          options={k.options}
          hint={v.expected_documents[k.kind]}
          onChange={onChange}
        />
      ))}
      <ShopPhoto v={v} onChange={onChange} />
    </Panel>
  );
}

function DocStatus({ v, kind }: { v: Verification; kind: DocKind }) {
  const { t } = useI18n();
  const doc = v.documents.find((d) => d.kind === kind);
  if (!doc) return <span className="text-xs text-muted-foreground">{t("Not uploaded")}</span>;
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <button
        className="underline"
        onClick={() => void openDocument(doc.id, false).catch((e: Error) => toast.error(e.message))}
      >
        {doc.doc_type}
      </button>
      <span
        className={cn(
          "rounded-full px-2 py-0.5",
          doc.status === "approved"
            ? "bg-emerald-100 text-emerald-900"
            : doc.status === "rejected"
              ? "bg-red-100 text-red-900"
              : "bg-amber-100 text-amber-900",
        )}
      >
        {t(doc.status)}
      </span>
      {doc.rejection_reason && <span className="text-red-800">{doc.rejection_reason}</span>}
    </span>
  );
}

function DocRow({
  v,
  kind,
  title,
  options,
  hint,
  onChange,
}: {
  v: Verification;
  kind: DocKind;
  title: string;
  options: string[];
  hint: string | undefined;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const [docType, setDocType] = useState(options[0]!);
  const [masked, setMasked] = useState(false);
  const [busy, setBusy] = useState(false);
  const doc = v.documents.find((d) => d.kind === kind);
  const isAadhaar = docType.toLowerCase().includes("aadhaar");
  return (
    <div className="space-y-2 rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{t(title)}</p>
        <DocStatus v={v} kind={kind} />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{t(hint)}</p>}
      {doc?.status !== "approved" && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            aria-label={t("Document type")}
            className="min-h-11 rounded-xl border border-border bg-background px-3 text-sm"
          >
            {options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          {isAadhaar && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={masked}
                onChange={(e) => setMasked(e.target.checked)}
              />
              {t("This copy is masked: only the last 4 digits are visible")}
            </label>
          )}
          <label
            className={cn(
              "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-border px-4 text-sm hover:bg-secondary",
              (busy || (isAadhaar && !masked)) && "pointer-events-none opacity-50",
            )}
          >
            <FileUp className="h-4 w-4" />
            {doc ? t("Re-upload") : t("Upload")}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (file.size > 2 * 1024 * 1024) {
                  toast.error(t("Files must be 2 MB or smaller"));
                  return;
                }
                setBusy(true);
                try {
                  await verificationApi.upload({
                    kind,
                    doc_type: docType,
                    file_name: file.name,
                    data_base64: await readFile(file),
                    masked_aadhaar_confirmed: masked,
                  });
                  toast.success(t("Uploaded"));
                  onChange();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function ShopPhoto({ v, onChange }: { v: Verification; onChange: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const doc = v.documents.find((d) => d.kind === "shop_photo");
  return (
    <div className="space-y-2 rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{t("Shop or warehouse photo")}</p>
        <DocStatus v={v} kind="shop_photo" />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("Take a live photo of your shop or warehouse with its name board visible. Camera only.")}
      </p>
      {doc?.status !== "approved" && (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm"
        >
          <Camera className="h-4 w-4" /> {doc ? t("Retake photo") : t("Take photo")}
        </button>
      )}
      <CameraCapture
        open={open}
        title="Photo of your shop or warehouse"
        onClose={() => setOpen(false)}
        onCapture={async (p) => {
          try {
            await verificationApi.upload({
              kind: "shop_photo",
              doc_type: "Shop / warehouse photo",
              file_name: "shop.jpg",
              data_base64: p.data_base64,
            });
            toast.success(t("Photo saved"));
            onChange();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
          }
        }}
      />
    </div>
  );
}

function Submit({ v, onDone }: { v: Verification; onDone: () => void }) {
  const { t } = useI18n();
  const [consent, setConsent] = useState(Boolean(v.details?.consent_at));
  const [busy, setBusy] = useState(false);
  return (
    <Panel className="space-y-3">
      <Step
        n={4}
        done={v.status === "submitted" || v.status === "approved"}
        title="Consent and submit"
      />
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          {t(
            "I agree that AgriSense stores my documents encrypted and the admin checks them to verify my business. Rejected documents are deleted after 30 days, and I can delete my documents at any time.",
          )}
        </span>
      </label>
      <button
        disabled={!consent || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await verificationApi.submit(consent);
            toast.success(t("Sent for review. You'll get a notification."));
            onDone();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
        className="min-h-12 rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {v.status === "submitted" ? t("Send again for review") : t("Submit for review")}
      </button>
    </Panel>
  );
}

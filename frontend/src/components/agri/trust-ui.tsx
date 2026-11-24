import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Copy, MessageCircle, Phone, ShieldCheck, Star } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { verificationApi, type BuyerBadge, type Contact } from "@/services/verification-api";

const STYLE: Record<BuyerBadge["label"], string> = {
  "Trusted Buyer": "bg-emerald-600 text-white",
  "Verified Business": "bg-emerald-100 text-emerald-900",
  "ID Verified": "bg-sky-100 text-sky-900",
  Unverified: "bg-secondary text-muted-foreground",
};

/** The one buyer badge used everywhere. Pass `badge` if known, else `buyerId` to look it up. */
export function BuyerTrustBadge({
  badge,
  buyerId,
  className,
}: {
  badge?: BuyerBadge | null | undefined;
  buyerId?: number | undefined;
  className?: string;
}) {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["buyer-badge", buyerId],
    queryFn: () => verificationApi.badge(buyerId!),
    enabled: !badge && !!buyerId,
    staleTime: 5 * 60_000,
  });
  const b = badge ?? q.data;
  if (!b) return null;
  const Icon = b.trusted ? Star : b.level > 0 ? BadgeCheck : ShieldCheck;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        STYLE[b.label],
        className,
      )}
      title={t(b.label)}
    >
      <Icon className="h-3 w-3" /> {t(b.label)}
    </span>
  );
}

function waNumber(phone: string) {
  const d = phone.replace(/\D/g, "");
  return d.length === 10 ? `91${d}` : d;
}

/** The other party of an accepted deal, with Call and WhatsApp buttons. */
export function ContactCard({ contact }: { contact: Contact | null | undefined }) {
  const { t } = useI18n();
  if (!contact) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border p-4">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {contact.business_name || contact.name}
          {contact.badge && <BuyerTrustBadge badge={contact.badge} />}
        </p>
        {contact.business_name && <p className="text-xs text-muted-foreground">{contact.name}</p>}
        <p className="mt-1 text-xs">
          {contact.phone_verified ? (
            <span className="inline-flex items-center gap-0.5 text-emerald-700">
              <BadgeCheck className="h-3.5 w-3.5" /> {t("Phone verified")}
            </span>
          ) : (
            <span className="text-muted-foreground">{t("Phone not verified")}</span>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* The number is shown, not dialled from the app. */}
        <span className="inline-flex min-h-11 select-all items-center gap-2 rounded-full border border-border bg-secondary px-4 text-sm font-medium tabular-nums">
          <Phone className="h-4 w-4 text-muted-foreground" aria-hidden />
          +91 {contact.phone}
        </span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(`+91${contact.phone}`)
              .then(() => toast.success(t("Number copied")))
              .catch(() => toast.error(t("Could not copy. Select the number instead.")));
          }}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-4 text-sm hover:bg-secondary"
          aria-label={t("Copy phone number")}
        >
          <Copy className="h-4 w-4" /> {t("Copy")}
        </button>
        <a
          href={`https://wa.me/${waNumber(contact.phone)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 text-sm text-primary-foreground"
        >
          <MessageCircle className="h-4 w-4" /> WhatsApp
        </a>
      </div>
    </div>
  );
}

/** Contact for an order (fetched separately so it is only requested by the parties). */
export function OrderContact({ txId }: { txId: number }) {
  const q = useQuery({
    queryKey: ["order-contact", txId],
    queryFn: () => verificationApi.orderContact(txId),
    staleTime: 5 * 60_000,
  });
  return <ContactCard contact={q.data} />;
}

/** Phone OTP card for profile pages (farmer, buyer, FPO). */
export function PhoneVerifyCard({
  verified,
  onVerified,
}: {
  verified: boolean;
  onVerified?: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [sent, setSent] = useState<{ to: string; test: string | null } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  if (verified) {
    return (
      <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">
        <BadgeCheck className="h-4 w-4" /> {t("Phone number verified")}
      </p>
    );
  }
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 rounded-2xl border border-border p-4">
      <p className="font-medium">{t("Verify your phone number")}</p>
      {!sent ? (
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await verificationApi.sendOtp();
              setSent({ to: r.sent_to, test: r.test_code });
            })
          }
          className="min-h-11 rounded-xl bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50"
        >
          {t("Send code")}
        </button>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await verificationApi.verifyOtp(code);
              toast.success(t("Phone number verified"));
              void qc.invalidateQueries();
              onVerified?.();
            });
          }}
        >
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            aria-label={t("6-digit code")}
            placeholder="••••••"
            className="w-32 rounded-xl border border-border bg-background px-3 py-2.5 text-center tracking-[0.3em]"
          />
          <button
            disabled={busy || code.length !== 6}
            className="min-h-11 rounded-xl bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50"
          >
            {t("Verify")}
          </button>
          <span className="w-full text-xs text-muted-foreground">
            {t("Code sent to")} {sent.to}.{" "}
            {sent.test && (
              <strong className="text-amber-800">
                {t("Use code")} {sent.test}
              </strong>
            )}
          </span>
        </form>
      )}
    </div>
  );
}

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Btn, Card, Empty, ErrorNote, Loading } from "@/components/fpo/fpo-ui";
import { BuyerTrustBadge } from "@/components/agri/trust-ui";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { openDocument, verificationApi, type VerificationDoc } from "@/services/verification-api";

const KIND_LABEL: Record<string, string> = {
  id_proof: "ID proof",
  authorisation: "Authorisation",
  business_proof: "Business proof",
  bank_proof: "Bank proof",
  shop_photo: "Shop photo (live camera)",
};

/** Admin → Verification → Buyers: queue, detail, per-document review, grant levels. */
export function BuyerVerificationAdmin() {
  const { t } = useI18n();
  const [filter, setFilter] = useState("submitted");
  const [open, setOpen] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ["admin-buyer-queue", filter],
    queryFn: () => verificationApi.queue(filter),
  });
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <Card title="Buyer applications">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {["submitted", "approved", "rejected", "draft", ""].map((s) => (
            <button
              key={s || "all"}
              onClick={() => setFilter(s)}
              className={cn(
                "rounded-full px-3 py-1 text-xs",
                filter === s ? "bg-primary text-primary-foreground" : "bg-secondary",
              )}
            >
              {t(s || "all")}
            </button>
          ))}
        </div>
        <ErrorNote error={q.error} />
        {q.isLoading ? (
          <Loading />
        ) : !q.data?.length ? (
          <Empty title="No buyers here" />
        ) : (
          <ul className="space-y-2">
            {q.data.map((r) => (
              <li key={r.buyer_id}>
                <button
                  onClick={() => setOpen(r.buyer_id)}
                  className={cn(
                    "w-full rounded-xl border p-3 text-left text-sm",
                    open === r.buyer_id ? "border-primary bg-accent" : "border-border",
                  )}
                >
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {r.business_name || r.name}
                    <BuyerTrustBadge badge={r.badge} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.name} · {r.pending_documents} {t("documents to check")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open ? (
        <BuyerDetail id={open} />
      ) : (
        <Card title="Select an application">
          <Empty title="Pick a buyer on the left" />
        </Card>
      )}
    </div>
  );
}

function BuyerDetail({ id }: { id: number }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-buyer", id], queryFn: () => verificationApi.detail(id) });
  const [note, setNote] = useState("");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin-buyer", id] });
    void qc.invalidateQueries({ queryKey: ["admin-buyer-queue"] });
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(t(ok));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  if (q.isLoading) return <Loading />;
  const v = q.data;
  if (!v) return <ErrorNote error={q.error} />;
  const d = v.details;
  const row = (k: string, val: string | number | null | undefined) => (
    <div key={k} className="flex justify-between gap-3 border-b border-border py-1.5 text-sm">
      <span className="text-muted-foreground">{t(k)}</span>
      <span className="text-right">{val || "—"}</span>
    </div>
  );
  return (
    <Card title={d?.business_name || v.name} subtitle={`${v.name} · +91 ${v.phone ?? ""}`}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <BuyerTrustBadge badge={v.badge} />
        <span className="text-xs">
          {v.phone_verified ? t("Phone verified ✓") : t("Phone not verified")}
        </span>
        <span className="text-xs text-muted-foreground">· {t(v.status)}</span>
      </div>
      <div className="grid gap-x-6 md:grid-cols-2">
        {row("Business type", d?.business_type)}
        {row("Address", [d?.address, d?.district, d?.state, d?.pincode].filter(Boolean).join(", "))}
        {row("Crops bought", d?.crops_bought)}
        {row("Monthly capacity (q)", d?.monthly_capacity_quintals)}
        {row("PAN", d?.pan)}
        {row("GSTIN", d?.gstin ? `${d.gstin} (GST registered)` : "Not given")}
        {row("Bank holder", d?.bank_holder_name)}
        {row("Account", d?.bank_account_masked)}
        {row("IFSC", d?.bank_ifsc)}
        {row("Completed deals", v.trust_facts?.completed_deals)}
      </div>
      {d?.bank_holder_mismatch && (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
          {t("Flag: bank account holder name does not match the buyer or business name.")}
        </p>
      )}
      <h3 className="mt-6 font-medium">{t("Documents")}</h3>
      <p className="text-xs text-muted-foreground">
        {t("Every document you open is recorded in the audit log.")}
      </p>
      {v.documents.length === 0 ? (
        <Empty title="No documents uploaded" />
      ) : (
        <ul className="mt-2 space-y-2">
          {v.documents.map((doc) => (
            <DocReview
              key={doc.id}
              doc={doc}
              hint={v.expected_documents[doc.kind]}
              onDone={refresh}
            />
          ))}
        </ul>
      )}
      <div className="mt-6 space-y-3 rounded-2xl bg-secondary p-4">
        <MissingList
          title="Missing for Level 1 (approved documents)"
          items={v.missing_level1_approved ?? []}
        />
        <MissingList
          title="Missing for Level 2 (approved documents)"
          items={v.missing_level2_approved ?? []}
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("Note or reason (a reason is required to send back)")}
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <Btn
            onClick={() => void act(() => verificationApi.grant(id, 1, note), "Level 1 granted")}
          >
            {t("Grant Level 1 (ID Verified)")}
          </Btn>
          <Btn
            onClick={() => void act(() => verificationApi.grant(id, 2, note), "Level 2 granted")}
          >
            {t("Grant Level 2 (Verified Business)")}
          </Btn>
          <Btn
            variant="ghost"
            onClick={() =>
              void act(() => verificationApi.reject(id, note), "Sent back to the buyer")
            }
          >
            {t("Send back")}
          </Btn>
        </div>
      </div>
    </Card>
  );
}

function MissingList({ title, items }: { title: string; items: string[] }) {
  const { t } = useI18n();
  return (
    <div className="text-sm">
      <p className="font-medium">{t(title)}</p>
      {items.length === 0 ? (
        <p className="text-emerald-700">{t("Nothing missing")}</p>
      ) : (
        <ul className="list-disc pl-5 text-muted-foreground">
          {items.map((i) => (
            <li key={i}>{t(i)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DocReview({
  doc,
  hint,
  onDone,
}: {
  doc: VerificationDoc;
  hint: string | undefined;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const review = async (action: "approve" | "reject") => {
    try {
      await verificationApi.reviewDoc(doc.id, action, reason || undefined);
      toast.success(t(action === "approve" ? "Approved" : "Rejected"));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <li className="rounded-xl border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <strong>{t(KIND_LABEL[doc.kind] ?? doc.kind)}</strong> · {doc.doc_type}
          {doc.masked_aadhaar_confirmed && (
            <span className="ml-1 text-xs">({t("buyer says masked")})</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{t(doc.status)}</span>
          <button
            className="text-xs underline"
            onClick={() =>
              void openDocument(doc.id, true).catch((e: Error) => toast.error(e.message))
            }
          >
            {t("Open")}
          </button>
        </span>
      </div>
      {hint && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("Expected")}: {t(hint)}
        </p>
      )}
      {doc.rejection_reason && <p className="mt-1 text-xs text-red-800">{doc.rejection_reason}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("Reason (required to reject)")}
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
        />
        <Btn size="sm" onClick={() => void review("approve")}>
          {t("Approve")}
        </Btn>
        <Btn size="sm" variant="ghost" onClick={() => void review("reject")}>
          {t("Reject")}
        </Btn>
      </div>
    </li>
  );
}

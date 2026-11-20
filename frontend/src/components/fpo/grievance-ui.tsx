import { useState } from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { openProtectedFile } from "@/services/api-client";
import {
  documentPath,
  type Grievance,
  type GrievanceCategory,
  type GrievanceInput,
  type Upload,
} from "@/services/fpo-api";
import {
  Badge,
  Btn,
  FileInput,
  FormActions,
  Input,
  Modal,
  Select,
  shortDate,
  TextArea,
} from "./fpo-ui";

export const CATEGORY_LABEL: Record<GrievanceCategory, string> = {
  payment_delay: "Payment delay",
  quality_dispute: "Quality dispute",
  buyer_issue: "Buyer issue",
  other: "Other",
};

export function GrievanceCard({
  g,
  actions,
}: {
  g: Grievance;
  actions?: React.ReactNode | undefined;
}) {
  const { t } = useI18n();
  return (
    <div className="fpo-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            #{g.id} · {t(CATEGORY_LABEL[g.category])} · {shortDate(g.created_at)}
          </p>
          <p className="mt-0.5 text-lg font-semibold">{g.subject}</p>
          <p className="text-sm text-muted-foreground">
            {t("Raised by")} {g.raised_by_name} ({t(g.raised_by_role === "fpo" ? "FPO" : "Farmer")})
            {g.member_name && g.raised_by_role === "fpo"
              ? ` · ${t("Farmer")}: ${g.member_name}`
              : ""}
            {g.sale_id ? ` · ${t("Sale")} #${g.sale_id}` : ""}
          </p>
        </div>
        <Badge status={g.status} />
      </div>
      <p className="mt-3 whitespace-pre-line text-[0.95rem]">{g.description}</p>
      {g.documents.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {g.documents.map((d) => (
            <Btn
              key={d.id}
              size="sm"
              variant="outline"
              icon={<FileText className="h-4 w-4" />}
              onClick={() =>
                openProtectedFile(documentPath(d.id)).catch((e: Error) => toast.error(e.message))
              }
            >
              {d.file_name}
            </Btn>
          ))}
        </div>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-primary">
          {t("History")} ({g.events.length})
        </summary>
        <ol className="mt-2 space-y-1.5 border-l-2 border-accent pl-4">
          {g.events.map((e) => (
            <li key={e.id}>
              <Badge status={e.status} />{" "}
              <span className="text-muted-foreground">
                {e.actor_name} · {shortDate(e.created_at)}
              </span>
              {e.note && <p className="mt-0.5">{e.note}</p>}
            </li>
          ))}
        </ol>
      </details>
      {actions && <div className="mt-4 flex flex-wrap gap-2.5">{actions}</div>}
    </div>
  );
}

export function GrievanceForm({
  onSubmit,
  onClose,
  busy,
  sales,
  members,
  fpos,
}: {
  onSubmit: (b: GrievanceInput) => void;
  onClose: () => void;
  busy?: boolean | undefined;
  sales?: { id: number; label: string }[] | undefined;
  members?: { id: number; label: string }[] | undefined;
  fpos?: { id: number; label: string }[] | undefined;
}) {
  const { t } = useI18n();
  const [f, setF] = useState({
    fpo: fpos?.[0]?.id ? String(fpos[0].id) : "",
    category: "payment_delay" as GrievanceCategory,
    subject: "",
    description: "",
    sale: "",
    member: "",
  });
  const [doc, setDoc] = useState<Upload | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title="Report a problem"
      subtitle="Payment delays, quality disputes or buyer issues. You can attach a photo or document."
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            ...(f.fpo ? { fpo_id: Number(f.fpo) } : {}),
            category: f.category,
            subject: f.subject,
            description: f.description,
            sale_id: f.sale ? Number(f.sale) : undefined,
            member_id: f.member ? Number(f.member) : undefined,
            document: doc ?? undefined,
          });
        }}
      >
        {fpos && fpos.length > 1 && (
          <Select
            id="gr-fpo"
            label="FPO"
            value={f.fpo}
            onChange={(e) => setF({ ...f, fpo: e.target.value })}
          >
            {fpos.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </Select>
        )}
        <Select
          id="gr-cat"
          label="Type of problem"
          value={f.category}
          onChange={(e) => setF({ ...f, category: e.target.value as GrievanceCategory })}
        >
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {t(v)}
            </option>
          ))}
        </Select>
        <Input
          id="gr-sub"
          label="Subject"
          required
          minLength={3}
          value={f.subject}
          onChange={(e) => setF({ ...f, subject: e.target.value })}
        />
        <TextArea
          id="gr-desc"
          label="What happened?"
          required
          minLength={10}
          rows={4}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          hint="At least 10 characters"
        />
        {sales && sales.length > 0 && (
          <Select
            id="gr-sale"
            label="Related sale (optional)"
            value={f.sale}
            onChange={(e) => setF({ ...f, sale: e.target.value })}
            hint="Linking a sale puts its payments on hold as Disputed until resolved"
          >
            <option value="">{t("None")}</option>
            {sales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        )}
        {members && members.length > 0 && (
          <Select
            id="gr-member"
            label="Farmer involved (optional)"
            value={f.member}
            onChange={(e) => setF({ ...f, member: e.target.value })}
          >
            <option value="">{t("None")}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        )}
        <FileInput label="Supporting document (optional)" value={doc} onChange={setDoc} />
        <FormActions onCancel={onClose} submitLabel="Submit complaint" busy={busy} />
      </form>
    </Modal>
  );
}

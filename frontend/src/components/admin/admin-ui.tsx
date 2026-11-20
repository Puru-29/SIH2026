/** Admin console helpers: paging controls and a "reason required" action dialog. */

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Btn, FormActions, Modal, TextArea } from "@/components/fpo/fpo-ui";

export function Pager({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 text-sm text-muted-foreground">
      <span>
        {total} {t("records")} · {t("page")} {page} / {pages}
      </span>
      <div className="flex gap-2">
        <Btn
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          icon={<ChevronLeft className="h-4 w-4" />}
        >
          {t("Previous")}
        </Btn>
        <Btn size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t("Next")} <ChevronRight className="h-4 w-4" />
        </Btn>
      </div>
    </div>
  );
}

/** Asks for a written reason before running an admin action (it goes in the audit log). */
export function ReasonModal({
  title,
  subtitle,
  submitLabel,
  minLength = 5,
  optional = false,
  busy,
  onSubmit,
  onClose,
}: {
  title: string;
  subtitle?: string | undefined;
  submitLabel: string;
  minLength?: number;
  optional?: boolean;
  busy?: boolean | undefined;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal open onClose={onClose} title={title} subtitle={subtitle}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(reason.trim());
        }}
      >
        <TextArea
          id="admin-reason"
          label={optional ? "Note (optional)" : "Reason"}
          required={!optional}
          minLength={optional ? undefined : minLength}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="Saved in the audit log and shown to the people affected"
        />
        <FormActions onCancel={onClose} submitLabel={submitLabel} busy={busy} />
      </form>
    </Modal>
  );
}

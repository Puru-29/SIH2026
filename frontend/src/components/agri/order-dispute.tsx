/** Farmer/buyer side: raise a dispute on an order and see its status. */

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { userApi } from "@/services/admin-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import { Badge, Btn, FormActions, Modal, TextArea } from "@/components/fpo/fpo-ui";

/** "Raise dispute" for one order, or its current dispute status. */
export function OrderDispute({ transactionId }: { transactionId: number }) {
  const { t } = useI18n();
  const mine = useFpoQuery(["my-disputes"], userApi.myDisputes);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const raise = useFpoMutation(() => userApi.raiseDispute(transactionId, reason), {
    success: "Dispute sent to the AgriSense admin",
    onSuccess: () => {
      setOpen(false);
      setReason("");
    },
  });
  const latest = mine.data?.find((d) => d.transaction_id === transactionId);
  const active = latest && (latest.status === "open" || latest.status === "investigating");
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      {latest && (
        <>
          <Badge
            label={`${t("Dispute")} #${latest.id}: ${t(latest.status)}`}
            tone={active ? "amber" : latest.status === "resolved" ? "green" : "gray"}
          />
          {latest.resolution_note && (
            <span className="text-muted-foreground">{latest.resolution_note}</span>
          )}
        </>
      )}
      {!active && (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-destructive hover:underline"
        >
          <AlertCircle className="h-4 w-4" /> {t("Raise dispute")}
        </button>
      )}
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title="Raise a dispute"
          subtitle="Tell the AgriSense admin what went wrong with this order. Both sides will be contacted."
        >
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              raise.mutate(undefined);
            }}
          >
            <TextArea
              id={`dispute-${transactionId}`}
              label="What went wrong?"
              required
              minLength={10}
              rows={5}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              hint="e.g. short weight, quality not as agreed, payment not received. At least 10 characters."
            />
            <FormActions
              onCancel={() => setOpen(false)}
              submitLabel="Send dispute"
              busy={raise.isPending}
            />
          </form>
        </Modal>
      )}
    </div>
  );
}

import { useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { userApi } from "@/services/admin-api";

/**
 * "Can't find your crop?" — sends a note to the admin, who adds the crop on the
 * Master data page. Only admins can add crops, so typos never split the data.
 */
export function RequestCrop({ initial = "" }: { initial?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setName(initial);
          setOpen(true);
        }}
        className="text-xs font-medium text-primary hover:underline"
      >
        {t("Can't find your crop? Request it")}
      </button>
    );
  }

  const send = async () => {
    if (name.trim().length < 2) return;
    setBusy(true);
    try {
      await userApi.requestCrop(name.trim());
      toast.success(t("Request sent"), {
        description: t("The admin will add it to the crop list. You will get a notification."),
      });
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={t("Crop name")}
        aria-label={t("Crop name to request")}
        maxLength={80}
        className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm outline-none"
      />
      <button
        type="button"
        disabled={busy || name.trim().length < 2}
        onClick={() => void send()}
        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        {t("Send request")}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-2 py-1.5 text-xs text-muted-foreground"
      >
        {t("Cancel")}
      </button>
    </div>
  );
}

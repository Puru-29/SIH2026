import { useState } from "react";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { useMyProfile, useUpdateProfile } from "@/hooks/use-market";
import { useI18n } from "@/lib/i18n";
import { INDIAN_STATES } from "@/lib/states";
import { Panel } from "@/components/agri/ui-bits";

const inputCls =
  "mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary";

/**
 * One-time prompt for farmers who signed up before district was asked.
 * Disappears once the profile has a "District, State" location.
 */
export function ConfirmDistrict() {
  const { t } = useI18n();
  const profile = useMyProfile();
  const save = useUpdateProfile();
  const [district, setDistrict] = useState("");
  const [state, setState] = useState("");

  if (!profile.data?.needs_district) return null;
  const known = profile.data.state ?? "";

  return (
    <Panel>
      <form
        className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(
            { district: district.trim(), state: state || known },
            {
              onSuccess: () => toast.success(t("District saved")),
              onError: (err) => toast.error(err.message),
            },
          );
        }}
      >
        <div className="sm:col-span-3">
          <p className="flex items-center gap-2 font-medium">
            <MapPin className="h-4 w-4 text-primary" /> {t("Confirm your district")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "We use it to find FPOs near you, show local mandi prices and work out pickup and freight.",
            )}
          </p>
        </div>
        <div>
          <label className="text-sm text-muted-foreground" htmlFor="cd-district">
            {t("District")}
          </label>
          <input
            id="cd-district"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            required
            minLength={2}
            maxLength={60}
            placeholder="Ludhiana"
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-sm text-muted-foreground" htmlFor="cd-state">
            {t("State")}
          </label>
          <select
            id="cd-state"
            value={state || known}
            onChange={(e) => setState(e.target.value)}
            required
            className={inputCls}
          >
            <option value="">{t("Choose state")}</option>
            {INDIAN_STATES.map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={save.isPending}
          className="min-h-11 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {save.isPending ? t("Saving…") : t("Save")}
        </button>
      </form>
    </Panel>
  );
}

import { useState } from "react";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { useMyProfile, useUpdateProfile } from "@/hooks/use-market";
import { useI18n } from "@/lib/i18n";
import { PlaceFields } from "@/components/agri/place-fields";
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

  return (
    <Panel>
      <form
        className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(
            { district, state },
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
              "AgriSense works in the districts that have mandi price data. Choose yours to see local prices, nearby FPOs, pickup and freight.",
            )}
          </p>
        </div>
        <div className="sm:col-span-2">
          <PlaceFields
            idPrefix="cd"
            state={state}
            district={district}
            onChange={(p) => {
              setState(p.state);
              setDistrict(p.district);
            }}
            selectClassName={inputCls}
          />
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

import { useI18n } from "@/lib/i18n";
import { SERVED_STATES, districtsOf } from "@/lib/service-area";

const defaultCls =
  "mt-1 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary";

/**
 * State + district pickers limited to where AgriSense works (places with mandi data).
 * Choosing a state resets the district; the district list follows the state.
 */
export function PlaceFields({
  state,
  district,
  onChange,
  idPrefix = "place",
  selectClassName = defaultCls,
  required = true,
}: {
  state: string;
  district: string;
  onChange: (next: { state: string; district: string }) => void;
  idPrefix?: string;
  selectClassName?: string;
  required?: boolean;
}) {
  const { t } = useI18n();
  const districts = districtsOf(state);
  return (
    <div className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm text-muted-foreground" htmlFor={`${idPrefix}-state`}>
            {t("State")}
          </label>
          <select
            id={`${idPrefix}-state`}
            value={SERVED_STATES.includes(state) ? state : ""}
            onChange={(e) => onChange({ state: e.target.value, district: "" })}
            required={required}
            className={selectClassName}
          >
            <option value="">{t("Choose state")}</option>
            {SERVED_STATES.map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm text-muted-foreground" htmlFor={`${idPrefix}-district`}>
            {t("District")}
          </label>
          <select
            id={`${idPrefix}-district`}
            value={districts.includes(district) ? district : ""}
            onChange={(e) => onChange({ state, district: e.target.value })}
            required={required}
            disabled={!state}
            className={`${selectClassName} disabled:opacity-60`}
          >
            <option value="">{state ? t("Choose district") : t("Choose state first")}</option>
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("AgriSense is available in")} {SERVED_STATES.map((s) => t(s)).join(", ")}.
      </p>
    </div>
  );
}

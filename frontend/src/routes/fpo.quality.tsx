import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ClipboardCheck, FileText } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { openProtectedFile } from "@/services/api-client";
import { documentPath, fpoApi, type Upload } from "@/services/fpo-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import {
  Btn,
  Card,
  Empty,
  ErrorNote,
  FileInput,
  GradeBadge,
  Input,
  Loading,
  PageTitle,
  Select,
  shortDate,
  Table,
  TextArea,
  today,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/fpo/quality")({
  component: QualityPage,
});

/** Suggested grade from common grain norms; the inspector makes the final call. */
function suggestGrade(moisture: number, foreign: number, damaged: number): "A" | "B" | "C" | null {
  if (![moisture, foreign, damaged].every(Number.isFinite)) return null;
  if (moisture <= 12 && foreign <= 1 && damaged <= 2) return "A";
  if (moisture <= 14 && foreign <= 2 && damaged <= 5) return "B";
  return "C";
}

const emptyForm = {
  lot_id: "",
  inspector_name: "",
  inspected_on: today(),
  moisture_pct: "",
  foreign_matter_pct: "",
  damaged_pct: "0",
  grain_quality: "",
  grade: "" as "" | "A" | "B" | "C",
};

function QualityPage() {
  const { t } = useI18n();
  const lots = useFpoQuery(["lots"], fpoApi.lots);
  const records = useFpoQuery(["quality"], fpoApi.quality);
  const [form, setForm] = useState(emptyForm);
  const [cert, setCert] = useState<Upload | null>(null);
  const suggested = suggestGrade(
    Number(form.moisture_pct === "" ? NaN : form.moisture_pct),
    Number(form.foreign_matter_pct === "" ? NaN : form.foreign_matter_pct),
    Number(form.damaged_pct || 0),
  );
  const grade = form.grade || suggested;

  const save = useFpoMutation(
    () =>
      fpoApi.addQuality(Number(form.lot_id), {
        inspector_name: form.inspector_name,
        inspected_on: form.inspected_on,
        moisture_pct: Number(form.moisture_pct),
        foreign_matter_pct: Number(form.foreign_matter_pct),
        damaged_pct: Number(form.damaged_pct || 0),
        grain_quality: form.grain_quality,
        grade: grade!,
        certificate: cert ?? undefined,
      }),
    {
      success: "Quality record saved and linked to the lot",
      onSuccess: () => {
        setForm(emptyForm);
        setCert(null);
      },
    },
  );

  return (
    <>
      <PageTitle
        title="Quality & Grading"
        subtitle="Record inspection results for each bulk lot. The grade is shown to buyers with the Lot ID."
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_1.3fr]">
        <Card title="New quality check">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!grade) {
                toast.error(t("Enter moisture and foreign matter to grade the lot"));
                return;
              }
              save.mutate(undefined);
            }}
          >
            <Select
              id="q-lot"
              label="Lot ID"
              required
              value={form.lot_id}
              onChange={(e) => setForm({ ...form, lot_id: e.target.value })}
            >
              <option value="">{t("Choose lot")}</option>
              {lots.data
                ?.filter((l) => l.status !== "sold")
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.lot_code} · {t(l.crop_name)}{" "}
                    {l.grade ? `· ${t("Grade")} ${l.grade}` : `· ${t("not graded")}`}
                  </option>
                ))}
            </Select>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                id="q-inspector"
                label="Inspector name"
                required
                value={form.inspector_name}
                onChange={(e) => setForm({ ...form, inspector_name: e.target.value })}
              />
              <Input
                id="q-date"
                label="Inspection date"
                type="date"
                required
                max={today()}
                value={form.inspected_on}
                onChange={(e) => setForm({ ...form, inspected_on: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                id="q-moist"
                label="Moisture %"
                type="number"
                min={0}
                max={100}
                step="0.1"
                required
                value={form.moisture_pct}
                onChange={(e) => setForm({ ...form, moisture_pct: e.target.value })}
              />
              <Input
                id="q-fm"
                label="Foreign matter %"
                type="number"
                min={0}
                max={100}
                step="0.1"
                required
                value={form.foreign_matter_pct}
                onChange={(e) => setForm({ ...form, foreign_matter_pct: e.target.value })}
              />
              <Input
                id="q-dmg"
                label="Damaged grain %"
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={form.damaged_pct}
                onChange={(e) => setForm({ ...form, damaged_pct: e.target.value })}
              />
            </div>
            <TextArea
              id="q-quality"
              label="Grain quality remarks"
              value={form.grain_quality}
              onChange={(e) => setForm({ ...form, grain_quality: e.target.value })}
              placeholder={t("e.g. bold, uniform colour, no insects")}
            />

            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">{t("Grade")}</legend>
              <div className="grid grid-cols-3 gap-2">
                {(["A", "B", "C"] as const).map((g) => (
                  <button
                    type="button"
                    key={g}
                    onClick={() => setForm({ ...form, grade: g })}
                    aria-pressed={grade === g}
                    className={cn(
                      "min-h-14 rounded-xl border text-lg font-semibold transition-colors",
                      grade === g
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card hover:bg-secondary",
                    )}
                  >
                    {t("Grade")} {g}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {suggested
                  ? `${t("Suggested from your readings")}: ${t("Grade")} ${suggested}. ${t("A: moisture ≤ 12%, foreign matter ≤ 1%, damage ≤ 2%. B: ≤ 14%, ≤ 2%, ≤ 5%.")}`
                  : t("Enter readings to see a suggested grade.")}
              </p>
            </fieldset>
            <FileInput label="Quality certificate (optional)" value={cert} onChange={setCert} />
            <Btn
              type="submit"
              size="lg"
              icon={<ClipboardCheck className="h-5 w-5" />}
              busy={save.isPending}
            >
              {t("Save quality check")}
            </Btn>
          </form>
        </Card>

        <Card title="Quality records" padded>
          <ErrorNote error={records.error} />
          {records.isLoading ? (
            <Loading />
          ) : !records.data?.length ? (
            <Empty icon={<ClipboardCheck className="h-6 w-6" />} title="No quality checks yet" />
          ) : (
            <Table
              head={[
                "Lot ID",
                "Date",
                "Moisture",
                "Foreign matter",
                "Damaged",
                "Grade",
                "Certificate",
              ]}
            >
              {records.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <p className="font-mono text-sm">{r.lot_code}</p>
                    <p className="text-xs text-muted-foreground">
                      {t(r.crop_name)} · {r.inspector_name}
                    </p>
                  </td>
                  <td>{shortDate(r.inspected_on)}</td>
                  <td className="tabular-nums">{r.moisture_pct}%</td>
                  <td className="tabular-nums">{r.foreign_matter_pct}%</td>
                  <td className="tabular-nums">{r.damaged_pct}%</td>
                  <td>
                    <GradeBadge grade={r.grade} />
                  </td>
                  <td>
                    {r.certificate_doc_id ? (
                      <Btn
                        size="sm"
                        variant="outline"
                        icon={<FileText className="h-4 w-4" />}
                        onClick={() =>
                          openProtectedFile(documentPath(r.certificate_doc_id!)).catch((e: Error) =>
                            toast.error(e.message),
                          )
                        }
                      >
                        {t("Open")}
                      </Btn>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

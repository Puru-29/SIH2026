/** Pools: create form, summary card, progress bar and intake form. */

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { cropEmoji } from "@/lib/crop-catalog";
import { useCropOptions } from "@/hooks/use-my-lots";
import { useFpoMutation } from "@/hooks/use-fpo";
import { fpoApi, type Contribution, type Pool } from "@/services/fpo-api";
import {
  Badge,
  FormActions,
  GradeBadge,
  Input,
  Modal,
  quintals,
  Select,
  shortDate,
  TextArea,
  today,
  tonnes,
} from "./fpo-ui";

/** Target vs pledged vs received, on one bar. */
export function PoolProgress({
  pool,
}: {
  pool: Pick<Pool, "target_quantity_quintals" | "pledged_quintals" | "received_quintals">;
}) {
  const { t } = useI18n();
  const max = Math.max(pool.target_quantity_quintals, pool.pledged_quintals, 1);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const filled = Math.round((pool.received_quintals / pool.target_quantity_quintals) * 100);
  return (
    <div>
      <div
        className="relative h-3 w-full overflow-hidden rounded-full bg-secondary"
        role="img"
        aria-label={`${t("Received")} ${quintals(pool.received_quintals)}, ${t("Pledged")} ${quintals(pool.pledged_quintals)}, ${t("Target")} ${quintals(pool.target_quantity_quintals)}`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--fpo-gold)]/70"
          style={{ width: pct(pool.pledged_quintals) }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: pct(pool.received_quintals) }}
        />
        {pool.target_quantity_quintals < max && (
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground"
            style={{ left: pct(pool.target_quantity_quintals) }}
          />
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-primary" />
          {t("Received")} {quintals(pool.received_quintals)}
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-[var(--fpo-gold)]" />
          {t("Pledged")} {quintals(pool.pledged_quintals)}
        </span>
        <span>
          {t("Target")} {quintals(pool.target_quantity_quintals)} · {filled}% {t("received")}
        </span>
      </div>
    </div>
  );
}

export function PoolCard({ pool }: { pool: Pool }) {
  const { t } = useI18n();
  return (
    <Link
      to="/fpo/pools/$poolId"
      params={{ poolId: String(pool.id) }}
      className="fpo-card block p-5 transition-colors hover:border-primary/50"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-2xl">
            {cropEmoji(pool.crop_name)}
          </span>
          <div>
            <p className="font-serif text-xl">
              {t(pool.crop_name)} {t("pool")}
              {pool.target_grade && (
                <span className="ml-2 align-middle">
                  <GradeBadge grade={pool.target_grade} />
                </span>
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              {pool.lot_code ?? `${t("Target")} ${tonnes(pool.target_quantity_quintals)}`}
            </p>
          </div>
        </div>
        <Badge status={pool.effective_status} />
      </div>
      <div className="mt-4">
        <PoolProgress pool={pool} />
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="h-4 w-4" /> {pool.collection_center}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="h-4 w-4" /> {t("by")} {shortDate(pool.collection_deadline)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-4 w-4" /> {pool.contributors} {t("farmers")}
        </span>
        {pool.pending_pledges > 0 && (
          <span className="font-medium text-[var(--fpo-warn)]">
            {pool.pending_pledges} {t("waiting for intake")}
          </span>
        )}
      </div>
    </Link>
  );
}

export function CreatePoolModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: Pool) => void;
}) {
  const { t } = useI18n();
  const { options } = useCropOptions();
  const [f, setF] = useState({
    crop: "",
    grade: "" as "" | "A" | "B" | "C",
    target: "",
    center: "",
    deadline: "",
    start: true,
  });
  const save = useFpoMutation(
    () =>
      fpoApi.createPool({
        crop_name: f.crop.trim(),
        target_grade: f.grade,
        target_quantity_quintals: Number(f.target),
        collection_center: f.center.trim(),
        collection_deadline: f.deadline,
        start_collecting: f.start,
      }),
    { success: "Pool created", onSuccess: onCreated },
  );
  return (
    <Modal
      open
      onClose={onClose}
      title="Create a pool"
      subtitle="A pool collects one crop from many members before you sell it in bulk."
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Input
          id="pl-crop"
          label="Crop"
          required
          list="pool-crop-list"
          value={f.crop}
          onChange={(e) => setF({ ...f, crop: e.target.value })}
          placeholder={t("Type to search, e.g. Wheat")}
        />
        <datalist id="pool-crop-list">
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="pl-target"
            label="Target quantity (quintals)"
            type="number"
            min={1}
            step="0.5"
            required
            value={f.target}
            onChange={(e) => setF({ ...f, target: e.target.value })}
            hint={Number(f.target) > 0 ? `= ${tonnes(Number(f.target))}` : "1 MT = 10 quintals"}
          />
          <Select
            id="pl-grade"
            label="Target grade (optional)"
            value={f.grade}
            onChange={(e) => setF({ ...f, grade: e.target.value as "" | "A" | "B" | "C" })}
          >
            <option value="">{t("Any grade")}</option>
            <option value="A">{t("Grade")} A</option>
            <option value="B">{t("Grade")} B</option>
            <option value="C">{t("Grade")} C</option>
          </Select>
        </div>
        <Input
          id="pl-center"
          label="Collection centre"
          required
          value={f.center}
          onChange={(e) => setF({ ...f, center: e.target.value })}
          placeholder="e.g. Khanna mandi yard"
        />
        <Input
          id="pl-deadline"
          label="Collection deadline"
          type="date"
          required
          min={today()}
          value={f.deadline}
          onChange={(e) => setF({ ...f, deadline: e.target.value })}
        />
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={f.start}
            onChange={(e) => setF({ ...f, start: e.target.checked })}
            className="h-5 w-5 accent-[var(--primary)]"
          />
          {t("Start collecting now (members can pledge right away)")}
        </label>
        <FormActions onCancel={onClose} submitLabel="Create pool" busy={save.isPending} />
      </form>
    </Modal>
  );
}

/** Weigh and grade a pledge at the collection centre, or reject it. */
export function IntakeModal({
  poolId,
  c,
  onClose,
}: {
  poolId: number;
  c: Contribution;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"receive" | "reject">("receive");
  const [qty, setQty] = useState(String(c.pledged_quintals ?? c.quantity_quintals));
  const [grade, setGrade] = useState<"" | "A" | "B" | "C">("");
  const [note, setNote] = useState("");
  const save = useFpoMutation(
    () =>
      mode === "receive"
        ? fpoApi.intake(poolId, c.id, {
            action: "receive",
            received_quintals: Number(qty),
            assessed_grade: grade as "A" | "B" | "C",
            note,
          })
        : fpoApi.intake(poolId, c.id, { action: "reject", note }),
    { success: mode === "receive" ? "Intake recorded" : "Pledge rejected", onSuccess: onClose },
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={`${t("Record intake")} · ${c.member_name}`}
      subtitle={`${t("Pledged")} ${quintals(c.pledged_quintals ?? c.quantity_quintals)}`}
    >
      <div className="mb-4 grid grid-cols-2 gap-2">
        {(["receive", "reject"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={cn(
              "min-h-11 rounded-xl border font-medium",
              mode === m
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-secondary",
            )}
          >
            {t(m === "receive" ? "Crop received" : "Reject")}
          </button>
        ))}
      </div>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === "receive" && !grade) {
            toast.error(t("Choose the assessed grade"));
            return;
          }
          save.mutate(undefined);
        }}
      >
        {mode === "receive" ? (
          <>
            <Input
              id="in-qty"
              label="Weighed quantity (quintals)"
              type="number"
              min={0.01}
              step="0.01"
              required
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              hint="Actual weight at the collection centre"
            />
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">
                {t("Assessed grade")} <span className="text-destructive">*</span>
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {(["A", "B", "C"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGrade(g)}
                    aria-pressed={grade === g}
                    className={cn(
                      "min-h-12 rounded-xl border text-lg font-semibold",
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
                {t(
                  "Grade B is paid 95% and grade C 85% of the grade A rate when the pool is sold.",
                )}
              </p>
            </fieldset>
            <TextArea
              id="in-note"
              label="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </>
        ) : (
          <TextArea
            id="in-reason"
            label="Reason for rejecting"
            required
            minLength={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            hint="The farmer can see this reason"
          />
        )}
        <FormActions
          onCancel={onClose}
          submitLabel={mode === "receive" ? "Save intake" : "Reject pledge"}
          busy={save.isPending}
        />
      </form>
    </Modal>
  );
}

/**
 * Shared building blocks for the FPO portal: large, farmer-friendly controls,
 * plain-language status badges and simple forms.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FileUp, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { Upload } from "@/services/fpo-api";

/* --------------------------------- formats -------------------------------- */

export const fmtNum = (n: number, digits = 1) =>
  Number.isFinite(n) ? (n || 0).toLocaleString("en-IN", { maximumFractionDigits: digits }) : "—";
export const rupees = (n: number) =>
  // `|| 0` turns -0 (from empty sums) into 0 so it never shows as "₹-0".
  "₹" + (Number.isFinite(n) ? (Math.round(n) || 0).toLocaleString("en-IN") : "—");
/**
 * Hint under ₹-per-quintal price boxes: shows the per-kg equivalent and warns
 * when the number looks like a per-kg price (mandi prices are per quintal).
 */
export function priceHint(value: string | number): string {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return "1 quintal = 100 kg";
  const perKg = (v / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (v < 100)
    return `⚠ This is ₹${perKg}/kg. If you meant ₹${v}/kg, enter ${(v * 100).toLocaleString("en-IN")} per quintal.`;
  return `= ₹${perKg} per kg`;
}
export const quintals = (n: number) => `${fmtNum(n)} q`;
export const tonnes = (q: number) => `${fmtNum(q / 10, 2)} MT`;
export const today = () => new Date().toISOString().slice(0, 10);
export function shortDate(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : `${v.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/* --------------------------------- layout --------------------------------- */

export function PageTitle({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string | undefined;
  actions?: ReactNode | undefined;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-serif text-3xl text-foreground md:text-4xl">{t(title)}</h1>
        {subtitle && (
          <p className="mt-1.5 max-w-2xl text-base text-muted-foreground">{t(subtitle)}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  action,
  children,
  className,
  padded = true,
}: {
  title?: string | undefined;
  subtitle?: string | undefined;
  action?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
  padded?: boolean | undefined;
}) {
  const { t } = useI18n();
  return (
    <section className={cn("fpo-card min-w-0", padded && "p-5 md:p-6", className)}>
      {(title || action) && (
        <div
          className={cn(
            "mb-4 flex flex-wrap items-start justify-between gap-3",
            !padded && "px-5 pt-5 md:px-6 md:pt-6",
          )}
        >
          <div className="min-w-0">
            {title && <h2 className="font-serif text-xl md:text-2xl">{t(title)}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{t(subtitle)}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode | undefined;
  icon?: ReactNode | undefined;
}) {
  const { t } = useI18n();
  return (
    <div className="fpo-card flex flex-col gap-1 p-5">
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{t(label)}</span>
        {icon && (
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-primary">
            {icon}
          </span>
        )}
      </div>
      <p className="font-serif text-3xl tabular-nums text-foreground">{value}</p>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Empty({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode | undefined;
  title: string;
  body?: string | undefined;
  action?: ReactNode | undefined;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      {icon && (
        <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-primary">
          {icon}
        </span>
      )}
      <p className="text-lg font-medium">{t(title)}</p>
      {body && <p className="max-w-md text-sm text-muted-foreground">{t(body)}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string | undefined }) {
  const { t } = useI18n();
  return (
    <p className="flex items-center gap-2 py-6 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" /> {t(label)}
    </p>
  );
}

export function ErrorNote({ error }: { error: Error | null }) {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <div
      role="alert"
      className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      {t("Could not load data")}: {error.message}
    </div>
  );
}

/* --------------------------------- badges --------------------------------- */

const STATUS: Record<
  string,
  { label: string; tone: "green" | "amber" | "red" | "olive" | "gray" }
> = {
  pending: { label: "Waiting", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
  pooled: { label: "In bulk lot", tone: "olive" },
  available: { label: "Available", tone: "green" },
  partly_sold: { label: "Partly sold", tone: "amber" },
  reserved: { label: "Reserved", tone: "amber" },
  sold: { label: "Sold", tone: "gray" },
  open: { label: "Open", tone: "olive" },
  accepted: { label: "Accepted", tone: "green" },
  advance_paid: { label: "Advance paid", tone: "amber" },
  partially_paid: { label: "Partially paid", tone: "amber" },
  fully_paid: { label: "Fully paid", tone: "green" },
  disputed: { label: "Disputed", tone: "red" },
  awaiting_dispatch: { label: "Awaiting dispatch", tone: "amber" },
  in_transit: { label: "In transit", tone: "olive" },
  delivered: { label: "Delivered", tone: "green" },
  planned: { label: "Planned", tone: "gray" },
  dispatched: { label: "Dispatched", tone: "olive" },
  cancelled: { label: "Cancelled", tone: "gray" },
  submitted: { label: "Submitted", tone: "amber" },
  under_review: { label: "Under review", tone: "amber" },
  resolved: { label: "Resolved", tone: "green" },
  due: { label: "Due", tone: "amber" },
  paid: { label: "Paid", tone: "green" },
  active: { label: "Active", tone: "green" },
  inactive: { label: "Inactive", tone: "gray" },
};

const TONES = {
  green: "bg-[var(--fpo-good-soft)] text-[var(--fpo-good)]",
  amber: "bg-[var(--fpo-warn-soft)] text-[var(--fpo-warn)]",
  red: "bg-destructive/12 text-destructive",
  olive: "bg-accent text-accent-foreground",
  gray: "bg-secondary text-muted-foreground",
} as const;

export function Badge({
  status,
  label,
  tone,
}: {
  status?: string | undefined;
  label?: string | undefined;
  tone?: keyof typeof TONES | undefined;
}) {
  const { t } = useI18n();
  const meta = status ? STATUS[status] : undefined;
  const text = label ?? meta?.label ?? status?.replace(/_/g, " ") ?? "";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
        TONES[tone ?? meta?.tone ?? "gray"],
      )}
    >
      {t(text)}
    </span>
  );
}

export function VerifiedBadge({ verified }: { verified: boolean | number }) {
  return verified ? (
    <Badge label="✓ Verified" tone="green" />
  ) : (
    <Badge label="Not verified" tone="gray" />
  );
}

export function GradeBadge({ grade }: { grade: string | null }) {
  if (!grade) return <Badge label="Not graded" tone="amber" />;
  return (
    <Badge
      label={`Grade ${grade}`}
      tone={grade === "A" ? "green" : grade === "B" ? "olive" : "amber"}
    />
  );
}

/* --------------------------------- buttons -------------------------------- */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost" | "danger" | "gold" | undefined;
  size?: "md" | "lg" | "sm" | undefined;
  icon?: ReactNode | undefined;
  busy?: boolean | undefined;
};

export function Btn({
  variant = "primary",
  size = "md",
  icon,
  busy,
  className,
  children,
  disabled,
  ...rest
}: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55",
        size === "lg" && "min-h-12 px-6 text-base",
        size === "md" && "min-h-11 px-4 text-[0.95rem]",
        size === "sm" && "min-h-9 px-3 text-sm",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "gold" &&
          "bg-[var(--fpo-gold)] text-[var(--fpo-gold-ink)] hover:brightness-105",
        variant === "outline" && "border border-border bg-card text-foreground hover:bg-secondary",
        variant === "ghost" && "text-foreground hover:bg-secondary",
        variant === "danger" &&
          "border border-destructive/40 bg-card text-destructive hover:bg-destructive/10",
        className,
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* ---------------------------------- forms --------------------------------- */

export const inputCls =
  "w-full min-h-12 rounded-xl border border-input bg-card px-4 py-2.5 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60";

export function Field({
  label,
  hint,
  children,
  required,
  htmlFor,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
  required?: boolean | undefined;
  htmlFor?: string | undefined;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {t(label)} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {hint && (
        <p
          className={
            hint.startsWith("⚠")
              ? "text-sm font-medium text-[var(--fpo-warn)]"
              : "text-xs text-muted-foreground"
          }
        >
          {t(hint)}
        </p>
      )}
    </div>
  );
}

/** Text/number input with a stable id derived from the label. */
export function Input({
  label,
  hint,
  required,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string | undefined }) {
  const auto = useId();
  const id = props.id ?? auto;
  return (
    <Field label={label} hint={hint} required={required} htmlFor={id}>
      <input {...props} id={id} required={required} className={cn(inputCls, props.className)} />
    </Field>
  );
}

export function Select({
  label,
  hint,
  required,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string | undefined }) {
  const auto = useId();
  const id = props.id ?? auto;
  return (
    <Field label={label} hint={hint} required={required} htmlFor={id}>
      <select
        {...props}
        id={id}
        required={required}
        className={cn(inputCls, "pr-10", props.className)}
      >
        {children}
      </select>
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  required,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string | undefined;
}) {
  const auto = useId();
  const id = props.id ?? auto;
  return (
    <Field label={label} hint={hint} required={required} htmlFor={id}>
      <textarea
        {...props}
        id={id}
        required={required}
        rows={props.rows ?? 3}
        className={cn(inputCls, "min-h-24 py-3")}
      />
    </Field>
  );
}

const MAX_FILE = 1024 * 1024;

export function FileInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Upload | null;
  onChange: (u: Upload | null) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [error, setError] = useState("");
  return (
    <Field label={label} hint="PDF, JPG or PNG up to 1 MB" htmlFor={id}>
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={id}
          className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-primary/50 bg-accent/40 px-4 text-sm font-medium text-primary hover:bg-accent"
        >
          <FileUp className="h-4 w-4" /> {value ? t("Change file") : t("Choose file")}
        </label>
        <input
          id={id}
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            setError("");
            if (!file) return;
            if (file.size > MAX_FILE) {
              setError(t("The file is larger than 1 MB. Please choose a smaller file."));
              onChange(null);
              return;
            }
            const reader = new FileReader();
            reader.onload = () =>
              onChange({
                file_name: file.name,
                mime_type: file.type || "application/pdf",
                data_base64: String(reader.result),
              });
            reader.onerror = () => setError(t("The file could not be read"));
            reader.readAsDataURL(file);
          }}
        />
        {value && (
          <span className="inline-flex items-center gap-2 text-sm">
            {value.file_name}
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label={t("Remove file")}
              className="rounded-full p-1 hover:bg-secondary"
            >
              <X className="h-4 w-4" />
            </button>
          </span>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Field>
  );
}

/* ---------------------------------- modal --------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string | undefined;
  children: ReactNode;
  wide?: boolean | undefined;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  // Callers pass a new onClose on every render; keep it in a ref so the effect
  // below runs only when the modal opens. Otherwise each keystroke re-ran it and
  // moved focus out of the field being typed in.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    // Focus the first form field once; fall back to any button.
    const root = ref.current;
    (
      root?.querySelector<HTMLElement>(
        "input:not([type=hidden]):not(.sr-only), select, textarea",
      ) ?? root?.querySelector<HTMLElement>("button")
    )?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t(title)}
        className={cn(
          "fpo-portal max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-card p-5 shadow-2xl sm:rounded-3xl md:p-7",
          wide ? "sm:max-w-3xl" : "sm:max-w-lg",
        )}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl">{t(title)}</h2>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{t(subtitle)}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label={t("Close")}
            className="rounded-full p-2 hover:bg-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A button that asks "Are you sure?" before running the action. */
export function ConfirmButton({
  label,
  confirmTitle,
  confirmBody,
  onConfirm,
  busy,
  ...btn
}: Omit<BtnProps, "onClick"> & {
  label: string;
  confirmTitle: string;
  confirmBody: string;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn {...btn} busy={busy} onClick={() => setOpen(true)}>
        {t(label)}
      </Btn>
      <Modal open={open} onClose={() => setOpen(false)} title={confirmTitle}>
        <p className="text-base text-muted-foreground">{t(confirmBody)}</p>
        <div className="mt-6 flex justify-end gap-3">
          <Btn variant="outline" onClick={() => setOpen(false)}>
            {t("Cancel")}
          </Btn>
          <Btn
            variant={btn.variant === "danger" ? "danger" : "primary"}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {t(label)}
          </Btn>
        </div>
      </Modal>
    </>
  );
}

export function FormActions({
  onCancel,
  submitLabel,
  busy,
}: {
  onCancel: () => void;
  submitLabel: string;
  busy?: boolean | undefined;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <Btn variant="outline" size="lg" onClick={onCancel}>
        {t("Cancel")}
      </Btn>
      <Btn type="submit" size="lg" busy={busy}>
        {t(submitLabel)}
      </Btn>
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: string; count?: number | undefined }[];
}) {
  const { t } = useI18n();
  return (
    <div role="tablist" className="flex flex-wrap gap-2">
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={cn(
            "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
            value === it.id
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card hover:bg-secondary",
          )}
        >
          {t(it.label)}
          {it.count !== undefined && (
            <span
              className={cn(
                "rounded-full px-2 text-xs",
                value === it.id ? "bg-primary-foreground/20" : "bg-secondary",
              )}
            >
              {it.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Meter({
  value,
  max,
  tone = "primary",
}: {
  value: number;
  max: number;
  tone?: "primary" | "gold" | "warn" | undefined;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary" role="presentation">
      <div
        className={cn(
          "h-full rounded-full transition-[width]",
          tone === "primary" && "bg-primary",
          tone === "gold" && "bg-[var(--fpo-gold)]",
          tone === "warn" && "bg-[var(--fpo-warn)]",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Responsive table wrapper: scrolls sideways on small screens. */
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[0.95rem]">
        <thead>
          <tr className="border-b border-border text-sm text-muted-foreground">
            {head.map((h, i) => (
              <th key={`${h}-${i}`} className="whitespace-nowrap px-3 py-3 font-medium">
                {t(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-border/70 [&>tr:last-child]:border-0 [&_td]:px-3 [&_td]:py-3.5 [&_td]:align-middle">
          {children}
        </tbody>
      </table>
    </div>
  );
}

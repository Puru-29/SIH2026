import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { LotStatus } from "@/services";
import type { ReactNode } from "react";

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-3xl border border-border bg-card p-6", className)}>{children}</div>
  );
}

export function Pill({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: "muted" | "green" | "amber" | "slate" | "solid" | "clay";
  className?: string;
}) {
  const tones = {
    muted: "bg-secondary text-secondary-foreground",
    green: "bg-accent text-accent-foreground",
    amber: "bg-amber-tag/20 text-amber-tag",
    slate: "bg-slate-tag/15 text-slate-tag",
    clay: "bg-clay/15 text-clay",
    solid: "bg-primary text-primary-foreground",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusTag({ status }: { status: LotStatus }) {
  const { t } = useI18n();
  const tone = status === "SELL NOW" ? "solid" : status === "HOLD" ? "amber" : "slate";
  return (
    <Pill tone={tone} className="font-semibold tracking-wide">
      {t(status)}
    </Pill>
  );
}

export function Metric({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-3xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t(label)}</p>
        {icon ? <span className="text-primary/70">{icon}</span> : null}
      </div>
      <p className="mt-3 font-serif text-3xl text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? <p className="eyebrow mb-2">{t(eyebrow)}</p> : null}
        <h1 className="font-serif text-3xl text-foreground md:text-4xl">{t(title)}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t(description)}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Bar({ value, tone = "primary" }: { value: number; tone?: "primary" | "amber" }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={cn("h-full rounded-full", tone === "primary" ? "bg-primary" : "bg-amber-tag")}
        style={{ width: `${Math.min(100, value)}%` }}
      />
    </div>
  );
}

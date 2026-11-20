import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { LineChart as LineIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { adminApi, type GapStatus } from "@/services/admin-api";
import { useFpoQuery } from "@/hooks/use-fpo";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Badge,
  Card,
  Empty,
  ErrorNote,
  Loading,
  PageTitle,
  quintals,
  rupees,
  Select,
  Table,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/admin/intelligence")({
  component: IntelligencePage,
});

const GAP: Record<
  GapStatus,
  { label: string; cell: string; tone: "red" | "green" | "amber" | "gray" }
> = {
  shortage: { label: "Shortage", cell: "bg-destructive/15 text-destructive", tone: "red" },
  balanced: {
    label: "Balanced",
    cell: "bg-[var(--fpo-good-soft)] text-[var(--fpo-good)]",
    tone: "green",
  },
  oversupply: {
    label: "Oversupply",
    cell: "bg-[var(--fpo-warn-soft)] text-[var(--fpo-warn)]",
    tone: "amber",
  },
  no_demand: { label: "No demand", cell: "bg-secondary text-muted-foreground", tone: "gray" },
  none: { label: "—", cell: "", tone: "gray" },
};

const priceConfig = {
  realised: { label: "Realised on AgriSense", color: "oklch(0.38 0.06 172)" },
  mandi: { label: "Mandi modal", color: "oklch(0.68 0.14 70)" },
} satisfies ChartConfig;

function IntelligencePage() {
  const { t } = useI18n();
  const sd = useFpoQuery(["admin", "supply-demand"], adminApi.supplyDemand);
  const crops = useMemo(
    () => [...new Set((sd.data?.rows ?? []).map((r) => r.crop))].sort(),
    [sd.data],
  );
  const states = useMemo(
    () =>
      [...new Set((sd.data?.rows ?? []).map((r) => r.state))].sort((a, b) =>
        a === "Unmapped" ? 1 : b === "Unmapped" ? -1 : a.localeCompare(b),
      ),
    [sd.data],
  );
  const cell = (crop: string, state: string) =>
    sd.data?.rows.find((r) => r.crop === crop && r.state === state);
  const [crop, setCrop] = useState("");
  const activeCrop = crop || sd.data?.top_crops[0]?.crop || "";

  return (
    <>
      <PageTitle
        title="Market intelligence"
        subtitle="Platform data turned into evidence: where buyers want more than farmers and FPOs can supply, and how AgriSense prices compare with the mandi."
      />
      <ErrorNote error={sd.error} />
      {sd.isLoading ? (
        <Loading />
      ) : !sd.data?.rows.length ? (
        <Card>
          <Empty
            icon={<LineIcon className="h-6 w-6" />}
            title="Not enough data yet"
            body="This fills in as buyers post requirements and farmers and FPOs list crop."
          />
        </Card>
      ) : (
        <>
          <Card title="Demand vs supply by crop and state" subtitle={sd.data.basis}>
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              {(["shortage", "balanced", "oversupply", "no_demand"] as const).map((g) => (
                <span key={g} className={cn("rounded-full px-2.5 py-1 font-medium", GAP[g].cell)}>
                  {t(GAP[g].label)}
                </span>
              ))}
            </div>
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[640px] border-separate border-spacing-1 text-sm">
                <thead>
                  <tr>
                    <th className="px-2 py-2 text-left font-medium text-muted-foreground">
                      {t("Crop")}
                    </th>
                    {states.map((s) => (
                      <th key={s} className="px-2 py-2 text-left font-medium text-muted-foreground">
                        {t(s)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {crops.map((c) => (
                    <tr key={c}>
                      <td className="px-2 py-2 font-medium">{t(c)}</td>
                      {states.map((s) => {
                        const r = cell(c, s);
                        return (
                          <td
                            key={s}
                            className={cn(
                              "rounded-lg px-2 py-2 align-top",
                              r ? GAP[r.status].cell : "",
                            )}
                            title={
                              r
                                ? `${t("Demand")} ${quintals(r.demand_quintals)} · ${t("Farmer lots")} ${quintals(r.farmer_lots_quintals)} · ${t("FPO lots")} ${quintals(r.fpo_lots_quintals)} · ${t("Pledged to pools")} ${quintals(r.fpo_pools_quintals)}`
                                : undefined
                            }
                          >
                            {r ? (
                              <>
                                <p className="font-semibold">{t(GAP[r.status].label)}</p>
                                <p className="text-xs tabular-nums opacity-90">
                                  {t("Need")} {quintals(r.demand_quintals)} · {t("Have")}{" "}
                                  {quintals(r.supply_quintals)}
                                </p>
                              </>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
            <Card title="Top crops by demand">
              <Table compact head={["Crop", "Demand", "Supply", "Status"]}>
                {sd.data.top_crops.map((c) => (
                  <tr key={c.crop}>
                    <td className="font-medium">{t(c.crop)}</td>
                    <td className="tabular-nums">{quintals(c.demand_quintals)}</td>
                    <td className="tabular-nums">{quintals(c.supply_quintals)}</td>
                    <td>
                      <Badge label={GAP[c.status].label} tone={GAP[c.status].tone} />
                    </td>
                  </tr>
                ))}
              </Table>
            </Card>
            {activeCrop && <PriceTrendCard crop={activeCrop} crops={crops} onCrop={setCrop} />}
          </div>
        </>
      )}
    </>
  );
}

function PriceTrendCard({
  crop,
  crops,
  onCrop,
}: {
  crop: string;
  crops: string[];
  onCrop: (c: string) => void;
}) {
  const { t } = useI18n();
  const trend = useFpoQuery(["admin", "price-trend", crop], () => adminApi.priceTrend(crop));
  const data = useMemo(() => {
    const months = new Set([
      ...(trend.data?.realised ?? []).map((r) => r.month),
      ...(trend.data?.mandi_monthly ?? []).map((m) => m.month),
    ]);
    return [...months].sort().map((m) => ({
      month: new Date(`${m}-01T00:00:00`).toLocaleDateString("en-IN", {
        month: "short",
        year: "2-digit",
      }),
      realised: trend.data?.realised.find((r) => r.month === m)?.price_per_quintal ?? null,
      mandi: trend.data?.mandi_monthly.find((r) => r.month === m)?.modal ?? null,
    }));
  }, [trend.data]);
  return (
    <Card
      title="Price trend vs mandi"
      subtitle={
        trend.data
          ? `${trend.data.state} · ${t("mandi today")}: ${trend.data.mandi_today != null ? `${rupees(trend.data.mandi_today)}/q` : t("not available")}`
          : undefined
      }
      action={
        <div className="w-48">
          <Select id="pt-crop" label="Crop" value={crop} onChange={(e) => onCrop(e.target.value)}>
            {crops.map((c) => (
              <option key={c} value={c}>
                {t(c)}
              </option>
            ))}
          </Select>
        </div>
      }
    >
      <ErrorNote error={trend.error} />
      {trend.isLoading ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty title="No price history yet for this crop" />
      ) : (
        <ChartContainer config={priceConfig} className="h-64 w-full">
          <LineChart data={data} margin={{ left: 4, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(v: number) => `₹${v}`}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Line
              dataKey="realised"
              stroke="var(--color-realised)"
              strokeWidth={2.5}
              dot={{ r: 4 }}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              dataKey="mandi"
              stroke="var(--color-mandi)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      )}
    </Card>
  );
}

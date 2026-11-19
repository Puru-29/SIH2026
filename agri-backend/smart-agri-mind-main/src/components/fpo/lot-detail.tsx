import { useI18n } from "@/lib/i18n";
import { fpoApi, type FpoLot } from "@/services/fpo-api";
import { useFpoQuery } from "@/hooks/use-fpo";
import {
  Badge,
  ErrorNote,
  GradeBadge,
  Loading,
  Modal,
  quintals,
  rupees,
  shortDate,
  Table,
  tonnes,
} from "./fpo-ui";

/** Three-part bar: sold | reserved | available. */
export function StockBar({
  lot,
}: {
  lot: Pick<
    FpoLot,
    "total_quintals" | "sold_quintals" | "reserved_quintals" | "available_quintals"
  >;
}) {
  const { t } = useI18n();
  const pct = (v: number) => (lot.total_quintals > 0 ? (v / lot.total_quintals) * 100 : 0);
  return (
    <div>
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-secondary"
        role="img"
        aria-label={`${t("Sold")} ${quintals(lot.sold_quintals)}, ${t("Reserved")} ${quintals(lot.reserved_quintals)}, ${t("Available")} ${quintals(lot.available_quintals)}`}
      >
        <div className="bg-[oklch(0.3_0.06_150)]" style={{ width: `${pct(lot.sold_quintals)}%` }} />
        <div className="bg-[var(--fpo-gold)]" style={{ width: `${pct(lot.reserved_quintals)}%` }} />
        <div className="bg-primary/70" style={{ width: `${pct(lot.available_quintals)}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-primary/70" />
          {t("Available")} {quintals(lot.available_quintals)}
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-[var(--fpo-gold)]" />
          {t("Reserved")} {quintals(lot.reserved_quintals)}
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-[oklch(0.3_0.06_150)]" />
          {t("Sold")} {quintals(lot.sold_quintals)}
        </span>
      </div>
    </div>
  );
}

export function LotDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useI18n();
  const { data, isLoading, error } = useFpoQuery(["lot", id], () => fpoApi.lot(id));
  const lot = data?.lot;
  return (
    <Modal
      open
      onClose={onClose}
      title={lot?.lot_code ?? "Lot"}
      subtitle={
        lot
          ? `${tonnes(lot.total_quintals)} ${t(lot.crop_name)}${lot.variety ? ` · ${lot.variety}` : ""}`
          : undefined
      }
      wide
    >
      <ErrorNote error={error} />
      {isLoading || !data || !lot ? (
        <Loading />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge status={lot.status} />
            <GradeBadge grade={lot.grade} />
            {lot.warehouse_name && <Badge label={lot.warehouse_name} tone="olive" />}
          </div>
          <StockBar lot={lot} />

          <section>
            <h3 className="mb-2 font-serif text-xl">{t("Farmer-wise contributions")}</h3>
            <Table head={["Farmer", "Quantity", "Share", "Harvest"]}>
              {data.contributions.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.member_name}</td>
                  <td className="tabular-nums">{quintals(c.quantity_quintals)}</td>
                  <td className="tabular-nums">
                    {((c.quantity_quintals / lot.total_quintals) * 100).toFixed(1)}%
                  </td>
                  <td>{shortDate(c.harvest_date)}</td>
                </tr>
              ))}
            </Table>
          </section>

          <section>
            <h3 className="mb-2 font-serif text-xl">{t("Quality checks")}</h3>
            {data.quality.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("No quality check recorded yet.")}</p>
            ) : (
              <Table head={["Date", "Inspector", "Moisture", "Foreign matter", "Grade"]}>
                {data.quality.map((q) => (
                  <tr key={q.id}>
                    <td>{shortDate(q.inspected_on)}</td>
                    <td>{q.inspector_name}</td>
                    <td className="tabular-nums">{q.moisture_pct}%</td>
                    <td className="tabular-nums">{q.foreign_matter_pct}%</td>
                    <td>
                      <GradeBadge grade={q.grade} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>

          <section>
            <h3 className="mb-2 font-serif text-xl">{t("Offers and sales")}</h3>
            {data.offers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("No buyer offers on this lot yet.")}
              </p>
            ) : (
              <Table head={["Buyer", "Quantity", "Price", "Status"]}>
                {data.offers.map((o) => (
                  <tr key={o.id}>
                    <td>{o.buyer_name}</td>
                    <td className="tabular-nums">{quintals(o.quantity_quintals)}</td>
                    <td className="tabular-nums">{rupees(o.price_per_quintal)}/q</td>
                    <td>
                      <Badge status={o.status} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

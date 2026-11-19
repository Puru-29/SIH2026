import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Phone, Plus, Truck, Warehouse as WarehouseIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fpoApi, type Shipment, type ShipmentStatus } from "@/services/fpo-api";
import { useFpoMutation, useFpoQuery } from "@/hooks/use-fpo";
import {
  Badge,
  Btn,
  Card,
  ConfirmButton,
  Empty,
  ErrorNote,
  FormActions,
  Input,
  Loading,
  Meter,
  Modal,
  PageTitle,
  quintals,
  rupees,
  Select,
  shortDate,
  Tabs,
  today,
} from "@/components/fpo/fpo-ui";

export const Route = createFileRoute("/fpo/logistics")({
  component: LogisticsPage,
});

type Tab = "shipments" | "warehouses" | "transporters";
const NEXT: Partial<Record<ShipmentStatus, { to: ShipmentStatus; label: string }>> = {
  planned: { to: "dispatched", label: "Mark dispatched" },
  dispatched: { to: "in_transit", label: "Mark in transit" },
  in_transit: { to: "delivered", label: "Mark delivered" },
};
const STEPS: ShipmentStatus[] = ["planned", "dispatched", "in_transit", "delivered"];

function LogisticsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("shipments");
  const [arranging, setArranging] = useState(false);
  const [addingWh, setAddingWh] = useState(false);
  const [addingTr, setAddingTr] = useState(false);
  const shipments = useFpoQuery(["shipments"], fpoApi.shipments);
  const warehouses = useFpoQuery(["warehouses"], fpoApi.warehouses);
  const transporters = useFpoQuery(["transporters"], fpoApi.transporters);
  const status = useFpoMutation(
    ({ id, to }: { id: number; to: ShipmentStatus }) => fpoApi.shipmentStatus(id, to),
    {
      success: "Shipment updated",
    },
  );

  return (
    <>
      <PageTitle
        title="Logistics"
        subtitle="Storage, transporters and deliveries. Shipment status is updated by your team — AgriSense does not use live GPS tracking."
        actions={
          <Btn size="lg" icon={<Truck className="h-5 w-5" />} onClick={() => setArranging(true)}>
            {t("Arrange Transport")}
          </Btn>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: "shipments", label: "Deliveries", count: shipments.data?.length },
          { id: "warehouses", label: "Warehouses", count: warehouses.data?.length },
          { id: "transporters", label: "Transporters", count: transporters.data?.length },
        ]}
      />
      <ErrorNote error={shipments.error ?? warehouses.error ?? transporters.error} />

      {tab === "shipments" &&
        (shipments.isLoading ? (
          <Loading />
        ) : !shipments.data?.length ? (
          <Card>
            <Empty
              icon={<Truck className="h-6 w-6" />}
              title="No deliveries yet"
              body="After you accept a buyer offer, arrange transport here."
              action={<Btn onClick={() => setArranging(true)}>{t("Arrange Transport")}</Btn>}
            />
          </Card>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {shipments.data.map((s) => (
              <ShipmentCard
                key={s.id}
                s={s}
                busy={status.isPending}
                onMove={(to) => status.mutate({ id: s.id, to })}
              />
            ))}
          </div>
        ))}

      {tab === "warehouses" && (
        <>
          <div className="flex justify-end">
            <Btn
              variant="outline"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setAddingWh(true)}
            >
              {t("Add warehouse")}
            </Btn>
          </div>
          {!warehouses.data?.length ? (
            <Card>
              <Empty
                icon={<WarehouseIcon className="h-6 w-6" />}
                title="No warehouses added"
                body="Add the godowns or WDRA warehouses your FPO uses."
              />
            </Card>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {warehouses.data.map((w) => (
                <Card key={w.id}>
                  <p className="text-lg font-semibold">{w.name}</p>
                  <p className="text-sm text-muted-foreground">{w.location}</p>
                  <div className="mt-4">
                    <Meter
                      value={w.used_quintals}
                      max={w.capacity_quintals}
                      tone={w.used_quintals / w.capacity_quintals > 0.9 ? "warn" : "primary"}
                    />
                  </div>
                  <p className="mt-1.5 text-sm tabular-nums">
                    {quintals(w.used_quintals)} {t("of")} {quintals(w.capacity_quintals)}{" "}
                    {t("used")} · {w.lot_count} {t("lots")}
                  </p>
                  <p className="mt-3 text-sm">
                    {t("Storage charge")}: <strong>{rupees(w.rate_per_quintal_month)}</strong>{" "}
                    {t("per quintal per month")}
                  </p>
                </Card>
              ))}
            </div>
          )}
          <StorageEstimator
            rates={
              warehouses.data?.map((w) => ({
                id: w.id,
                name: w.name,
                rate: w.rate_per_quintal_month,
              })) ?? []
            }
          />
        </>
      )}

      {tab === "transporters" && (
        <>
          <div className="flex justify-end">
            <Btn
              variant="outline"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setAddingTr(true)}
            >
              {t("Add transporter")}
            </Btn>
          </div>
          {!transporters.data?.length ? (
            <Card>
              <Empty icon={<Truck className="h-6 w-6" />} title="No transporters added" />
            </Card>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {transporters.data.map((tr) => (
                <Card key={tr.id}>
                  <p className="text-lg font-semibold">{tr.name}</p>
                  <p className="font-mono text-sm">{tr.vehicle_number}</p>
                  <p className="mt-2 flex items-center gap-1.5 text-sm">
                    <Phone className="h-4 w-4" /> {tr.phone}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("Capacity")} {quintals(tr.capacity_quintals)} · {rupees(tr.rate_per_km)}/km
                  </p>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {arranging && <ArrangeModal onClose={() => setArranging(false)} />}
      {addingWh && <WarehouseModal onClose={() => setAddingWh(false)} />}
      {addingTr && <TransporterModal onClose={() => setAddingTr(false)} />}
    </>
  );
}

function ShipmentCard({
  s,
  onMove,
  busy,
}: {
  s: Shipment;
  onMove: (to: ShipmentStatus) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const next = NEXT[s.status];
  const idx = STEPS.indexOf(s.status);
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">{s.buyer_name}</p>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{s.lot_code}</span> · {t(s.crop_name)} ·{" "}
            {quintals(s.quantity_quintals)}
          </p>
        </div>
        <Badge status={s.status} />
      </div>
      {s.status !== "cancelled" && (
        <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label={t("Delivery progress")}>
          {STEPS.map((st, i) => (
            <li key={st} className="text-center text-xs">
              <span
                className={`mb-1 block h-2 rounded-full ${i <= idx ? "bg-primary" : "bg-secondary"}`}
              />
              <span className={i <= idx ? "font-medium" : "text-muted-foreground"}>
                {t(st === "in_transit" ? "In transit" : st.charAt(0).toUpperCase() + st.slice(1))}
              </span>
            </li>
          ))}
        </ol>
      )}
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t("Pickup")}</dt>
          <dd>{s.pickup_location}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("Deliver to")}</dt>
          <dd>{s.delivery_address}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("Expected date")}</dt>
          <dd>{shortDate(s.expected_date)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("Truck")}</dt>
          <dd>
            {s.transporter_name
              ? `${s.transporter_name} · ${s.vehicle_number} · ${s.transporter_phone}`
              : t("Buyer pickup")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("Transport cost estimate")}</dt>
          <dd>
            {rupees(s.estimated_cost)} · {s.distance_km} km
          </dd>
        </div>
      </dl>
      {s.status !== "delivered" && s.status !== "cancelled" && (
        <div className="mt-4 flex flex-wrap gap-2.5">
          {next && (
            <ConfirmButton
              label={next.label}
              busy={busy}
              confirmTitle={next.label}
              confirmBody={
                next.to === "delivered"
                  ? "Confirm the buyer received the crop. The reserved quantity will be marked as sold."
                  : "Update the delivery status?"
              }
              onConfirm={() => onMove(next.to)}
            />
          )}
          <ConfirmButton
            label="Cancel delivery"
            variant="danger"
            confirmTitle="Cancel this delivery?"
            confirmBody="The stock stays reserved for the buyer. You can arrange a new delivery."
            onConfirm={() => onMove("cancelled")}
          />
        </div>
      )}
    </Card>
  );
}

function ArrangeModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const sales = useFpoQuery(["sales"], fpoApi.sales);
  const shipments = useFpoQuery(["shipments"], fpoApi.shipments);
  const transporters = useFpoQuery(["transporters"], fpoApi.transporters);
  const busySales = new Set(
    shipments.data
      ?.filter((s) => !["cancelled", "delivered"].includes(s.status))
      .map((s) => s.sale_id),
  );
  const open =
    sales.data?.filter((s) => s.delivery_status !== "delivered" && !busySales.has(s.id)) ?? [];
  const [form, setForm] = useState({
    sale_id: "",
    transporter_id: "",
    pickup: "",
    address: "",
    km: "",
    date: today(),
  });
  const sale = open.find((s) => s.id === Number(form.sale_id));
  const tr = transporters.data?.find((x) => x.id === Number(form.transporter_id));
  const trips =
    sale && tr ? Math.max(1, Math.ceil(sale.quantity_quintals / tr.capacity_quintals)) : 0;
  const estimate = tr ? Number(form.km || 0) * tr.rate_per_km * trips : 0;
  const save = useFpoMutation(
    () =>
      fpoApi.createShipment({
        sale_id: Number(form.sale_id),
        transporter_id: form.transporter_id ? Number(form.transporter_id) : null,
        pickup_location: form.pickup,
        delivery_address: form.address,
        distance_km: Number(form.km || 0),
        expected_date: form.date,
      }),
    { success: "Transport arranged", onSuccess: onClose },
  );
  return (
    <Modal
      open
      onClose={onClose}
      title="Arrange Transport"
      subtitle="For accepted sales that are not yet delivered."
    >
      {sales.isLoading ? (
        <Loading />
      ) : open.length === 0 ? (
        <Empty title="No sales waiting for transport" body="Accept a buyer offer first." />
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          <Select
            id="sh-sale"
            label="Sale"
            required
            value={form.sale_id}
            onChange={(e) => setForm({ ...form, sale_id: e.target.value })}
          >
            <option value="">{t("Choose sale")}</option>
            {open.map((s) => (
              <option key={s.id} value={s.id}>
                {s.buyer_name} · {s.lot_code} · {quintals(s.quantity_quintals)}
              </option>
            ))}
          </Select>
          <Select
            id="sh-tr"
            label="Transporter"
            value={form.transporter_id}
            onChange={(e) => setForm({ ...form, transporter_id: e.target.value })}
            hint="Leave empty if the buyer collects the crop"
          >
            <option value="">{t("Buyer pickup")}</option>
            {transporters.data?.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {x.vehicle_number} · {quintals(x.capacity_quintals)}
              </option>
            ))}
          </Select>
          <Input
            id="sh-pick"
            label="Pickup location"
            required
            value={form.pickup}
            onChange={(e) => setForm({ ...form, pickup: e.target.value })}
            placeholder={t("Warehouse or collection centre")}
          />
          <Input
            id="sh-addr"
            label="Delivery address"
            required
            minLength={5}
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="sh-km"
              label="Distance (km)"
              type="number"
              min={0}
              step="1"
              value={form.km}
              onChange={(e) => setForm({ ...form, km: e.target.value })}
            />
            <Input
              id="sh-date"
              label="Expected delivery date"
              type="date"
              required
              min={today()}
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
          {tr && (
            <p className="rounded-xl bg-secondary px-4 py-3 text-base">
              {t("Transport cost estimate")}: <strong>{rupees(estimate)}</strong>
              <span className="block text-sm text-muted-foreground">
                {form.km || 0} km × {rupees(tr.rate_per_km)}/km × {trips} {t("trip(s)")}
              </span>
            </p>
          )}
          <FormActions onCancel={onClose} submitLabel="Arrange Transport" busy={save.isPending} />
        </form>
      )}
    </Modal>
  );
}

function WarehouseModal({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: "", location: "", capacity: "", rate: "" });
  const save = useFpoMutation(
    () =>
      fpoApi.createWarehouse({
        name: f.name,
        location: f.location,
        capacity_quintals: Number(f.capacity),
        rate_per_quintal_month: Number(f.rate || 0),
      }),
    { success: "Warehouse added", onSuccess: onClose },
  );
  return (
    <Modal open onClose={onClose} title="Add warehouse">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Input
          id="wh-name"
          label="Warehouse name"
          required
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
        <Input
          id="wh-loc"
          label="Location"
          required
          value={f.location}
          onChange={(e) => setF({ ...f, location: e.target.value })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="wh-cap"
            label="Capacity (quintals)"
            type="number"
            min={1}
            required
            value={f.capacity}
            onChange={(e) => setF({ ...f, capacity: e.target.value })}
          />
          <Input
            id="wh-rate"
            label="Charge (₹ per quintal per month)"
            type="number"
            min={0}
            step="0.5"
            value={f.rate}
            onChange={(e) => setF({ ...f, rate: e.target.value })}
          />
        </div>
        <FormActions onCancel={onClose} submitLabel="Add warehouse" busy={save.isPending} />
      </form>
    </Modal>
  );
}

function TransporterModal({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: "", phone: "", vehicle: "", capacity: "", rate: "" });
  const save = useFpoMutation(
    () =>
      fpoApi.createTransporter({
        name: f.name,
        phone: f.phone,
        vehicle_number: f.vehicle,
        capacity_quintals: Number(f.capacity),
        rate_per_km: Number(f.rate || 0),
      }),
    { success: "Transporter added", onSuccess: onClose },
  );
  return (
    <Modal open onClose={onClose} title="Add transporter">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Input
          id="tr-name"
          label="Transporter / driver name"
          required
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
        <Input
          id="tr-phone"
          label="Mobile number"
          required
          inputMode="numeric"
          pattern="[0-9]{10}"
          maxLength={10}
          value={f.phone}
          onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, "") })}
        />
        <Input
          id="tr-veh"
          label="Vehicle number"
          required
          value={f.vehicle}
          onChange={(e) => setF({ ...f, vehicle: e.target.value })}
          placeholder="MH15 AB 1234"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="tr-cap"
            label="Truck capacity (quintals)"
            type="number"
            min={1}
            required
            value={f.capacity}
            onChange={(e) => setF({ ...f, capacity: e.target.value })}
          />
          <Input
            id="tr-rate"
            label="Rate (₹ per km)"
            type="number"
            min={0}
            step="0.5"
            required
            value={f.rate}
            onChange={(e) => setF({ ...f, rate: e.target.value })}
          />
        </div>
        <FormActions onCancel={onClose} submitLabel="Add transporter" busy={save.isPending} />
      </form>
    </Modal>
  );
}

function StorageEstimator({ rates }: { rates: { id: number; name: string; rate: number }[] }) {
  const { t } = useI18n();
  const [wh, setWh] = useState("");
  const [qty, setQty] = useState("100");
  const [months, setMonths] = useState("1");
  const rate = rates.find((r) => r.id === Number(wh))?.rate ?? 0;
  const total = rate * Number(qty || 0) * Number(months || 0);
  if (rates.length === 0) return null;
  return (
    <Card title="Storage charge calculator" subtitle="Estimate before you decide to hold stock.">
      <div className="grid gap-4 sm:grid-cols-3">
        <Select id="se-wh" label="Warehouse" value={wh} onChange={(e) => setWh(e.target.value)}>
          <option value="">{t("Choose")}</option>
          {rates.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · {rupees(r.rate)}/q/{t("month")}
            </option>
          ))}
        </Select>
        <Input
          id="se-q"
          label="Quantity (quintals)"
          type="number"
          min={0}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <Input
          id="se-m"
          label="Months"
          type="number"
          min={0}
          step="0.5"
          value={months}
          onChange={(e) => setMonths(e.target.value)}
        />
      </div>
      <p className="mt-4 text-lg">
        {t("Estimated storage charge")}:{" "}
        <strong className="font-serif text-2xl">{rupees(total)}</strong>
        {Number(qty) > 0 && (
          <span className="text-sm text-muted-foreground"> ({rupees(total / Number(qty))}/q)</span>
        )}
      </p>
    </Card>
  );
}

/**
 * fpo-api.ts — typed client for the FPO portal endpoints in the Rust backend
 * (`src/fpo.rs`). Quantities are in quintals (1 MT = 10 quintals) and prices
 * in ₹ per quintal, matching mandi conventions.
 */

import { request } from "./api-client";

const send = <T>(method: "POST" | "PUT", path: string, body?: unknown) =>
  request<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export type Upload = { file_name: string; mime_type: string; data_base64: string };

export type FpoOrg = {
  id: number;
  manager_user_id: number;
  name: string;
  registration_no: string | null;
  district: string;
  state: string;
  contact_phone: string | null;
  commission_pct: number;
  verified: number;
  verified_at: string | null;
  created_at: string | null;
  verified_by: number | null;
  primary_crops: string;
  rejection_reason: string | null;
};

export type FpoMember = {
  id: number;
  user_id: number | null;
  name: string;
  phone: string;
  village: string;
  land_acres: number;
  crops: string;
  status: "active" | "inactive";
  joined_at: string | null;
  contributed_quintals: number;
  pending_quintals: number;
  payouts_net: number;
  payouts_paid: number;
};

export type MemberInput = {
  name: string;
  phone: string;
  village: string;
  land_acres: number;
  crops: string;
  status?: "active" | "inactive";
  /** Create an AgriSense farmer login with this PIN (only if the farmer has none). */
  create_login_pin?: string | undefined;
};

export type Contribution = {
  id: number;
  member_id: number;
  member_name: string;
  crop_id: number;
  crop_name: string;
  variety: string;
  quantity_quintals: number;
  harvest_date: string;
  quality_note: string;
  status: "pending" | "approved" | "rejected" | "pooled";
  lot_id: number | null;
  lot_code: string | null;
  created_at: string | null;
  pool_id: number | null;
  pledged_quintals: number | null;
  received_quintals: number | null;
  assessed_grade: "A" | "B" | "C" | null;
  source_lot_id: number | null;
  pledged_by: "fpo" | "farmer";
  rejection_note: string;
  received_at: string | null;
};

export type FpoLot = {
  id: number;
  fpo_id: number;
  lot_code: string | null;
  crop_id: number;
  crop_name: string;
  variety: string;
  total_quintals: number;
  reserved_quintals: number;
  sold_quintals: number;
  available_quintals: number;
  grade: "A" | "B" | "C" | null;
  warehouse_id: number | null;
  warehouse_name: string | null;
  contributor_count: number;
  status: "available" | "partly_sold" | "reserved" | "sold";
  created_at: string | null;
  fpo_name: string;
  fpo_verified: number;
  fpo_district: string;
  fpo_state: string;
  last_moisture_pct: number | null;
  last_inspected_on: string | null;
};

export type QualityRecord = {
  id: number;
  lot_id: number;
  lot_code: string | null;
  crop_name: string;
  inspector_name: string;
  inspected_on: string;
  moisture_pct: number;
  foreign_matter_pct: number;
  damaged_pct: number;
  grain_quality: string;
  grade: "A" | "B" | "C";
  certificate_doc_id: number | null;
  certificate_name: string | null;
  created_at: string | null;
};

export type OfferEvent = {
  id: number;
  offer_id: number;
  actor_role: "fpo" | "buyer";
  action: "offered" | "countered" | "accepted" | "rejected";
  quantity_quintals: number;
  price_per_quintal: number;
  note: string;
  created_at: string | null;
};

export type FpoOffer = {
  id: number;
  fpo_id: number;
  fpo_name: string;
  fpo_verified: number;
  lot_id: number;
  lot_code: string | null;
  crop_name: string;
  grade: string | null;
  lot_available: number;
  buyer_id: number;
  buyer_name: string;
  buyer_verified: number;
  quantity_quintals: number;
  price_per_quintal: number;
  payment_terms: string;
  status: "open" | "accepted" | "rejected";
  awaiting: "fpo" | "buyer";
  round: number;
  created_by_role: "fpo" | "buyer";
  created_at: string | null;
  updated_at: string | null;
  sale_id: number | null;
  events: OfferEvent[];
};

export type RespondInput = {
  action: "accept" | "reject" | "counter";
  price_per_quintal?: number;
  quantity_quintals?: number;
  payment_terms?: string;
  note?: string;
};

export type PaymentStatus =
  "pending" | "advance_paid" | "partially_paid" | "fully_paid" | "disputed";

export type FpoSale = {
  id: number;
  fpo_id: number;
  lot_id: number;
  lot_code: string | null;
  crop_name: string;
  buyer_id: number;
  buyer_name: string;
  buyer_verified: number;
  quantity_quintals: number;
  price_per_quintal: number;
  amount: number;
  payment_terms: string;
  transport_cost: number;
  storage_cost: number;
  handling_cost: number;
  commission_pct: number;
  delivery_status: "awaiting_dispatch" | "in_transit" | "delivered";
  created_at: string | null;
  received: number;
  pending_amount: number;
  open_disputes: number;
  payout_count: number;
  payouts_paid: number;
  payment_status: PaymentStatus;
};

export type FpoPayment = {
  id: number;
  sale_id: number;
  amount: number;
  kind: "advance" | "part" | "final";
  method: "upi" | "neft" | "rtgs" | "cheque" | "cash";
  reference: string;
  paid_on: string;
  receipt_doc_id: number | null;
  receipt_name: string | null;
  created_at: string | null;
};

export type FpoPayout = {
  id: number;
  sale_id: number;
  member_id: number;
  member_name: string;
  contribution_id: number;
  quantity_quintals: number;
  gross: number;
  deductions: number;
  net: number;
  status: "due" | "paid";
  reference: string | null;
  paid_on: string | null;
  lot_code: string | null;
  crop_name: string;
  buyer_name: string;
  fpo_name: string;
};

export type Distribution = {
  sale_id: number;
  amount: number;
  expenses: {
    transport: number;
    storage: number;
    handling: number;
    fpo_service_charge: number;
    fpo_service_charge_pct: number;
  };
  rows: {
    contribution_id: number;
    member_id: number;
    member_name: string;
    contributed_quintals: number;
    grade: "A" | "B" | "C" | null;
    grade_factor: number;
    share_pct: number;
    quantity_quintals: number;
    gross: number;
    freight_share: number;
    storage_handling_share: number;
    commission: number;
    deductions: number;
    net: number;
  }[];
  saved: boolean;
};

export type Warehouse = {
  id: number;
  name: string;
  location: string;
  capacity_quintals: number;
  rate_per_quintal_month: number;
  used_quintals: number;
  lot_count: number;
};

export type Transporter = {
  id: number;
  name: string;
  phone: string;
  vehicle_number: string;
  capacity_quintals: number;
  rate_per_km: number;
};

export type ShipmentStatus = "planned" | "dispatched" | "in_transit" | "delivered" | "cancelled";

export type Shipment = {
  id: number;
  sale_id: number;
  lot_code: string | null;
  crop_name: string;
  buyer_name: string;
  quantity_quintals: number;
  transporter_id: number | null;
  transporter_name: string | null;
  transporter_phone: string | null;
  vehicle_number: string | null;
  pickup_location: string;
  delivery_address: string;
  distance_km: number;
  estimated_cost: number;
  expected_date: string;
  status: ShipmentStatus;
  updated_at: string | null;
};

export type DocInfo = {
  id: number;
  owner_type: string;
  owner_id: number;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string | null;
};

export type GrievanceCategory = "payment_delay" | "quality_dispute" | "buyer_issue" | "other";
export type GrievanceStatus = "submitted" | "under_review" | "resolved" | "rejected";

export type Grievance = {
  id: number;
  fpo_id: number;
  fpo_name: string;
  raised_by: number;
  raised_by_name: string;
  raised_by_role: string;
  member_id: number | null;
  member_name: string | null;
  sale_id: number | null;
  category: GrievanceCategory;
  subject: string;
  description: string;
  status: GrievanceStatus;
  created_at: string | null;
  updated_at: string | null;
  events: {
    id: number;
    actor_name: string;
    status: string;
    note: string;
    created_at: string | null;
  }[];
  documents: DocInfo[];
};

export type GrievanceInput = {
  fpo_id?: number;
  category: GrievanceCategory;
  subject: string;
  description: string;
  sale_id?: number | undefined;
  member_id?: number | undefined;
  document?: Upload | undefined;
};

export type Trust = {
  score: number | null;
  basis: string;
  paid_in_full_pct: number | null;
  dispute_count: number;
  verified: boolean;
};

export type BuyerRequirement = {
  id: number;
  buyer_id: number;
  buyer_name: string;
  crop_id: number;
  crop_name: string;
  min_quantity: number;
  max_price: number;
  required_quality: string;
  delivery_location: string;
  required_by: string;
};

export type BuyerProfile = {
  id: number;
  name: string;
  verified: boolean;
  deals: { fpo: number; fpo_delivered: number; marketplace: number; fpo_value: number };
  trust: Trust;
  usual_payment_terms: string | null;
  locations: string[];
  requirements: BuyerRequirement[];
};

export type BuyerMatch = {
  demand: BuyerRequirement;
  buyer_verified: boolean;
  trust: Trust;
  score: number;
  parts: {
    quantity: number;
    price: number;
    quality: number;
    location: number;
    reliability: number;
  };
};

export type Advice = {
  lot_code: string | null;
  crop: string;
  state: string;
  available_quintals: number;
  current_price: number;
  markets_reporting: number;
  best_market: {
    market: string;
    district: string | null;
    modal_price: number;
    date: string;
  } | null;
  best_open_offer: number | null;
  trend_available: boolean;
  trend_points: number;
  trend_per_day: number;
  horizon_days: number;
  expected_price: number;
  storage_cost_per_day: number;
  open_demand_quintals: number;
  advice: {
    strategy: "SELL_NOW" | "WAIT" | "PARTIAL_SELL";
    reason: string;
    immediate_net_realisation: number;
    future_net_realisation: number;
    suggested_sell_ratio: number;
  };
  is_estimate: boolean;
  basis: string;
};

export type DemandForecast = {
  requirements: {
    crop: string;
    month: string;
    quantity_quintals: number;
    buyers: number;
    avg_max_price: number;
  }[];
  recent_offers: { crop: string; quantity_quintals: number; offers: number; avg_price: number }[];
  your_stock: { crop: string; available_quintals: number }[];
  basis: string;
};

export type FpoNotification = {
  kind: string;
  tone: "info" | "warn" | "bad";
  message: string;
  link: string;
};

export type FpoDashboard = {
  org: FpoOrg;
  farmers: number;
  available_quintals: number;
  reserved_quintals: number;
  active_offers: number;
  revenue: number;
  received: number;
  pending_payments: number;
  active_deals: number;
  stock_by_crop: { crop: string; available: number; reserved: number; sold: number }[];
  sales_by_month: { month: string; revenue: number; quantity: number; deals: number }[];
  pending_contributions: Contribution[];
  recent_offers: FpoOffer[];
  recent_sales: FpoSale[];
  upcoming_shipments: Shipment[];
  notifications: FpoNotification[];
  pools: Pool[];
  demand_highlights: DemandHighlight[];
};

export type PoolStatus = "draft" | "collecting" | "locked" | "listed" | "cancelled";
export type PoolEffectiveStatus = PoolStatus | "sold" | "settled";

export type Pool = {
  id: number;
  fpo_id: number;
  fpo_name: string;
  crop_id: number;
  crop_name: string;
  target_grade: "A" | "B" | "C" | null;
  target_quantity_quintals: number;
  collection_center: string;
  collection_deadline: string;
  status: PoolStatus;
  effective_status: PoolEffectiveStatus;
  lot_id: number | null;
  lot_code: string | null;
  pledged_quintals: number;
  received_quintals: number;
  contributors: number;
  pending_pledges: number;
  rejected: number;
  created_at: string | null;
};

export type PoolDetail = {
  pool: Pool;
  contributions: Contribution[];
  grade_breakdown: { grade: string; quintals: number }[];
  lot: FpoLot | null;
  offers: FpoOffer[];
  sales: FpoSale[];
  payouts: FpoPayout[];
};

export type PoolAction = "open" | "lock" | "reopen" | "list" | "cancel";

export type JoinRequest = {
  id: number;
  farmer_user_id: number;
  name: string;
  phone: string;
  location: string;
  message: string;
  status: "pending" | "approved" | "rejected";
  created_at: string | null;
  decided_at: string | null;
};

export type Announcement = {
  id: number;
  author_name: string;
  audience: "fpo_members" | "all_farmers" | "all_buyers" | "all_fpos" | "all";
  fpo_id: number | null;
  fpo_name: string | null;
  district: string | null;
  title: string;
  body: string;
  created_at: string | null;
};

export type FpoDirectoryEntry = {
  id: number;
  name: string;
  district: string;
  state: string;
  primary_crops: string;
  members: number;
  request_status: "pending" | "approved" | "rejected" | null;
  is_member: boolean;
};

export type MyPools = {
  pools: Pool[];
  open_lots: {
    id: number;
    crop_id: number;
    crop_name: string;
    quantity_quintals: number;
    quality: string;
  }[];
};

export type DemandHighlight = {
  buyer: string;
  crop: string;
  quantity_quintals: number;
  max_price: number;
  quality: string;
  location: string;
  required_by: string;
  pledged_quintals: number;
  in_stock_quintals: number;
  can_cover: boolean;
};

export type ReportKind =
  | "monthly_sales"
  | "farmer_contributions"
  | "inventory"
  | "buyer_transactions"
  | "payments"
  | "profit_expense";

export type Report = {
  title: string;
  fpo: string;
  from: string | null;
  to: string | null;
  columns: string[];
  rows: (string | number | null)[][];
};

export type AuditEntry = {
  id: number;
  actor: string;
  action: string;
  entity: string;
  entity_id: number | null;
  detail: string;
  created_at: string | null;
};

export type MyFpo = {
  memberships: {
    member_id: number;
    fpo_id: number;
    fpo_name: string;
    fpo_verified: boolean;
    district: string;
    state: string;
    status: string;
    joined_at: string | null;
  }[];
  contributions: Contribution[];
  payouts: FpoPayout[];
  grievances: Grievance[];
};

export type AdminFpo = {
  id: number;
  name: string;
  registration_no: string | null;
  district: string;
  state: string;
  verified: boolean;
  manager: string;
  manager_phone: string;
  members: number;
  lots: number;
  sales_value: number;
};

export type AdminBuyer = {
  id: number;
  name: string;
  verified: boolean;
  fpo_deals: number;
  marketplace_deals: number;
  trust: Trust;
};

const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const fpoApi = {
  org: () => request<FpoOrg>("/api/fpo/org"),
  updateOrg: (
    b: Omit<
      FpoOrg,
      | "id"
      | "manager_user_id"
      | "verified"
      | "verified_at"
      | "created_at"
      | "verified_by"
      | "primary_crops"
      | "rejection_reason"
    > & { primary_crops?: string },
  ) => send<FpoOrg>("PUT", "/api/fpo/org", b),
  dashboard: () => request<FpoDashboard>("/api/fpo/dashboard"),
  notifications: () => request<FpoNotification[]>("/api/fpo/notifications"),
  audit: () => request<AuditEntry[]>("/api/fpo/audit"),

  members: (q?: string, status?: string) =>
    request<FpoMember[]>(`/api/fpo/members${qs({ q, status })}`),
  member: (id: number) =>
    request<{ member: FpoMember; contributions: Contribution[]; payouts: FpoPayout[] }>(
      `/api/fpo/members/${id}`,
    ),
  createMember: (b: MemberInput) => send<FpoMember>("POST", "/api/fpo/members", b),
  updateMember: (id: number, b: MemberInput) => send<FpoMember>("PUT", `/api/fpo/members/${id}`, b),

  contributions: (status?: string) =>
    request<Contribution[]>(`/api/fpo/contributions${qs({ status })}`),
  createContribution: (b: {
    member_id: number;
    crop_name: string;
    variety: string;
    quantity_quintals: number;
    harvest_date: string;
    quality_note: string;
  }) => send<{ id: number }>("POST", "/api/fpo/contributions", b),
  reviewContribution: (id: number, action: "approve" | "reject") =>
    send<{ id: number; status: string }>("POST", `/api/fpo/contributions/${id}/${action}`),

  lots: () => request<FpoLot[]>("/api/fpo/lots"),
  lot: (id: number) =>
    request<{
      lot: FpoLot;
      contributions: Contribution[];
      quality: QualityRecord[];
      offers: FpoOffer[];
      sales: FpoSale[];
    }>(`/api/fpo/lots/${id}`),
  createLot: (b: { contribution_ids: number[]; variety?: string; warehouse_id?: number | null }) =>
    send<FpoLot>("POST", "/api/fpo/lots", b),
  assignWarehouse: (id: number, warehouse_id: number | null) =>
    send<FpoLot>("PUT", `/api/fpo/lots/${id}/warehouse`, { warehouse_id }),
  addQuality: (
    id: number,
    b: {
      inspector_name: string;
      inspected_on: string;
      moisture_pct: number;
      foreign_matter_pct: number;
      damaged_pct: number;
      grain_quality: string;
      grade: "A" | "B" | "C";
      certificate?: Upload | undefined;
    },
  ) => send<{ id: number }>("POST", `/api/fpo/lots/${id}/quality`, b),
  quality: () => request<QualityRecord[]>("/api/fpo/quality"),
  matches: (id: number) =>
    request<{ lot: FpoLot; matches: BuyerMatch[]; basis: string }>(`/api/fpo/lots/${id}/matches`),
  advice: (id: number) => request<Advice>(`/api/fpo/lots/${id}/advice`),
  demand: () => request<DemandForecast>("/api/fpo/demand"),

  buyers: () => request<BuyerProfile[]>("/api/fpo/buyers"),
  offers: () => request<FpoOffer[]>("/api/fpo/offers"),
  createOffer: (b: {
    lot_id: number;
    buyer_id: number;
    quantity_quintals: number;
    price_per_quintal: number;
    payment_terms: string;
    note: string;
  }) => send<{ id: number }>("POST", "/api/fpo/offers", b),
  respond: (id: number, b: RespondInput) =>
    send<{ id: number; status: string; sale_id?: number }>(
      "POST",
      `/api/fpo/offers/${id}/respond`,
      b,
    ),

  sales: () => request<FpoSale[]>("/api/fpo/sales"),
  sale: (id: number) =>
    request<{ sale: FpoSale; payments: FpoPayment[]; payouts: FpoPayout[]; shipments: Shipment[] }>(
      `/api/fpo/sales/${id}`,
    ),
  recordPayment: (
    id: number,
    b: {
      amount: number;
      kind: FpoPayment["kind"];
      method: FpoPayment["method"];
      reference: string;
      paid_on: string;
      receipt?: Upload | undefined;
    },
  ) => send<FpoSale>("POST", `/api/fpo/sales/${id}/payments`, b),
  updateExpenses: (
    id: number,
    b: { transport_cost: number; storage_cost: number; handling_cost: number },
  ) => send<FpoSale>("PUT", `/api/fpo/sales/${id}/expenses`, b),
  distribution: (id: number) => request<Distribution>(`/api/fpo/sales/${id}/distribution`),
  createDistribution: (id: number) =>
    send<{ created: number }>("POST", `/api/fpo/sales/${id}/distribution`),
  payPayout: (id: number, b: { reference: string; paid_on: string }) =>
    send<{ id: number }>("POST", `/api/fpo/payouts/${id}/pay`, b),

  warehouses: () => request<Warehouse[]>("/api/fpo/warehouses"),
  createWarehouse: (b: {
    name: string;
    location: string;
    capacity_quintals: number;
    rate_per_quintal_month: number;
  }) => send<{ id: number }>("POST", "/api/fpo/warehouses", b),
  transporters: () => request<Transporter[]>("/api/fpo/transporters"),
  createTransporter: (b: Omit<Transporter, "id">) =>
    send<{ id: number }>("POST", "/api/fpo/transporters", b),
  shipments: () => request<Shipment[]>("/api/fpo/shipments"),
  createShipment: (b: {
    sale_id: number;
    transporter_id: number | null;
    pickup_location: string;
    delivery_address: string;
    distance_km: number;
    expected_date: string;
  }) => send<{ id: number; estimated_cost: number }>("POST", "/api/fpo/shipments", b),
  shipmentStatus: (id: number, status: ShipmentStatus) =>
    send<{ id: number }>("POST", `/api/fpo/shipments/${id}/status`, { status }),

  grievances: () => request<Grievance[]>("/api/fpo/grievances"),
  createGrievance: (b: GrievanceInput) => send<{ id: number }>("POST", "/api/fpo/grievances", b),
  grievanceStatus: (id: number, status: GrievanceStatus, note: string) =>
    send<{ id: number }>("POST", `/api/fpo/grievances/${id}/status`, { status, note }),
  grievanceDocument: (id: number, document: Upload) =>
    send<{ id: number }>("POST", `/api/fpo/grievances/${id}/documents`, { document }),

  report: (kind: ReportKind, from?: string, to?: string) =>
    request<Report>(`/api/fpo/reports/${kind}${qs({ from, to })}`),

  // pools
  pools: () => request<Pool[]>("/api/fpo/pools"),
  pool: (id: number) => request<PoolDetail>(`/api/fpo/pools/${id}`),
  createPool: (b: {
    crop_name: string;
    target_grade: "A" | "B" | "C" | "";
    target_quantity_quintals: number;
    collection_center: string;
    collection_deadline: string;
    start_collecting: boolean;
  }) => send<Pool>("POST", "/api/fpo/pools", b),
  poolAction: (id: number, action: PoolAction) =>
    send<Pool>("POST", `/api/fpo/pools/${id}/action/${action}`),
  addPledge: (poolId: number, b: { member_id: number; quantity_quintals: number }) =>
    send<{ id: number }>("POST", `/api/fpo/pools/${poolId}/contributions`, b),
  intake: (
    poolId: number,
    contributionId: number,
    b:
      | {
          action: "receive";
          received_quintals: number;
          assessed_grade: "A" | "B" | "C";
          note?: string;
        }
      | { action: "reject"; note: string },
  ) =>
    send<{ id: number }>(
      "POST",
      `/api/fpo/pools/${poolId}/contributions/${contributionId}/intake`,
      b,
    ),

  // members joining
  joinRequests: () => request<JoinRequest[]>("/api/fpo/join-requests"),
  decideJoin: (id: number, action: "approve" | "reject") =>
    send<{ id: number; status: string }>("POST", `/api/fpo/join-requests/${id}/${action}`),

  // announcements
  fpoAnnouncements: () => request<Announcement[]>("/api/fpo/announcements"),
  postAnnouncement: (b: { title: string; body: string }) =>
    send<{ id: number }>("POST", "/api/fpo/announcements", b),
  myAnnouncements: () => request<Announcement[]>("/api/announcements"),

  // farmer
  findFpos: (q?: string, district?: string) =>
    request<FpoDirectoryEntry[]>(`/api/fpos${qs({ q, district })}`),
  requestToJoin: (fpoId: number, message: string) =>
    send<{ id: number }>("POST", `/api/fpos/${fpoId}/join-requests`, { message }),
  myPools: () => request<MyPools>("/api/fpo/my/pools"),
  pledge: (poolId: number, b: { quantity_quintals: number; source_lot_id?: number | undefined }) =>
    send<{ id: number; quantity_quintals: number }>(
      "POST",
      `/api/fpo/my/pools/${poolId}/pledge`,
      b,
    ),
  my: () => request<MyFpo>("/api/fpo/my"),
  myGrievance: (b: GrievanceInput) => send<{ id: number }>("POST", "/api/fpo/my/grievances", b),

  // buyer
  marketLots: () => request<FpoLot[]>("/api/fpo-market/lots"),
  buyerOffers: () => request<FpoOffer[]>("/api/fpo-market/offers"),
  buyerCreateOffer: (b: {
    lot_id: number;
    quantity_quintals: number;
    price_per_quintal: number;
    payment_terms: string;
    note: string;
  }) => send<{ id: number }>("POST", "/api/fpo-market/offers", b),
  buyerRespond: (id: number, b: RespondInput) =>
    send<{ id: number; status: string }>("POST", `/api/fpo-market/offers/${id}/respond`, b),

  // admin
  adminFpos: () => request<AdminFpo[]>("/api/admin/fpos"),
  adminVerifyFpo: (id: number, verified: boolean) =>
    send<{ id: number }>("POST", `/api/admin/fpos/${id}/verify`, { verified }),
  adminBuyers: () => request<AdminBuyer[]>("/api/admin/buyers"),
  adminVerifyBuyer: (id: number, verified: boolean) =>
    send<{ id: number }>("POST", `/api/admin/buyers/${id}/verify`, { verified }),
};

export const documentPath = (id: number) => `/api/fpo/documents/${id}`;

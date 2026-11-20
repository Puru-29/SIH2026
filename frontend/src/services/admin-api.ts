/** Typed client for /api/admin/* plus the dispute and notification endpoints. */

import { request } from "./api-client";

const send = <T>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown) =>
  request<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export type Paged<T> = { items: T[]; total: number; page: number; limit: number; pages: number };
export type ListParams = Partial<
  Record<
    "page" | "limit" | "q" | "role" | "status" | "district" | "crop" | "action" | "entity_type",
    string | number
  >
>;

export type Overview = {
  users_by_role: { role: string; status: string; count: number }[];
  new_this_week: { role: string; count: number }[];
  registrations_by_week: { week: string; count: number }[];
  active_lots: { farmer: number; farmer_quintals: number; fpo: number; fpo_quintals: number };
  open_demands: { count: number; quintals: number };
  transactions: { farmer: number; farmer_gmv: number; fpo: number; fpo_gmv: number; gmv: number };
  gmv_by_month: { month: string; gmv: number; deals: number }[];
  price_vs_mandi: {
    crop: string;
    realised_per_quintal: number;
    quantity_quintals: number;
    mandi_modal: number | null;
    difference_pct: number | null;
  }[];
  mandi_state: string;
  open_disputes: number;
  pending_verifications: { fpos: number; buyers: number };
};

export type PendingFpo = {
  id: number;
  name: string;
  registration_no: string | null;
  district: string;
  state: string;
  primary_crops: string;
  manager_id: number;
  manager: string;
  phone: string;
  created_at: string | null;
  members: number;
  rejection_reason: string | null;
};

export type PendingBuyer = {
  id: number;
  name: string;
  phone: string;
  created_at: string;
  demands: number;
  offers: number;
  verification_note: string | null;
};

export type AdminUser = {
  id: number;
  name: string;
  role: "farmer" | "buyer" | "fpo" | "admin";
  phone: string;
  status: "active" | "pending" | "suspended";
  created_at: string;
  location: string;
  buyer_verified: number;
  trust_score: number;
  lots: number;
  offers: number;
  transactions: number;
};

export type AdminUserDetail = {
  user: AdminUser;
  lots: {
    id: number;
    crop: string;
    quantity_quintals: number;
    quality: string;
    status: string;
    created_at: string | null;
  }[];
  offers: {
    id: number;
    lot_id: number;
    crop: string;
    price_per_quintal: number;
    status: string;
    created_by_role: string;
  }[];
  transactions: {
    id: number;
    crop: string;
    price_per_quintal: number;
    quantity_quintals: number;
    completed_at: string;
    buyer: string;
    farmer: string;
  }[];
  fpo: { id: number; name: string; verified: boolean; rejection_reason: string | null } | null;
  memberships: { fpo: string; status: string }[];
};

export type MarketLot = {
  kind: "farmer" | "fpo";
  id: number;
  crop: string;
  seller: string;
  quantity_quintals: number;
  quality: string;
  status: string;
  place: string;
  created_at: string | null;
  cancel_reason: string | null;
};

export type MarketOffer = {
  kind: "farmer" | "fpo";
  id: number;
  lot_id: number;
  crop: string;
  buyer: string;
  seller: string;
  quantity_quintals: number;
  price_per_quintal: number;
  status: string;
  created_at: string | null;
  cancel_reason: string | null;
};

export type MarketDemand = {
  id: number;
  crop: string;
  buyer: string;
  quantity_quintals: number;
  max_price: number;
  quality: string;
  location: string;
  required_by: string;
  status: string;
};

export type MarketTransaction = {
  kind: "farmer" | "fpo";
  id: number;
  crop: string;
  buyer: string;
  seller: string;
  quantity_quintals: number;
  price_per_quintal: number;
  amount: number;
  status: string;
  created_at: string;
  open_disputes: number;
};

export type Flag = {
  kind: "low_price" | "no_settlement" | "duplicate_lot";
  severity: "high" | "medium";
  entity_type: "offer" | "fpo_offer" | "user" | "lot";
  entity_id: number;
  lot_id?: number;
  message: string;
  status?: string;
};

export type Dispute = {
  id: number;
  transaction_id: number;
  raised_by: number;
  raised_by_name: string;
  raised_by_role: string;
  reason: string;
  status: "open" | "investigating" | "resolved" | "rejected";
  resolution_note: string | null;
  resolved_by_name: string | null;
  created_at: string;
  resolved_at: string | null;
  crop: string;
  amount: number;
  buyer: string;
  farmer: string;
};

export type DisputeDetail = {
  dispute: Dispute;
  buyer_contact: string;
  farmer_contact: string;
  other_disputes_on_order: number;
  timeline: { at: string | null; event: string }[];
};

export type GapStatus = "shortage" | "balanced" | "oversupply" | "no_demand" | "none";

export type SupplyDemand = {
  rows: {
    crop: string;
    state: string;
    demand_quintals: number;
    farmer_lots_quintals: number;
    fpo_lots_quintals: number;
    fpo_pools_quintals: number;
    supply_quintals: number;
    gap_quintals: number;
    status: GapStatus;
  }[];
  top_crops: {
    crop: string;
    demand_quintals: number;
    supply_quintals: number;
    status: GapStatus;
  }[];
  basis: string;
};

export type PriceTrend = {
  crop: string;
  state: string;
  realised: {
    month: string;
    price_per_quintal: number;
    quantity_quintals: number;
    deals: number;
  }[];
  mandi_monthly: { month: string; modal: number }[];
  mandi_today: number | null;
};

export type MasterTable = "crops" | "markets" | "transport" | "storage";
export type MasterRow = Record<string, string | number | null> & { id: number; in_use: number };

export type AdminAnnouncement = {
  id: number;
  author: string;
  audience: "fpo_members" | "all_farmers" | "all_buyers" | "all_fpos" | "all";
  district: string | null;
  fpo_name: string | null;
  title: string;
  body: string;
  created_at: string;
};

export type AuditRow = {
  id: number;
  admin: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

export type CropRequest = {
  id: number;
  crop_name: string;
  note: string;
  status: "open" | "added" | "dismissed";
  requested_by: string;
  role: string;
  created_at: string;
};

export const adminApi = {
  overview: () => request<Overview>("/api/admin/overview"),
  verifications: () =>
    request<{ fpos: PendingFpo[]; buyers: PendingBuyer[] }>("/api/admin/verifications"),
  decideFpo: (id: number, approve: boolean, reason = "") =>
    send<{ id: number }>("POST", `/api/admin/fpos/${id}/decision`, { approve, reason }),
  decideBuyer: (id: number, approve: boolean, reason = "") =>
    send<{ id: number }>("POST", `/api/admin/buyers/${id}/decision`, { approve, reason }),
  setTrust: (id: number, trust_score: number, reason: string) =>
    send<{ id: number }>("POST", `/api/admin/buyers/${id}/trust`, { trust_score, reason }),
  users: (p: ListParams) => request<Paged<AdminUser>>(`/api/admin/users${qs(p)}`),
  user: (id: number) => request<AdminUserDetail>(`/api/admin/users/${id}`),
  setUserStatus: (id: number, status: "active" | "suspended", reason: string) =>
    send<{ id: number; status: string }>("POST", `/api/admin/users/${id}/status`, {
      status,
      reason,
    }),
  lots: (p: ListParams) => request<Paged<MarketLot>>(`/api/admin/market/lots${qs(p)}`),
  offers: (p: ListParams) => request<Paged<MarketOffer>>(`/api/admin/market/offers${qs(p)}`),
  demands: (p: ListParams) => request<Paged<MarketDemand>>(`/api/admin/market/demands${qs(p)}`),
  transactions: (p: ListParams) =>
    request<Paged<MarketTransaction>>(`/api/admin/market/transactions${qs(p)}`),
  flags: () =>
    request<{ flags: Flag[]; price_check_unavailable: string[]; rules: string }>(
      "/api/admin/market/flags",
    ),
  cancelLot: (id: number, reason: string) =>
    send<{ id: number }>("POST", `/api/admin/lots/${id}/cancel`, { reason }),
  cancelOffer: (id: number, reason: string) =>
    send<{ id: number }>("POST", `/api/admin/offers/${id}/cancel`, { reason }),
  cancelFpoOffer: (id: number, reason: string) =>
    send<{ id: number }>("POST", `/api/admin/fpo-offers/${id}/cancel`, { reason }),
  disputes: (p: ListParams) => request<Paged<Dispute>>(`/api/admin/disputes${qs(p)}`),
  dispute: (id: number) => request<DisputeDetail>(`/api/admin/disputes/${id}`),
  setDisputeStatus: (id: number, status: Dispute["status"], note: string) =>
    send<{ id: number }>("POST", `/api/admin/disputes/${id}/status`, { status, note }),
  supplyDemand: () => request<SupplyDemand>("/api/admin/intel/supply-demand"),
  priceTrend: (crop: string, state?: string) =>
    request<PriceTrend>(`/api/admin/intel/prices${qs({ crop, state })}`),
  master: (t: MasterTable) => request<MasterRow[]>(`/api/admin/master/${t}`),
  masterCreate: (t: MasterTable, body: Record<string, unknown>) =>
    send<{ id: number }>("POST", `/api/admin/master/${t}`, body),
  masterUpdate: (t: MasterTable, id: number, body: Record<string, unknown>) =>
    send<{ id: number }>("PUT", `/api/admin/master/${t}/${id}`, body),
  masterDelete: (t: MasterTable, id: number) =>
    send<{ id: number }>("DELETE", `/api/admin/master/${t}/${id}`),
  announcements: (p: ListParams) =>
    request<Paged<AdminAnnouncement>>(`/api/admin/announcements${qs(p)}`),
  postAnnouncement: (b: { audience: string; district: string; title: string; body: string }) =>
    send<{ id: number }>("POST", "/api/admin/announcements", b),
  audit: (p: ListParams) => request<Paged<AuditRow>>(`/api/admin/audit${qs(p)}`),
  cropRequests: () => request<CropRequest[]>("/api/admin/crop-requests"),
  decideCropRequest: (id: number, action: "add" | "dismiss", name?: string) =>
    send<{ id: number; status: string }>("POST", `/api/admin/crop-requests/${id}/${action}`, {
      name,
    }),
};

/** Farmer/buyer side: disputes on orders. Notifications live in api-client (/api/notifications). */
export const userApi = {
  raiseDispute: (transaction_id: number, reason: string) =>
    send<{ id: number }>("POST", "/api/disputes", { transaction_id, reason }),
  myDisputes: () => request<Dispute[]>("/api/disputes/mine"),
  /** Farmers, buyers and FPOs ask the admin to add a crop missing from the list. */
  requestCrop: (crop_name: string, note?: string) =>
    send<{ id: number }>("POST", "/api/crop-requests", { crop_name, note }),
};

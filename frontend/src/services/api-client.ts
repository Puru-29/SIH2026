/**
 * api-client.ts — typed fetch wrapper for the Rust/Axum backend.
 *
 * Base URL:
 *   • Development  → "/api" proxied to http://127.0.0.1:8080 by Vite
 *   • Production   → set VITE_API_BASE_URL env var to the deployed backend URL
 *
 * Auth:
 *   Authenticated requests send `Authorization: Bearer <session token>`.
 *
 * Error handling:
 *   Non-2xx responses throw an `ApiError` with the status code and the
 *   backend's JSON error message when available.
 */

import { clearUser, getSession, type UserRole, type UserStatus } from "./session";

// ── Base URL ────────────────────────────────────────────────────────────────
// Vite replaces import.meta.env.VITE_* at build time.
// For local dev the proxy in vite.config.ts forwards /api → :8080, so we
// just use an empty string (same-origin relative URL).
const BASE_URL: string = (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "";

// ── Error type ───────────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getAuthErrorMessage(error: unknown, action: "login" | "register"): string {
  if (!(error instanceof ApiError)) {
    return "We could not reach the server. Please check your internet connection and try again.";
  }

  if (error.status === 401) {
    return "No account was found for this role and phone number, or the PIN is incorrect.";
  }

  if (error.status === 403) {
    return error.message || "This account cannot sign in right now.";
  }

  if (error.status === 400) {
    if (error.message.toLowerCase().includes("already exists")) {
      return "A farmer account already exists with this phone number. Please sign in instead.";
    }
    return (
      error.message ||
      `Please check your ${action === "register" ? "registration" : "login"} details.`
    );
  }

  if (error.status >= 500) {
    return "The server could not complete your request. Please try again in a moment.";
  }

  return error.message || "Something went wrong. Please try again.";
}

// ── Core request helper ──────────────────────────────────────────────────────
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = getSession();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };

  if (session) {
    headers["Authorization"] = `Bearer ${session.token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });

  // An expired or revoked session: sign out locally and go to the sign-in page.
  // (Wrong-PIN 401s from the login endpoint itself are left to the form.)
  if (res.status === 401 && session && !path.startsWith("/api/auth/")) {
    clearUser();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/auth")) {
      window.location.assign("/auth");
    }
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const json = (await res.json()) as { error?: string; message?: string };
      message = json.error ?? json.message ?? message;
    } catch {
      /* response body wasn't JSON */
    }
    throw new ApiError(res.status, message);
  }

  // 204 No Content — return null cast to T
  if (res.status === 204) return null as unknown as T;

  return res.json() as Promise<T>;
}

/** Opens a protected file (e.g. a certificate) in a new tab using the session header. */
export async function openProtectedFile(path: string): Promise<void> {
  const session = getSession();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: session ? { Authorization: `Bearer ${session.token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, "Could not open the file");
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ── Typed endpoint wrappers ──────────────────────────────────────────────────

// ── Health ───────────────────────────────────────────────────────────────────
export interface HealthResponse {
  status: string;
  version: string;
}

export const getHealth = (): Promise<HealthResponse> => request<HealthResponse>("/health");

export interface AuthResponse {
  user_id: number;
  role: UserRole;
  name: string;
  status: UserStatus;
  /** Present on login/register; absent on /api/auth/me. */
  token?: string;
}

export const loginFarmer = (phone: string, pin: string, role: UserRole): Promise<AuthResponse> =>
  request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone, pin, role }),
  });

/** Sign-up place (farmers and FPOs) plus FPO-only details. */
export interface FpoSignupFields {
  registration_no?: string;
  district: string;
  state: string;
  primary_crops?: string;
}

export const registerFarmer = (
  name: string,
  phone: string,
  pin: string,
  role: "farmer" | "buyer" | "fpo",
  fpo?: FpoSignupFields,
): Promise<AuthResponse> =>
  request<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, phone, pin, role, ...(role === "buyer" ? {} : fpo) }),
  });

/** The signed-in user with role and status from the server. */
export const getMe = (): Promise<AuthResponse> => request<AuthResponse>("/api/auth/me");

/** Ends the server session and clears the local one. Never throws. */
export async function logout(): Promise<void> {
  try {
    await request<void>("/api/auth/logout", { method: "POST" });
  } catch {
    /* offline or already expired: still clear locally */
  }
  clearUser();
}

export interface BackendCrop {
  id: number;
  name: string;
  perishability_days: number;
}

export const getCrops = (): Promise<BackendCrop[]> => request<BackendCrop[]>("/api/crops");

/**
 * Resolves a crop name to an existing crop. Only admins add crops, so a name
 * that is not in the list is an error with a hint to request it.
 */
export async function ensureCrop(name: string): Promise<BackendCrop> {
  const wanted = name.trim().toLowerCase();
  const crop = (await getCrops()).find((c) => c.name.toLowerCase() === wanted);
  if (!crop) {
    throw new Error(
      `${name.trim()} is not in the crop list. Pick a crop from the list, or use "Request it" to ask the admin to add it.`,
    );
  }
  return crop;
}

// ── Market prices ─────────────────────────────────────────────────────────────
export interface BackendLiveMandiPrice {
  id: string;
  crop_name: string;
  state: string;
  district: string | null;
  market: string;
  variety: string | null;
  grade: string | null;
  min_price: number;
  max_price: number;
  modal_price: number;
  price_per_kg: number;
  date: string;
}

export function getLiveMandiPrices(params: {
  state: string;
  commodity?: string;
}): Promise<BackendLiveMandiPrice[]> {
  const qs = new URLSearchParams({
    state: params.state,
    ...(params.commodity && { commodity: params.commodity }),
  });
  return request<BackendLiveMandiPrice[]>(`/api/mandi/prices?${qs}`);
}

export const getMandiStates = (): Promise<string[]> => request<string[]>("/api/mandi/states");

export const getMandiCommodities = (state?: string): Promise<string[]> => {
  const qs = state ? `?state=${encodeURIComponent(state)}` : "";
  return request<string[]>(`/api/mandi/commodities${qs}`);
};

export interface BackendBuyerPrice {
  id: number;
  buyer_id: number;
  buyer_name: string;
  crop_id: number;
  crop_name: string;
  price_per_quintal: number;
  price_per_kg: number;
  min_quantity_quintals: number;
  quality: string;
  delivery_location: string;
  required_by: string;
  status: string;
  /** Open lots of the same crop (buyer's own requirements only). */
  matching_lots?: number;
}

export const getBuyerPrices = (): Promise<BackendBuyerPrice[]> =>
  request<BackendBuyerPrice[]>("/api/buyers/prices");

export interface CreateBuyerDemandRequest {
  crop_id: number;
  min_quantity: number;
  max_price: number;
  required_quality: string;
  delivery_location: string;
  required_by: string;
}

export const createBuyerDemand = (body: CreateBuyerDemandRequest): Promise<BackendBuyerDemand> =>
  request<BackendBuyerDemand>("/api/buyer-demands", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getBuyerDemands = (): Promise<BackendBuyerPrice[]> =>
  request<BackendBuyerPrice[]>("/api/buyer-demands");

export const deleteBuyerDemand = (demandId: number): Promise<void> =>
  request<void>(`/api/buyer-demands/${demandId}`, { method: "DELETE" });

// ── Net realisation calculator ────────────────────────────────────────────────
export interface NetRealisationRequest {
  crop_id: number;
  market_id: number;
  quantity_quintals: number;
  farmer_location: string;
  handling_costs: number;
  expected_deductions: number;
  expected_storage_days: number;
}

export interface NetRealisationResponse {
  sale_price_total: number;
  transport_cost_total: number;
  storage_cost_total: number;
  handling_costs: number;
  expected_deductions: number;
  net_realisation: number;
}

export const calculateNetRealisation = (
  body: NetRealisationRequest,
): Promise<NetRealisationResponse> =>
  request<NetRealisationResponse>("/api/calculator/net-realisation", {
    method: "POST",
    body: JSON.stringify(body),
  });

// ── Smart-sale advisor ────────────────────────────────────────────────────────
export type UrgencyLevel = "high" | "medium" | "low";
export type SmartSaleStrategy = "SELL_NOW" | "WAIT" | "PARTIAL_SELL";

export interface SmartSaleRequest {
  crop_id: number;
  quantity_quintals: number;
  current_price_per_quintal: number;
  expected_future_price: number;
  storage_cost_per_day: number;
  farmer_urgency: UrgencyLevel;
  handling_costs: number;
}

export interface SmartSaleResponse {
  strategy: SmartSaleStrategy;
  reason: string;
  immediate_net_realisation: number;
  future_net_realisation: number;
  suggested_sell_ratio: number;
}

export const evaluateSmartSale = (body: SmartSaleRequest): Promise<SmartSaleResponse> =>
  request<SmartSaleResponse>("/api/advisor/smart-sale", {
    method: "POST",
    body: JSON.stringify(body),
  });

// ── Lots ──────────────────────────────────────────────────────────────────────
/** open → offer_received → sold, or withdrawn / cancelled. */
export type LotDisplayStatus = "open" | "offer_received" | "sold" | "withdrawn" | "cancelled";

export interface BackendLot {
  id: number;
  farmer_id: number;
  crop_id: number;
  quantity_quintals: number;
  expected_quality: string;
  status: string;
  // Present on GET /api/lots and lot detail (not on the create response).
  farmer_name?: string;
  farmer_location?: string;
  crop_name?: string;
  perishability_days?: number;
  created_at?: string;
  updated_at?: string | null;
  days_listed?: number;
  pending_offers?: number;
  best_offer?: number | null;
  cancel_reason?: string | null;
  my_offer_status?: string | null;
  my_offer_price?: number | null;
  display_status?: LotDisplayStatus;
}

export interface CreateLotRequest {
  crop_id: number;
  quantity_quintals: number;
  expected_quality: string;
}

export const createLot = (body: CreateLotRequest): Promise<BackendLot> =>
  request<BackendLot>("/api/lots", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getLots = (): Promise<BackendLot[]> => request<BackendLot[]>("/api/lots");

export const updateLot = (
  lotId: number,
  body: { quantity_quintals?: number; expected_quality?: string },
): Promise<BackendLot> =>
  request<BackendLot>(`/api/lots/${lotId}`, { method: "PATCH", body: JSON.stringify(body) });

export const withdrawLot = (lotId: number, reason?: string): Promise<BackendLot> =>
  request<BackendLot>(`/api/lots/${lotId}/withdraw`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });

export interface LotDetail {
  lot: BackendLot;
  offers: BackendOffer[];
}

export const getLotDetail = (lotId: number): Promise<LotDetail> =>
  request<LotDetail>(`/api/lots/${lotId}`);

// ── Matching buyers for a lot (ranked by services::matcher) ──────────────────
export interface BackendBuyerDemand {
  id: number;
  buyer_id: number;
  crop_id: number;
  min_quantity: number;
  max_price: number;
  required_quality: string;
  delivery_location: string;
  required_by: string;
  buyer_name?: string;
  verified?: boolean;
  trust_score?: number;
  freight_per_quintal?: number | null;
  net_price_per_quintal?: number;
  score?: number;
  reasons?: string[];
}

export const getMatchingBuyers = (lotId: number): Promise<BackendBuyerDemand[]> =>
  request<BackendBuyerDemand[]>(`/api/lots/${lotId}/matching-buyers`);

// ── Price signals and forecast ────────────────────────────────────────────────
export interface PriceDriver {
  key: string;
  label: string;
  value: string;
  /** up = supports higher prices, down = pushes prices lower, risk = reason to sell soon */
  impact: "up" | "down" | "risk" | "neutral";
  detail: string;
}

export interface ForecastPoint {
  date: string;
  price: number;
  kind: "actual" | "forecast";
  low: number | null;
  high: number | null;
}

export interface PriceOutlook {
  current: number;
  ma7: number;
  ma14: number;
  trend_per_day: number;
  direction: "rising" | "falling" | "steady";
  change_14d_percent: number;
  expected_7d: number;
  expected_14d: number;
  volatility_percent: number;
  points: ForecastPoint[];
  history_days: number;
}

export interface ForecastResponse {
  crop: string;
  state: string;
  horizon_days: number;
  outlook: PriceOutlook | null;
  history_days: number;
  seasonal_note: string | null;
  drivers: PriceDriver[];
  label: string;
  source_available: boolean;
  basis: string;
}

export const getForecast = (
  crop: string,
  state?: string,
  horizon = 14,
): Promise<ForecastResponse> => {
  const qs = new URLSearchParams({ crop, horizon: String(horizon), ...(state ? { state } : {}) });
  return request<ForecastResponse>(`/api/forecast?${qs}`);
};

export interface LotSignals {
  lot: BackendLot;
  state: string;
  current_price: number | null;
  current_price_source: string;
  expected_price: number | null;
  horizon_days: number;
  outlook: PriceOutlook | null;
  drivers: PriceDriver[];
  smart_sale_inputs: SmartSaleRequest | null;
  label: string;
}

export const getLotSignals = (lotId: number): Promise<LotSignals> =>
  request<LotSignals>(`/api/lots/${lotId}/signals`);

// ── Offers ────────────────────────────────────────────────────────────────────
/** pending, accepted, rejected, countered or cancelled. */
export interface BackendOffer {
  id: number;
  lot_id: number;
  buyer_id: number;
  price_offered: number;
  status: string;
  created_by_role: "buyer" | "farmer";
  buyer_name?: string;
  farmer_id?: number;
  farmer_name?: string;
  crop_name?: string;
  quantity_quintals?: number;
  expected_quality?: string;
  lot_status?: string;
  parent_offer_id?: number | null;
  created_at?: string;
  responded_at?: string | null;
  cancel_reason?: string | null;
}

export interface CreateOfferRequest {
  lot_id: number;
  price_offered: number;
  buyer_id?: number;
}

export const createOffer = (body: CreateOfferRequest): Promise<BackendOffer> =>
  request<BackendOffer>("/api/offers", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const acceptOffer = (offerId: number): Promise<BackendTransaction> =>
  request<BackendTransaction>(`/api/offers/${offerId}/accept`, {
    method: "POST",
  });

export const rejectOffer = (offerId: number, reason?: string): Promise<BackendOffer> =>
  request<BackendOffer>(`/api/offers/${offerId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });

export const counterOffer = (offerId: number, price: number): Promise<BackendOffer> =>
  request<BackendOffer>(`/api/offers/${offerId}/counter`, {
    method: "POST",
    body: JSON.stringify({ price }),
  });

export const withdrawOffer = (offerId: number): Promise<BackendOffer> =>
  request<BackendOffer>(`/api/offers/${offerId}/withdraw`, { method: "POST" });

export const getOffers = (): Promise<BackendOffer[]> => request<BackendOffer[]>("/api/offers");

// ── Orders (transactions), tracking and payments ─────────────────────────────
export type OrderStep = "accepted" | "picked_up" | "in_transit" | "delivered";
export type PaymentStatus = "pending" | "awaiting_confirmation" | "partially_paid" | "paid";

export interface BackendTransaction {
  id: number;
  offer_id: number;
  final_price: number;
  /** accepted, picked_up, in_transit, delivered, completed */
  status: string;
  completed_at: string;
  crop_name: string;
  quantity_quintals: number;
  buyer_name: string;
  farmer_name: string;
  lot_id: number;
  accepted_by_role: "farmer" | "buyer";
  buyer_id: number;
  farmer_id: number;
  pickup_location: string | null;
  delivery_location: string | null;
  expected_quality: string;
  order_status: OrderStep;
  paid_confirmed: number;
  paid_awaiting: number;
  total_amount: number;
  payment_status: PaymentStatus;
  balance_due: number;
}

export interface OrderEvent {
  id: number;
  status: OrderStep;
  note: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
}

export interface OrderPayment {
  id: number;
  amount: number;
  method: "upi" | "bank_transfer" | "cash" | "cheque";
  reference: string | null;
  status: "marked_paid" | "confirmed" | "not_received";
  paid_at: string;
  confirmed_at: string | null;
  note: string | null;
}

export interface NetRealisation {
  gross: number;
  transport: number;
  freight_per_quintal: number;
  freight_known: boolean;
  platform_fee: number;
  platform_fee_percent: number;
  net: number;
  net_per_quintal: number;
}

export interface OrderDetail {
  order: BackendTransaction;
  my_role: "farmer" | "buyer" | "admin";
  counterpart: { id: number; name: string; role: "farmer" | "buyer" };
  events: OrderEvent[];
  steps: OrderStep[];
  current_step: OrderStep;
  payments: OrderPayment[];
  net_realisation: NetRealisation;
  freight_note: string;
}

export const getTransactions = (): Promise<BackendTransaction[]> =>
  request<BackendTransaction[]>("/api/transactions");

export const getOrderDetail = (transactionId: number): Promise<OrderDetail> =>
  request<OrderDetail>(`/api/transactions/${transactionId}`);

export const addOrderEvent = (
  transactionId: number,
  status: OrderStep,
  note?: string,
): Promise<BackendTransaction> =>
  request<BackendTransaction>(`/api/transactions/${transactionId}/events`, {
    method: "POST",
    body: JSON.stringify({ status, note }),
  });

export const recordPayment = (
  transactionId: number,
  body: { amount: number; method: OrderPayment["method"]; reference?: string; paid_at?: string },
): Promise<BackendTransaction> =>
  request<BackendTransaction>(`/api/transactions/${transactionId}/payments`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const confirmPayment = (paymentId: number): Promise<BackendTransaction> =>
  request<BackendTransaction>(`/api/payments/${paymentId}/confirm`, { method: "POST" });

export const paymentNotReceived = (
  paymentId: number,
  reason?: string,
): Promise<BackendTransaction> =>
  request<BackendTransaction>(`/api/payments/${paymentId}/not-received`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });

// ── Storage ───────────────────────────────────────────────────────────────────
export interface StorageOptions {
  rates: {
    market_id: number;
    market: string;
    location: string;
    cost_per_quintal_per_day: number;
    cost_per_quintal_per_month: number;
  }[];
  warehouses: {
    id: number;
    name: string;
    location: string;
    capacity_quintals: number;
    rate_per_quintal_month: number;
    fpo_name: string;
    district: string;
    state: string;
    /** The FPO manager, for messages. */
    fpo_user_id: number;
  }[];
}

export const getStorageOptions = (): Promise<StorageOptions> =>
  request<StorageOptions>("/api/storage-options");

// ── Suppliers (buyer side) ────────────────────────────────────────────────────
export interface Supplier {
  key: string;
  kind: "farmer" | "fpo";
  id: number;
  user_id: number;
  name: string;
  location: string;
  verified: boolean;
  fpo_name: string | null;
  crops: string[];
  open_lots: number;
  open_quantity: number;
  completed_deals: number;
  members: number | null;
}

export interface SupplierLot {
  kind: "farmer" | "fpo";
  id: number;
  code: string | null;
  crop: string;
  quantity_quintals: number;
  quality: string;
  best_offer?: number | null;
  my_offer_status?: string | null;
  listed_at: string;
}

export const getSuppliers = (filters: {
  crop?: string;
  location?: string;
  q?: string;
}): Promise<Supplier[]> => {
  const qs = new URLSearchParams(
    Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1]?.trim())),
  );
  return request<Supplier[]>(`/api/suppliers${qs.size ? `?${qs}` : ""}`);
};

export const getSupplier = (
  kind: string,
  id: number,
): Promise<{ supplier: Supplier; lots: SupplierLot[] }> => request(`/api/suppliers/${kind}/${id}`);

// ── Buyer requirements ────────────────────────────────────────────────────────
export const updateBuyerDemand = (
  demandId: number,
  body: Partial<CreateBuyerDemandRequest>,
): Promise<void> =>
  request<void>(`/api/buyer-demands/${demandId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const fulfilBuyerDemand = (demandId: number): Promise<void> =>
  request<void>(`/api/buyer-demands/${demandId}/fulfil`, { method: "POST" });

export interface DemandMatch {
  lot: BackendLot;
  quantity_ok: boolean;
  quality_ok: boolean;
  freight_per_quintal: number | null;
}

export const getDemandMatches = (demandId: number): Promise<DemandMatch[]> =>
  request<DemandMatch[]>(`/api/buyer-demands/${demandId}/matches`);

// ── Messages ──────────────────────────────────────────────────────────────────
export interface Conversation {
  user_id: number;
  name: string;
  role: string;
  last_body: string;
  last_at: string;
  last_from_me: boolean;
  unread: number;
}

export interface ChatMessage {
  id: number;
  sender_id: number;
  receiver_id: number;
  lot_id: number | null;
  transaction_id: number | null;
  body: string;
  created_at: string;
  read_at: string | null;
}

export const getConversations = (): Promise<Conversation[]> =>
  request<Conversation[]>("/api/conversations");

export const getConversation = (
  userId: number,
): Promise<{ partner: { id: number; name: string; role: string }; messages: ChatMessage[] }> =>
  request(`/api/conversations/${userId}/messages`);

export const sendMessage = (
  userId: number,
  body: { body: string; lot_id?: number; transaction_id?: number },
): Promise<ChatMessage> =>
  request<ChatMessage>(`/api/conversations/${userId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });

// ── Profile ───────────────────────────────────────────────────────────────────
export interface MyProfile {
  id: number;
  name: string;
  role: UserRole;
  phone: string;
  status: UserStatus;
  member_since: string;
  preferred_language: string | null;
  location: string | null;
  state: string | null;
  urgency_level: UrgencyLevel | null;
  verified: boolean | null;
  trust_score: number | null;
  /** Farmer saved before district was asked at sign-up: prompt once to confirm it. */
  needs_district?: boolean;
  stats: {
    lots: number;
    open_lots: number;
    deals: number;
    deal_value: number;
    open_requirements: number;
  };
}

export const getMyProfile = (): Promise<MyProfile> => request<MyProfile>("/api/me");

export const updateMyProfile = (body: {
  name?: string;
  location?: string;
  /** Farmers: saved together as "District, State". */
  district?: string;
  state?: string;
  urgency_level?: UrgencyLevel;
  preferred_language?: string;
}): Promise<MyProfile> =>
  request<MyProfile>("/api/me", { method: "PATCH", body: JSON.stringify(body) });

// ── Notifications ─────────────────────────────────────────────────────────────
export type NotificationType =
  | "offer"
  | "counter"
  | "accepted"
  | "rejected"
  | "matching_lot"
  | "payment"
  | "order"
  | "message"
  | "dispute"
  | "admin"
  | "general";

export interface BackendNotification {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
  read: boolean;
}

export const getNotificationsFeed = (): Promise<BackendNotification[]> =>
  request<BackendNotification[]>("/api/notifications");

export const markNotificationRead = (id: number): Promise<void> =>
  request<void>(`/api/notifications/${id}/read`, { method: "POST" });

export const markAllNotificationsRead = (): Promise<void> =>
  request<void>("/api/notifications/read-all", { method: "POST" });

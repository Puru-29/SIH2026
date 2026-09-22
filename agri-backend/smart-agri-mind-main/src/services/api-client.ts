/**
 * api-client.ts — typed fetch wrapper for the Rust/Axum backend.
 *
 * Base URL:
 *   • Development  → "/api" proxied to http://127.0.0.1:8080 by Vite
 *   • Production   → set VITE_API_BASE_URL env var to the deployed backend URL
 *
 * Auth:
 *   Authenticated requests include the farmer session's user ID header.
 *
 * Error handling:
 *   Non-2xx responses throw an `ApiError` with the status code and the
 *   backend's JSON error message when available.
 */

import { getSession } from "./session";

// ── Base URL ────────────────────────────────────────────────────────────────
// Vite replaces import.meta.env.VITE_* at build time.
// For local dev the proxy in vite.config.ts forwards /api → :8080, so we
// just use an empty string (same-origin relative URL).
const BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

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
    return "No farmer account was found for these details, or the PIN is incorrect.";
  }

  if (error.status === 400) {
    if (error.message.toLowerCase().includes("already exists")) {
      return "A farmer account already exists with this phone number. Please sign in instead.";
    }
    return error.message || `Please check your ${action === "register" ? "registration" : "login"} details.`;
  }

  if (error.status >= 500) {
    return "The server could not complete your request. Please try again in a moment.";
  }

  return error.message || "Something went wrong. Please try again.";
}

// ── Core request helper ──────────────────────────────────────────────────────
async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const session = getSession();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };

  if (session) {
    headers["X-User-Id"] = String(session.userId);
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });

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

// ── Typed endpoint wrappers ──────────────────────────────────────────────────

// ── Health ───────────────────────────────────────────────────────────────────
export interface HealthResponse {
  status: string;
  version: string;
}

export const getHealth = (): Promise<HealthResponse> =>
  request<HealthResponse>("/health");

export interface AuthResponse {
  user_id: number;
  role: "farmer" | "buyer" | "fpo" | "admin";
  name: string;
}

export const loginFarmer = (phone: string, pin: string, role: "farmer" | "buyer"): Promise<AuthResponse> =>
  request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone, pin, role }),
  });

export const registerFarmer = (name: string, phone: string, pin: string, role: "farmer" | "buyer"): Promise<AuthResponse> =>
  request<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, phone, pin, role }),
  });

export interface BackendCrop {
  id: number;
  name: string;
  perishability_days: number;
}

export const getCrops = (): Promise<BackendCrop[]> =>
  request<BackendCrop[]>("/api/crops");

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

export function getLiveMandiPrices(
  params: { state: string; commodity?: string },
): Promise<BackendLiveMandiPrice[]> {
  const qs = new URLSearchParams({
    state: params.state,
    ...(params.commodity && { commodity: params.commodity }),
  });
  return request<BackendLiveMandiPrice[]>(`/api/mandi/prices?${qs}`);
}

export const getMandiStates = (): Promise<string[]> =>
  request<string[]>("/api/mandi/states");

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

export const evaluateSmartSale = (
  body: SmartSaleRequest,
): Promise<SmartSaleResponse> =>
  request<SmartSaleResponse>("/api/advisor/smart-sale", {
    method: "POST",
    body: JSON.stringify(body),
  });

// ── Lots ──────────────────────────────────────────────────────────────────────
export interface BackendLot {
  id: number;
  farmer_id: number;
  crop_id: number;
  quantity_quintals: number;
  expected_quality: string;
  status: string;
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

// ── Matching buyers for a lot ─────────────────────────────────────────────────
export interface BackendBuyerDemand {
  id: number;
  buyer_id: number;
  crop_id: number;
  min_quantity: number;
  max_price: number;
  required_quality: string;
  delivery_location: string;
  required_by: string;
}

export const getMatchingBuyers = (
  lotId: number,
): Promise<BackendBuyerDemand[]> =>
  request<BackendBuyerDemand[]>(`/api/lots/${lotId}/matching-buyers`);

export const getLots = (): Promise<BackendLot[]> =>
  request<BackendLot[]>("/api/lots");

// ── Offers ────────────────────────────────────────────────────────────────────
export interface BackendOffer {
  id: number;
  lot_id: number;
  buyer_id: number;
  price_offered: number;
  status: string;
  created_by_role: "buyer" | "farmer";
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

export const getOffers = (): Promise<BackendOffer[]> =>
  request<BackendOffer[]>("/api/offers");

// ── Transactions ──────────────────────────────────────────────────────────────
export interface BackendTransaction {
  id: number;
  offer_id: number;
  final_price: number;
  status: string;
  completed_at: string;
  crop_name: string;
  quantity_quintals: number;
  buyer_name: string;
  farmer_name: string;
}

export const getTransaction = (
  transactionId: number,
): Promise<BackendTransaction> =>
  request<BackendTransaction>(`/api/transactions/${transactionId}`);

export const getTransactions = (): Promise<BackendTransaction[]> =>
  request<BackendTransaction[]>("/api/transactions");

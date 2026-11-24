/** Phone OTP, buyer verification levels, documents and deal contacts. */
import { BASE_URL, request } from "./api-client";
import { getSession } from "./session";

export type BuyerBadge = {
  level: 0 | 1 | 2;
  trusted: boolean;
  label: "Trusted Buyer" | "Verified Business" | "ID Verified" | "Unverified";
  rank: number;
};

export type Contact = {
  id: number;
  name: string;
  role: "farmer" | "buyer" | "fpo" | "admin";
  phone: string;
  phone_verified: boolean;
  business_name: string | null;
  badge: BuyerBadge | null;
};

export type DocKind = "id_proof" | "authorisation" | "business_proof" | "bank_proof" | "shop_photo";

export type VerificationDoc = {
  id: number;
  kind: DocKind;
  doc_type: string;
  file_name: string;
  mime_type: string;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  is_sample: boolean;
  masked_aadhaar_confirmed: boolean;
};

export type BusinessType = "individual" | "proprietorship" | "partnership" | "company";

export type VerificationDetails = {
  business_type: BusinessType | null;
  business_name: string;
  address: string;
  district: string;
  state: string;
  pincode: string;
  crops_bought: string;
  monthly_capacity_quintals: number | null;
  gstin: string | null;
  pan: string | null;
  gst_registered: boolean;
  bank_holder_name: string | null;
  bank_ifsc: string | null;
  bank_account_masked: string | null;
  bank_holder_mismatch: boolean;
  consent_at: string | null;
  submitted_at: string | null;
  admin_note: string | null;
  is_sample: boolean;
  level: number;
};

export type Verification = {
  buyer_id: number;
  name: string;
  phone?: string;
  phone_verified: boolean;
  badge: BuyerBadge;
  order_limit: number;
  status: "draft" | "submitted" | "approved" | "rejected";
  details: VerificationDetails | null;
  documents: VerificationDoc[];
  missing_level1: string[];
  missing_level2: string[];
  missing_level1_approved?: string[];
  missing_level2_approved?: string[];
  expected_documents: Partial<Record<DocKind, string>>;
  otp_test_code: string | null;
  trust_facts?: {
    completed_deals: number;
    late_payments: number;
    rating: number;
    lost_disputes_90d: number;
  };
};

export type DetailsInput = {
  business_type: BusinessType;
  business_name: string;
  address: string;
  district?: string;
  state?: string;
  pincode: string;
  crops_bought: string;
  monthly_capacity_quintals: number;
  gstin?: string;
  pan?: string;
  bank_holder_name?: string;
  bank_account?: string;
  bank_account_confirm?: string;
  bank_ifsc?: string;
};

export type QueueRow = {
  buyer_id: number;
  name: string;
  phone: string;
  phone_verified: boolean;
  status: string;
  level: number;
  business_name: string;
  submitted_at: string | null;
  pending_documents: number;
  is_sample: boolean;
  badge: BuyerBadge;
};

const post = <T>(path: string, body?: unknown) =>
  request<T>(
    path,
    body === undefined ? { method: "POST" } : { method: "POST", body: JSON.stringify(body) },
  );

export const verificationApi = {
  sendOtp: () =>
    post<{ sent_to: string; test_mode: boolean; test_code: string | null }>(
      "/api/me/phone/otp/send",
    ),
  verifyOtp: (code: string) =>
    post<{ phone_verified: boolean }>("/api/me/phone/otp/verify", { code }),
  mine: () => request<Verification>("/api/me/verification"),
  saveDetails: (b: DetailsInput) =>
    request<Verification>("/api/me/verification", { method: "PUT", body: JSON.stringify(b) }),
  upload: (b: {
    kind: DocKind;
    doc_type: string;
    file_name?: string;
    data_base64: string;
    masked_aadhaar_confirmed?: boolean;
  }) => post<{ id: number }>("/api/me/verification/documents", b),
  submit: (consent: boolean) => post<Verification>("/api/me/verification/submit", { consent }),
  deleteMyDocuments: () =>
    request<{ deleted: number }>("/api/me/verification/documents", { method: "DELETE" }),
  badge: (buyerId: number) => request<BuyerBadge>(`/api/buyers/${buyerId}/badge`),
  orderContact: (txId: number) => request<Contact>(`/api/transactions/${txId}/contact`),
  fpoOfferContact: (offerId: number) =>
    request<Contact>(`/api/fpo-market/offers/${offerId}/contact`),
  // admin
  queue: (status = "") =>
    request<QueueRow[]>(`/api/admin/buyer-verifications${status ? `?status=${status}` : ""}`),
  detail: (id: number) => request<Verification>(`/api/admin/buyer-verifications/${id}`),
  grant: (id: number, level: 1 | 2, note?: string) =>
    post<{ level: number }>(`/api/admin/buyer-verifications/${id}/grant`, { level, note }),
  reject: (id: number, reason: string) =>
    post(`/api/admin/buyer-verifications/${id}/reject`, { reason }),
  reviewDoc: (docId: number, action: "approve" | "reject", reason?: string) =>
    post(`/api/admin/buyer-documents/${docId}/${action}`, { reason }),
};

/** Opens a private document (owner or admin) in a new tab without caching a URL anywhere. */
export async function openDocument(docId: number, admin: boolean) {
  const path = admin
    ? `/api/admin/buyer-documents/${docId}`
    : `/api/me/verification/documents/${docId}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${getSession()?.token ?? ""}` },
    cache: "no-store",
  });
  if (!res.ok)
    throw new Error((await res.json().catch(() => null))?.error ?? "Could not open document");
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Reads a chosen file as a data URL (for document uploads; crop/shop photos use the camera). */
export const readFile = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the file"));
    r.readAsDataURL(file);
  });

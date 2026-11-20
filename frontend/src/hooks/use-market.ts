/**
 * React Query hooks for the farmer and buyer portals: lot detail and edits,
 * negotiation, order tracking and payments, forecast, suppliers, messages,
 * profile and notifications. Mutations refresh every list they can affect.
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  addOrderEvent,
  confirmPayment,
  counterOffer,
  fulfilBuyerDemand,
  getConversation,
  getConversations,
  getDemandMatches,
  getForecast,
  getLotDetail,
  getLotSignals,
  getMyProfile,
  getNotificationsFeed,
  getStorageOptions,
  getSupplier,
  getSuppliers,
  markAllNotificationsRead,
  markNotificationRead,
  paymentNotReceived,
  recordPayment,
  rejectOffer,
  sendMessage,
  updateBuyerDemand,
  updateLot,
  updateMyProfile,
  withdrawLot,
  withdrawOffer,
  type BackendNotification,
  type CreateBuyerDemandRequest,
  type OrderPayment,
  type OrderStep,
  type UrgencyLevel,
} from "@/services/api-client";
import { getSession } from "@/services/session";

const isTrader = () => {
  const role = getSession()?.role;
  return role === "farmer" || role === "buyer";
};

/** Everything a deal action can change. */
export function refreshMarket(qc: QueryClient) {
  for (const key of [
    "lots",
    "lot-detail",
    "lot-signals",
    "offers",
    "transactions",
    "notifications-feed",
    "buyer-demands",
    "demand-matches",
    "matching-buyers",
    "my-profile",
  ]) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}

/* ------------------------------- lots ---------------------------------- */

export function useLotDetail(lotId: number | undefined) {
  return useQuery({
    queryKey: ["lot-detail", lotId],
    queryFn: () => getLotDetail(lotId!),
    enabled: typeof lotId === "number" && lotId > 0,
    staleTime: 10_000,
  });
}

export function useLotSignals(lotId: number | undefined) {
  return useQuery({
    queryKey: ["lot-signals", lotId],
    queryFn: () => getLotSignals(lotId!),
    enabled: typeof lotId === "number" && lotId > 0,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useUpdateLot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { lotId: number; quantity_quintals?: number; expected_quality?: string }) =>
      updateLot(v.lotId, {
        ...(v.quantity_quintals !== undefined && { quantity_quintals: v.quantity_quintals }),
        ...(v.expected_quality !== undefined && { expected_quality: v.expected_quality }),
      }),
    onSuccess: () => refreshMarket(qc),
  });
}

export function useWithdrawLot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { lotId: number; reason?: string }) => withdrawLot(v.lotId, v.reason),
    onSuccess: () => refreshMarket(qc),
  });
}

/* ------------------------------- offers -------------------------------- */

export function useRejectOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { offerId: number; reason?: string }) => rejectOffer(v.offerId, v.reason),
    onSuccess: () => refreshMarket(qc),
  });
}

export function useCounterOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { offerId: number; price: number }) => counterOffer(v.offerId, v.price),
    onSuccess: () => refreshMarket(qc),
  });
}

export function useWithdrawOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (offerId: number) => withdrawOffer(offerId),
    onSuccess: () => refreshMarket(qc),
  });
}

/* --------------------------- orders & payments --------------------------- */

export function useOrderEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { transactionId: number; status: OrderStep; note?: string }) =>
      addOrderEvent(v.transactionId, v.status, v.note),
    onSuccess: () => refreshMarket(qc),
  });
}

export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      transactionId: number;
      amount: number;
      method: OrderPayment["method"];
      reference?: string;
    }) =>
      recordPayment(v.transactionId, {
        amount: v.amount,
        method: v.method,
        ...(v.reference ? { reference: v.reference } : {}),
      }),
    onSuccess: () => refreshMarket(qc),
  });
}

export function useConfirmPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: number) => confirmPayment(paymentId),
    onSuccess: () => refreshMarket(qc),
  });
}

export function usePaymentNotReceived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { paymentId: number; reason?: string }) =>
      paymentNotReceived(v.paymentId, v.reason),
    onSuccess: () => refreshMarket(qc),
  });
}

/* ---------------------------- prices & storage --------------------------- */

export function useForecast(crop: string | undefined, state?: string, horizon = 14) {
  return useQuery({
    queryKey: ["forecast", crop, state, horizon],
    queryFn: () => getForecast(crop!, state, horizon),
    enabled: Boolean(crop),
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

export function useStorageOptions() {
  return useQuery({
    queryKey: ["storage-options"],
    queryFn: getStorageOptions,
    enabled: Boolean(getSession()),
    staleTime: 10 * 60_000,
  });
}

/* ------------------------------- suppliers ------------------------------- */

export function useSuppliers(filters: { crop?: string; location?: string; q?: string }) {
  return useQuery({
    queryKey: ["suppliers", filters],
    queryFn: () => getSuppliers(filters),
    enabled: getSession()?.role === "buyer",
    staleTime: 30_000,
  });
}

export function useSupplier(kind: string | undefined, id: number | undefined) {
  return useQuery({
    queryKey: ["supplier", kind, id],
    queryFn: () => getSupplier(kind!, id!),
    enabled: Boolean(kind) && typeof id === "number" && id > 0,
    staleTime: 30_000,
  });
}

/* ----------------------------- requirements ------------------------------ */

export function useUpdateDemand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { demandId: number; body: Partial<CreateBuyerDemandRequest> }) =>
      updateBuyerDemand(v.demandId, v.body),
    onSuccess: () => refreshMarket(qc),
  });
}

export function useFulfilDemand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (demandId: number) => fulfilBuyerDemand(demandId),
    onSuccess: () => refreshMarket(qc),
  });
}

export function useDemandMatches(demandId: number | undefined) {
  return useQuery({
    queryKey: ["demand-matches", demandId],
    queryFn: () => getDemandMatches(demandId!),
    enabled: typeof demandId === "number" && demandId > 0,
    staleTime: 30_000,
  });
}

/* -------------------------------- messages ------------------------------- */

const POLL_MS = 10_000;

export function useConversations() {
  return useQuery({
    queryKey: ["conversations"],
    queryFn: getConversations,
    enabled: Boolean(getSession()),
    refetchInterval: POLL_MS,
    staleTime: 5_000,
  });
}

export function useConversation(userId: number | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["conversation", userId],
    queryFn: async () => {
      const thread = await getConversation(userId!);
      // Opening a thread marks it read on the server; refresh the counts.
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["notifications-feed"] });
      return thread;
    },
    enabled: typeof userId === "number" && userId > 0,
    refetchInterval: POLL_MS,
    staleTime: 5_000,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: number; body: string; lot_id?: number; transaction_id?: number }) =>
      sendMessage(v.userId, {
        body: v.body,
        ...(v.lot_id ? { lot_id: v.lot_id } : {}),
        ...(v.transaction_id ? { transaction_id: v.transaction_id } : {}),
      }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["conversation", v.userId] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

/* -------------------------------- profile -------------------------------- */

export function useMyProfile() {
  return useQuery({
    queryKey: ["my-profile", getSession()?.userId],
    queryFn: getMyProfile,
    enabled: Boolean(getSession()),
    staleTime: 60_000,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name?: string;
      location?: string;
      urgency_level?: UrgencyLevel;
      preferred_language?: string;
    }) => updateMyProfile(body),
    onSuccess: (data) => {
      qc.setQueryData(["my-profile", getSession()?.userId], data);
      void qc.invalidateQueries({ queryKey: ["lot-signals"] });
    },
  });
}

/* ----------------------------- notifications ----------------------------- */

export function useNotificationsFeed() {
  return useQuery<BackendNotification[]>({
    queryKey: ["notifications-feed", getSession()?.userId],
    queryFn: getNotificationsFeed,
    enabled: isTrader() || getSession()?.role === "fpo",
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => markNotificationRead(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications-feed"] }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications-feed"] }),
  });
}

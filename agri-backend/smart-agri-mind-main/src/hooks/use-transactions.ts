/**
 * useTransactions — the signed-in user's orders, and one order's detail
 * (tracking events, payments and net realisation).
 */

import { useQuery } from "@tanstack/react-query";
import {
  getOrderDetail,
  getTransactions,
  type BackendTransaction,
  type OrderDetail,
} from "@/services/api-client";
import { getSession } from "@/services/session";

export type { BackendTransaction, OrderDetail };

export function useTransactions() {
  const session = getSession();
  return useQuery<BackendTransaction[]>({
    queryKey: ["transactions", session?.userId, session?.role],
    queryFn: getTransactions,
    enabled: session?.role === "farmer" || session?.role === "buyer",
    staleTime: 15_000,
  });
}

/** One order with its tracking, payments and net realisation. */
export function useOrderDetail(transactionId: number | undefined) {
  return useQuery<OrderDetail>({
    queryKey: ["transactions", "detail", transactionId],
    queryFn: () => getOrderDetail(transactionId!),
    enabled: typeof transactionId === "number" && transactionId > 0,
    staleTime: 10_000,
  });
}

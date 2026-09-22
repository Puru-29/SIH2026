/**
 * useTransactions — fetch a single transaction by id.
 *
 * GET /api/transactions/:id
 */

import { useQuery } from "@tanstack/react-query";
import { getTransaction, getTransactions, type BackendTransaction } from "@/services/api-client";
import { getSession } from "@/services/session";

export type { BackendTransaction };

export function useTransactions() {
  const session = getSession();
  return useQuery<BackendTransaction[]>({
    queryKey: ["transactions", session?.userId, session?.role],
    queryFn: getTransactions,
    enabled: Boolean(session),
    staleTime: 15_000,
  });
}

/**
 * Fetch a transaction record.
 * Only runs when `transactionId` is a positive integer.
 */
export function useTransaction(transactionId: number | undefined) {
  return useQuery<BackendTransaction>({
    queryKey: ["transactions", transactionId],
    queryFn: () => getTransaction(transactionId!),
    enabled: typeof transactionId === "number" && transactionId > 0,
    staleTime: 30_000,
  });
}

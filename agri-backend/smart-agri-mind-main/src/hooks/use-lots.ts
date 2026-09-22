/**
 * useLots — hooks for creating farmer lots and fetching matching buyers.
 *
 * POST /api/lots                       — create a new lot (farmer role)
 * GET  /api/lots/:id/matching-buyers   — demand records that match a lot
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createLot,
  getMatchingBuyers,
  getLots,
  type BackendLot,
  type BackendBuyerDemand,
  type CreateLotRequest,
} from "@/services/api-client";
import { getSession } from "@/services/session";

export type { BackendLot, BackendBuyerDemand, CreateLotRequest };

export function useLots() {
  const session = getSession();
  return useQuery<BackendLot[]>({
    queryKey: ["lots", session?.userId, session?.role],
    queryFn: getLots,
    enabled: Boolean(session),
    staleTime: 15_000,
  });
}

/** Create a new farmer lot. Requires X-User-Id with farmer/fpo role. */
export function useCreateLot() {
  return useMutation<BackendLot, Error, CreateLotRequest>({
    mutationFn: createLot,
  });
}

/**
 * Fetch buyer demand records that match a specific lot.
 * Only runs when `lotId` is provided and > 0.
 */
export function useMatchingBuyers(lotId: number | undefined) {
  return useQuery<BackendBuyerDemand[]>({
    queryKey: ["matching-buyers", lotId],
    queryFn: () => getMatchingBuyers(lotId!),
    enabled: typeof lotId === "number" && lotId > 0,
    staleTime: 60_000,
  });
}

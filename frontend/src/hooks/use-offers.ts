/**
 * useOffers — hooks for creating and accepting offers.
 *
 * POST /api/offers              — buyer submits a price offer on a lot
 * POST /api/offers/:id/accept   — farmer accepts an offer → creates transaction
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOffer,
  acceptOffer,
  type BackendOffer,
  type BackendTransaction,
  type CreateOfferRequest,
  getOffers,
} from "@/services/api-client";
import { getSession } from "@/services/session";
import { refreshMarket } from "@/hooks/use-market";

export type { BackendOffer, BackendTransaction, CreateOfferRequest };

export function useOffers() {
  const session = getSession();
  return useQuery<BackendOffer[]>({
    queryKey: ["offers", session?.userId, session?.role],
    queryFn: getOffers,
    // /api/offers serves farmers and buyers only; the global notification
    // provider mounts this for every role, so skip it for FPO/admin sessions.
    enabled: session?.role === "farmer" || session?.role === "buyer",
    staleTime: 15_000,
  });
}

/** A buyer bids on a lot, or a farmer offers a lot to a buyer. */
export function useCreateOffer() {
  const qc = useQueryClient();
  return useMutation<BackendOffer, Error, CreateOfferRequest>({
    mutationFn: createOffer,
    onSuccess: () => refreshMarket(qc),
  });
}

/** Accept the other side's pending offer; starts an order. */
export function useAcceptOffer() {
  const qc = useQueryClient();
  return useMutation<BackendTransaction, Error, number>({
    mutationFn: acceptOffer,
    onSuccess: () => refreshMarket(qc),
  });
}

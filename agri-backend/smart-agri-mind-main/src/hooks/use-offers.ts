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

export type { BackendOffer, BackendTransaction, CreateOfferRequest };

export function useOffers() {
  const session = getSession();
  return useQuery<BackendOffer[]>({
    queryKey: ["offers", session?.userId, session?.role],
    queryFn: getOffers,
    enabled: Boolean(session),
    staleTime: 15_000,
  });
}

/** Submit a new offer on a lot. Requires buyer role (X-User-Id). */
export function useCreateOffer() {
  const qc = useQueryClient();
  return useMutation<BackendOffer, Error, CreateOfferRequest>({
    mutationFn: createOffer,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["offers"] });
      void qc.invalidateQueries({ queryKey: ["lots"] });
    },
  });
}

/** Accept an outstanding offer by id. Requires farmer/fpo role. */
export function useAcceptOffer() {
  const qc = useQueryClient();
  return useMutation<BackendTransaction, Error, number>({
    mutationFn: acceptOffer,
    onSuccess: () => {
      // Invalidate transactions cache so the orders page refreshes
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      void qc.invalidateQueries({ queryKey: ["offers"] });
      void qc.invalidateQueries({ queryKey: ["lots"] });
    },
  });
}

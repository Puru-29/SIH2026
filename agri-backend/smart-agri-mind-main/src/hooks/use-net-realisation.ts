/**
 * useNetRealisation — mutation hook for the net-realisation calculator.
 *
 * POST /api/calculator/net-realisation
 * Returns a breakdown: sale price, transport, storage, handling, net total.
 */

import { useMutation } from "@tanstack/react-query";
import {
  calculateNetRealisation,
  type NetRealisationRequest,
  type NetRealisationResponse,
} from "@/services/api-client";

export type { NetRealisationRequest, NetRealisationResponse };

export function useNetRealisation() {
  return useMutation<NetRealisationResponse, Error, NetRealisationRequest>({
    mutationFn: calculateNetRealisation,
  });
}

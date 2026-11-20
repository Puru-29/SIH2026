/**
 * useSmartSale — mutation hook for the AI smart-sale advisor.
 *
 * POST /api/advisor/smart-sale
 * Returns SELL_NOW | WAIT | PARTIAL_SELL with reasoning and ratio.
 */

import { useMutation } from "@tanstack/react-query";
import {
  evaluateSmartSale,
  type SmartSaleRequest,
  type SmartSaleResponse,
} from "@/services/api-client";

export type { SmartSaleRequest, SmartSaleResponse };

export function useSmartSale() {
  return useMutation<SmartSaleResponse, Error, SmartSaleRequest>({
    mutationFn: evaluateSmartSale,
  });
}

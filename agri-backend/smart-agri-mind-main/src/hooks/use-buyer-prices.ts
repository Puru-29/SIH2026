import { useQuery } from "@tanstack/react-query";
import { getBuyerPrices, type BackendBuyerPrice } from "@/services/api-client";

export function useBuyerPrices() {
  return useQuery<BackendBuyerPrice[]>({
    queryKey: ["buyer-prices"],
    queryFn: getBuyerPrices,
    staleTime: 60_000,
  });
}

/** Fetches all live Mandi records for the selected state through our backend. */

import { useQuery } from "@tanstack/react-query";
import { getLiveMandiPrices, type BackendLiveMandiPrice } from "@/services/api-client";

export function useAllMarketPrices(state: string) {
  return useQuery<BackendLiveMandiPrice[]>({
    queryKey: ["live-market-prices", state],
    queryFn: () => getLiveMandiPrices({ state }),
    refetchInterval: 15 * 60_000,
    staleTime: 10 * 60_000,
  });
}

import { useQuery } from "@tanstack/react-query";
import { getCrops, type BackendCrop } from "@/services/api-client";

export function useCrops() {
  return useQuery<BackendCrop[]>({
    queryKey: ["crops"],
    queryFn: getCrops,
    staleTime: 5 * 60_000,
  });
}

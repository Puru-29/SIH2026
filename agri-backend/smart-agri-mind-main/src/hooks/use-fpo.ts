/**
 * React Query helpers for the FPO portal. Every key is prefixed with "fpo" so a
 * successful change refreshes all FPO screens (stock, offers, payments stay in sync).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getSession } from "@/services/session";
import { useI18n } from "@/lib/i18n";

export function useFpoQuery<T>(key: unknown[], fn: () => Promise<T>, enabled = true) {
  return useQuery<T>({
    queryKey: ["fpo", ...key],
    queryFn: fn,
    staleTime: 10_000,
    enabled: enabled && Boolean(getSession()),
  });
}

export function useFpoMutation<V, R>(
  fn: (vars: V) => Promise<R>,
  opts: { success?: string | ((result: R) => string); onSuccess?: (result: R) => void } = {},
) {
  const qc = useQueryClient();
  const { t } = useI18n();
  return useMutation<R, Error, V>({
    mutationFn: fn,
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ["fpo"] });
      if (opts.success) {
        toast.success(typeof opts.success === "function" ? opts.success(result) : t(opts.success));
      }
      opts.onSuccess?.(result);
    },
    onError: (error) => {
      toast.error(t("Could not complete this action"), { description: error.message });
    },
  });
}

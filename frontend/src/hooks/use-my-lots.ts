/**
 * useMyLots — the signed-in farmer's real lots from the backend, shaped as UI
 * `Lot`s (crop name, emoji, price per kg and a sell/hold/split hint).
 *
 * Price per kg comes from today's live Mandi modal price for the farm's state
 * when available, otherwise from a typical-price fallback.
 */

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLots } from "@/hooks/use-lots";
import { useCrops } from "@/hooks/use-crops";
import { useAllMarketPrices } from "@/hooks/use-market-prices";
import { useFarmLocation } from "@/lib/location-context";
import {
  ensureCrop,
  getMandiCommodities,
  type BackendCrop,
  type BackendLiveMandiPrice,
} from "@/services/api-client";
import {
  cropEmoji,
  FALLBACK_COMMODITIES,
  fallbackPricePerKg,
  normaliseCropName,
} from "@/lib/crop-catalog";
import type { Lot, LotStatus } from "@/lib/agri";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function livePricePerKg(crop: string, prices: BackendLiveMandiPrice[]): number | undefined {
  const key = normaliseCropName(crop);
  const matches = prices
    .filter((p) => normaliseCropName(p.crop_name) === key && p.price_per_kg > 0)
    .map((p) => p.price_per_kg);
  return matches.length ? Math.round(median(matches) * 10) / 10 : undefined;
}

/** Perishable crops → sell now; semi-perishable → split; durable → hold. */
function statusFromPerishability(days: number | undefined): LotStatus {
  if (days === undefined) return "HOLD";
  if (days <= 10) return "SELL NOW";
  if (days <= 60) return "SPLIT";
  return "HOLD";
}

export function useMyLots() {
  const { location } = useFarmLocation();
  const lotsQuery = useLots();
  const cropsQuery = useCrops();
  const pricesQuery = useAllMarketPrices(location.state);

  const lots = useMemo<Lot[]>(() => {
    const crops = new Map<number, BackendCrop>((cropsQuery.data ?? []).map((c) => [c.id, c]));
    const prices = pricesQuery.data ?? [];
    return (lotsQuery.data ?? []).map((l) => {
      const crop = crops.get(l.crop_id);
      const cropName = l.crop_name ?? crop?.name ?? `Crop #${l.crop_id}`;
      const perishability = l.perishability_days ?? crop?.perishability_days;
      const live = livePricePerKg(cropName, prices);
      const display = l.display_status ?? (l.status === "open" ? "open" : l.status);
      return {
        id: `LOT-${l.id}`,
        backendId: l.id,
        cropId: l.crop_id,
        crop: cropName,
        emoji: cropEmoji(cropName),
        grade: l.expected_quality,
        quantity: Math.round(l.quantity_quintals * 100),
        quantityQuintals: l.quantity_quintals,
        price: live ?? fallbackPricePerKg(cropName),
        priceSource: live !== undefined ? "live" : "estimate",
        storagePerKg: 0.5,
        harvest: "Registered",
        status: statusFromPerishability(perishability),
        stateLabel: STATE_LABEL[display] ?? "Open",
        confidence: live !== undefined ? 85 : 60,
        place: location,
        backendStatus: l.status,
        displayStatus: display as Lot["displayStatus"],
        pendingOffers: l.pending_offers ?? 0,
        bestOffer: l.best_offer ?? null,
        ...(perishability !== undefined && { perishabilityDays: perishability }),
        daysListed: l.days_listed ?? 0,
        cancelReason: l.cancel_reason ?? null,
      } satisfies Lot;
    });
  }, [lotsQuery.data, cropsQuery.data, pricesQuery.data, location]);

  return {
    lots,
    /** Lots still on the market (open, with or without offers). */
    openLots: lots.filter((l) => l.backendStatus === "open"),
    isLoading: lotsQuery.isLoading || cropsQuery.isLoading,
    error: lotsQuery.error ?? cropsQuery.error,
  };
}

const STATE_LABEL: Record<string, string> = {
  open: "Open",
  offer_received: "Offer received",
  sold: "Sold",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
};

/**
 * The lot to act on first: the open lot with the least shelf life left
 * (crop perishability minus days since listing), then the largest.
 */
export function pickHeroLot(lots: Lot[]): Lot | undefined {
  return rankOpenLots(lots)[0];
}

/** Open lots, most urgent first (same order as `pickHeroLot`). */
export function rankOpenLots(lots: Lot[]): Lot[] {
  const left = (l: Lot) => (l.perishabilityDays ?? 180) - (l.daysListed ?? 0);
  return lots
    .filter((l) => l.backendStatus === "open")
    .sort((a, b) => left(a) - left(b) || b.quantity - a.quantity);
}

/**
 * Every commodity the Mandi API supports (all states), merged with crops
 * already in our catalogue and a built-in fallback list.
 */
export function useCropOptions() {
  const cropsQuery = useCrops();
  const commoditiesQuery = useQuery<string[]>({
    queryKey: ["mandi-commodities", "all"],
    queryFn: () => getMandiCommodities(),
    staleTime: 6 * 60 * 60_000,
    retry: 1,
  });

  const options = useMemo(() => {
    const byKey = new Map<string, string>();
    const add = (name: string) => {
      const trimmed = name.trim();
      const key = normaliseCropName(trimmed) || trimmed.toLowerCase();
      if (trimmed && !byKey.has(key)) byKey.set(key, trimmed);
    };
    (cropsQuery.data ?? []).forEach((c) => add(c.name));
    (commoditiesQuery.data ?? []).forEach(add);
    FALLBACK_COMMODITIES.forEach(add);
    return [...byKey.values()].sort((a, b) => a.localeCompare(b));
  }, [cropsQuery.data, commoditiesQuery.data]);

  return {
    options,
    isLive: Boolean(commoditiesQuery.data?.length),
    isLoading: commoditiesQuery.isLoading,
  };
}

/** Find-or-create a crop by name and refresh the crop catalogue. */
export function useEnsureCrop() {
  const qc = useQueryClient();
  return useMutation<BackendCrop, Error, string>({
    mutationFn: ensureCrop,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["crops"] }),
  });
}

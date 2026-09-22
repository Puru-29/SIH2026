import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { PortalLayout } from "@/components/agri/portal-layout";
import { Metric, PageHeader, Panel, Pill } from "@/components/agri/ui-bits";
import { useFarmLocation } from "@/lib/location-context";
import { useI18n } from "@/lib/i18n";
import { inr } from "@/services";
import { cn } from "@/lib/utils";
import { useAllMarketPrices } from "@/hooks/use-market-prices";
import { useBuyerPrices } from "@/hooks/use-buyer-prices";

export const Route = createFileRoute("/markets")({
  head: () => ({
    meta: [
      { title: "Markets — AgriSense" },
      { name: "description", content: "Mandi prices, arrivals and freight-adjusted net realization near your farm." },
      { property: "og:title", content: "Markets — AgriSense" },
      { property: "og:description", content: "Compare mandis and buyers side by side from your farm gate." },
    ],
  }),
  component: Markets,
});

function Markets() {
  const { location } = useFarmLocation();
  const { t } = useI18n();
  const [priceSearch, setPriceSearch] = useState("");
  const [cropFilter, setCropFilter] = useState("all");
  const [pricePage, setPricePage] = useState(1);
  const [buyerSearch, setBuyerSearch] = useState("");
  const [buyerCropFilter, setBuyerCropFilter] = useState("all");
  const [buyerPage, setBuyerPage] = useState(1);
  const pricesPerPage = 9;
  const buyersPerPage = 6;

  // Fetch the catalogue first because the prices endpoint requires crop_id.
  const pricesQuery = useAllMarketPrices(location.state);
  const buyerPricesQuery = useBuyerPrices();
  const livePrices = pricesQuery.data ?? [];
  const buyerPrices = buyerPricesQuery.data ?? [];
  const availableBuyerCrops = useMemo(
    () => Array.from(new Set(buyerPrices.map((offer) => offer.crop_name))).sort(),
    [buyerPrices],
  );
  const filteredBuyerPrices = useMemo(() => {
    const query = buyerSearch.trim().toLowerCase();
    return buyerPrices.filter((offer) => {
      const matchesCrop = buyerCropFilter === "all" || offer.crop_name === buyerCropFilter;
      const searchable = [
        offer.buyer_name,
        offer.crop_name,
        offer.quality,
        offer.delivery_location,
        offer.required_by,
      ];
      return (
        matchesCrop &&
        (!query || searchable.some((value) => value.toLowerCase().includes(query)))
      );
    });
  }, [buyerPrices, buyerSearch, buyerCropFilter]);
  const totalBuyerPages = Math.max(1, Math.ceil(filteredBuyerPrices.length / buyersPerPage));
  const visibleBuyerPrices = filteredBuyerPrices.slice(
    (buyerPage - 1) * buyersPerPage,
    buyerPage * buyersPerPage,
  );
  const { isLoading, isError, refetch } = pricesQuery;
  const availableCrops = useMemo(
    () => Array.from(new Set(livePrices.map((price) => price.crop_name))).sort(),
    [livePrices],
  );
  const filteredLivePrices = useMemo(() => {
    const query = priceSearch.trim().toLowerCase();

    return livePrices.filter((price) =>
      (cropFilter === "all" || price.crop_name === cropFilter) &&
      [
        price.crop_name,
        price.market,
        price.state,
        price.district,
        price.variety,
        price.grade,
        price.date,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [livePrices, priceSearch, cropFilter]);
  const totalPricePages = Math.max(1, Math.ceil(filteredLivePrices.length / pricesPerPage));
  const visibleLivePrices = filteredLivePrices.slice(
    (pricePage - 1) * pricesPerPage,
    pricePage * pricesPerPage,
  );

  useEffect(() => {
    setPricePage(1);
  }, [priceSearch, cropFilter, location.state]);

  useEffect(() => {
    if (pricePage > totalPricePages) setPricePage(totalPricePages);
  }, [pricePage, totalPricePages]);

  useEffect(() => {
    setBuyerPage(1);
  }, [buyerSearch, buyerCropFilter]);

  useEffect(() => {
    if (buyerPage > totalBuyerPages) setBuyerPage(totalBuyerPages);
  }, [buyerPage, totalBuyerPages]);

  const priceValues = livePrices.map((p) => p.price_per_kg);
  const maxPrice = priceValues.length ? Math.max(...priceValues) : 0;
  const avgPrice = priceValues.length
    ? Math.round((priceValues.reduce((s, p) => s + p, 0) / priceValues.length) * 10) / 10
    : 0;
  const uniqueMarkets = new Set(livePrices.map((price) => `${price.state}:${price.market}`));
  const best = livePrices.find((price) => price.price_per_kg === maxPrice);

  return (
    <PortalLayout>
      <PageHeader
        eyebrow="Market intelligence"
        title="Markets near you"
        description={`${t("Live mandi prices for all available crops and markets in")} ${location.state}.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Markets tracked" value={uniqueMarkets.size} hint={location.state} />
        <Metric label="Average price" value={`${inr(avgPrice)}/kg`} hint={t("Across tracked mandis")} />
        <Metric label="Highest price" value={`${inr(maxPrice)}/kg`} hint={best?.crop_name ?? "—"} />
      </div>

      {/* Live price feed from backend */}
      <Panel>
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl">{t("Live Mandi Prices")}</h2>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary"
            title="Refresh prices"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            {isLoading ? t("Refreshing…") : t("Refresh")}
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative block sm:max-w-sm sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={priceSearch}
              onChange={(event) => setPriceSearch(event.target.value)}
              placeholder={t("Search crop, market or district")}
              aria-label={t("Search crop, market or district")}
              className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-4 text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="block sm:w-52">
            <span className="sr-only">{t("Filter by crop")}</span>
            <select
              value={cropFilter}
              onChange={(event) => setCropFilter(event.target.value)}
              aria-label={t("Filter by crop")}
              className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
            >
              <option value="all">{t("All crops")}</option>
              {availableCrops.map((crop) => (
                <option key={crop} value={crop}>
                  {crop}
                </option>
              ))}
            </select>
          </label>
          {!isLoading ? (
            <p className="text-xs text-muted-foreground sm:ml-auto">
              {filteredLivePrices.length} {t("prices found")}
            </p>
          ) : null}
        </div>

        {isError && (
          <p className="mt-3 text-xs text-amber-500">
            ⚠ {t("Could not reach the backend — showing cached prices.")}
          </p>
        )}

        {isLoading ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-secondary" />
            ))}
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleLivePrices.map((price) => (
              <div
                key={price.id}
                className="rounded-xl border border-border bg-background p-4"
              >
                <p className="text-xs text-muted-foreground">
                  {price.crop_name} · {price.market}
                </p>
                <p className="mt-1 font-serif text-2xl">{inr(price.price_per_kg)}/kg</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {inr(price.modal_price)}/quintal · {price.date}
                </p>
              </div>
            ))}
            </div>
            {filteredLivePrices.length === 0 ? (
              <p className="mt-6 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {t("No live prices match your search.")}
              </p>
            ) : null}
            {filteredLivePrices.length > pricesPerPage ? (
              <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                <p className="text-xs text-muted-foreground">
                  {t("Page")} {pricePage} {t("of")} {totalPricePages}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPricePage((page) => Math.max(1, page - 1))}
                    disabled={pricePage === 1}
                    className="rounded-full border border-border p-2 text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={t("Previous page")}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPricePage((page) => Math.min(totalPricePages, page + 1))}
                    disabled={pricePage === totalPricePages}
                    className="rounded-full border border-border p-2 text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={t("Next page")}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Panel>

      <Panel className="p-0">
        <div className="flex items-center justify-between border-b border-border p-6">
          <div>
            <h2 className="font-serif text-2xl">{t("Buyer prices")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("Current buyer offers from the network")}
            </p>
          </div>
          {buyerPricesQuery.isLoading ? <Pill tone="muted">{t("Loading")}</Pill> : null}
        </div>
        <div className="flex flex-col gap-3 border-b border-border p-6 sm:flex-row sm:items-center">
          <label className="relative block sm:max-w-sm sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={buyerSearch}
              onChange={(event) => setBuyerSearch(event.target.value)}
              placeholder={t("Search buyer, crop or delivery location")}
              aria-label={t("Search buyer, crop or delivery location")}
              className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-4 text-sm outline-none focus:border-primary"
            />
          </label>
          <select
            value={buyerCropFilter}
            onChange={(event) => setBuyerCropFilter(event.target.value)}
            aria-label={t("Filter buyer offers by crop")}
            className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary sm:w-52"
          >
            <option value="all">{t("All crops")}</option>
            {availableBuyerCrops.map((crop) => (
              <option key={crop} value={crop}>
                {crop}
              </option>
            ))}
          </select>
          {!buyerPricesQuery.isLoading ? (
            <p className="text-xs text-muted-foreground sm:ml-auto">
              {filteredBuyerPrices.length} {t("offers found")}
            </p>
          ) : null}
        </div>
        {buyerPricesQuery.isError ? (
          <p className="p-6 text-sm text-amber-500">
            {t("Could not load buyer prices from the backend.")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  {["Buyer", "Crop", "Offer/kg", "Minimum quantity", "Quality", "Delivery", "Required by"].map(
                    (heading) => (
                      <th key={heading} className="px-6 py-3 font-medium">
                        {t(heading)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {visibleBuyerPrices.map((offer) => (
                  <tr key={offer.id} className="border-b border-border/60">
                    <td className="px-6 py-4 font-medium">{offer.buyer_name}</td>
                    <td className="px-6 py-4">{offer.crop_name}</td>
                    <td className="px-6 py-4 font-serif text-lg">{inr(offer.price_per_kg)}</td>
                    <td className="px-6 py-4">{offer.min_quantity_quintals} q</td>
                    <td className="px-6 py-4">{offer.quality}</td>
                    <td className="px-6 py-4">{offer.delivery_location}</td>
                    <td className="px-6 py-4 text-muted-foreground">{offer.required_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredBuyerPrices.length > 0 && filteredBuyerPrices.length > buyersPerPage ? (
              <div className="flex items-center justify-between border-t border-border p-4">
                <p className="text-xs text-muted-foreground">
                  {t("Page")} {buyerPage} {t("of")} {totalBuyerPages}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setBuyerPage((page) => Math.max(1, page - 1))}
                    disabled={buyerPage === 1}
                    className="rounded-full border border-border p-2 text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={t("Previous buyer offers page")}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setBuyerPage((page) => Math.min(totalBuyerPages, page + 1))}
                    disabled={buyerPage === totalBuyerPages}
                    className="rounded-full border border-border p-2 text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={t("Next buyer offers page")}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}
            {!buyerPricesQuery.isLoading && buyerPrices.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {t("No buyer prices available.")}
              </p>
            ) : null}
            {!buyerPricesQuery.isLoading && filteredBuyerPrices.length === 0 && buyerPrices.length > 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {t("No buyer offers match your filters.")}
              </p>
            ) : null}
          </div>
        )}
      </Panel>
    </PortalLayout>
  );
}

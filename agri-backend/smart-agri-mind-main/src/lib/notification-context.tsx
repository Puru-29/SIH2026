import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { getNotifications, type AppNotification } from "@/services";
import { useOffers } from "@/hooks/use-offers";
import { getSession } from "@/services/session";

type Ctx = {
  items: AppNotification[];
  unread: number;
  markAllRead: () => void;
  markRead: (id: string) => void;
};

const NotificationContext = createContext<Ctx>({
  items: [],
  unread: 0,
  markAllRead: () => {},
  markRead: () => {},
});

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<AppNotification[]>(() =>
    getNotifications().map((n) => ({ ...n })),
  );
  const session = getSession();
  const { data: offers = [] } = useOffers();
  const farmerOfferNotifications = session?.role === "farmer"
    ? offers.map((offer): AppNotification => ({
        id: `offer-${offer.id}`,
        category: "bids",
        title: `New buyer offer for lot #${offer.lot_id}`,
        body: `Buyer #${offer.buyer_id} offered ₹${(offer.price_offered / 100).toFixed(2)}/kg. Review it under Buyers.`,
        time: "Just now",
        read: offer.status !== "pending",
        link: { to: "/buyers", label: "Review buyer offer" },
      }))
    : [];
  const allItems = [
    ...farmerOfferNotifications,
    ...items.filter((item) => !farmerOfferNotifications.some((offer) => offer.id === item.id)),
  ];

  const value = useMemo<Ctx>(
    () => ({
      items: allItems,
      unread: allItems.filter((n) => !n.read).length,
      markAllRead: () => setItems((prev) => prev.map((n) => ({ ...n, read: true }))),
      markRead: (id: string) =>
        setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n))),
    }),
    [allItems],
  );

  return (
    <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationContext);

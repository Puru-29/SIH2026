import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsFeed,
} from "@/hooks/use-market";
import type { NotificationType } from "@/services/api-client";

/** Tabs on the notifications page. */
export type FeedCategory = "bids" | "orders" | "payments" | "messages" | "updates";

export type FeedItem = {
  id: number;
  type: NotificationType;
  category: FeedCategory;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  /** Path (and optional query) to open, e.g. "/crops?lot=5". */
  link: string;
  linkLabel: string;
};

const CATEGORY: Record<NotificationType, FeedCategory> = {
  offer: "bids",
  counter: "bids",
  accepted: "bids",
  rejected: "bids",
  matching_lot: "bids",
  order: "orders",
  payment: "payments",
  message: "messages",
  dispute: "updates",
  admin: "updates",
  general: "updates",
};

const LINK_LABEL: Record<FeedCategory, string> = {
  bids: "Open offer",
  orders: "Open order",
  payments: "Open payments",
  messages: "Open chat",
  updates: "View",
};

type Ctx = {
  items: FeedItem[];
  unread: number;
  isLoading: boolean;
  error: Error | null;
  markAllRead: () => void;
  markRead: (id: number) => void;
};

const NotificationContext = createContext<Ctx>({
  items: [],
  unread: 0,
  isLoading: false,
  error: null,
  markAllRead: () => {},
  markRead: () => {},
});

export function NotificationProvider({ children }: { children: ReactNode }) {
  const feed = useNotificationsFeed();
  const markOne = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const value = useMemo<Ctx>(() => {
    const items: FeedItem[] = (feed.data ?? []).map((n) => {
      const category = CATEGORY[n.type] ?? "updates";
      return {
        id: n.id,
        type: n.type,
        category,
        title: n.title,
        body: n.body,
        createdAt: n.created_at,
        read: n.read,
        link: n.link || "/notifications",
        linkLabel: LINK_LABEL[category],
      };
    });
    return {
      items,
      unread: items.filter((n) => !n.read).length,
      isLoading: feed.isLoading,
      error: feed.error,
      markAllRead: () => markAll.mutate(),
      markRead: (id: number) => markOne.mutate(id),
    };
  }, [feed.data, feed.isLoading, feed.error, markAll, markOne]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export const useNotifications = () => useContext(NotificationContext);

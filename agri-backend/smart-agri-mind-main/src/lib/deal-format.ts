/**
 * Formatting and labels shared by the farmer and buyer portals.
 * Prices on the API are ₹ per quintal; the portals show ₹ per kg next to them.
 */

export const inrQ = (perQuintal: number) => `₹${Math.round(perQuintal).toLocaleString("en-IN")}/q`;

export const inrKg = (perQuintal: number) =>
  `₹${(perQuintal / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}/kg`;

export const inrAmount = (n: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

export const qtl = (q: number) =>
  `${q.toLocaleString("en-IN", { maximumFractionDigits: 2 })} q (${Math.round(q * 100).toLocaleString("en-IN")} kg)`;

export const ORDER_LABEL: Record<string, string> = {
  accepted: "Accepted",
  picked_up: "Picked up",
  in_transit: "In transit",
  delivered: "Delivered",
};

export const PAYMENT_LABEL: Record<string, string> = {
  pending: "Payment pending",
  awaiting_confirmation: "Paid, awaiting confirmation",
  partially_paid: "Partly paid",
  paid: "Paid",
};

/** "5 min ago", "3 h ago", "2 days ago" from a UTC "YYYY-MM-DD HH:MM:SS" timestamp. */
export function timeAgo(utc: string): string {
  const ts = Date.parse(utc.includes("T") ? utc : `${utc.replace(" ", "T")}Z`);
  if (Number.isNaN(ts)) return utc;
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** Splits "/crops?lot=5" into a router path and search object. */
export function splitLink(link: string): { to: string; search: Record<string, string> } {
  const [to, query = ""] = link.split("?");
  return { to: to || "/", search: Object.fromEntries(new URLSearchParams(query)) };
}

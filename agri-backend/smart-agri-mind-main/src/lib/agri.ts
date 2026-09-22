export type Coords = { lat: number; lng: number };

export type Place = Coords & {
  id: string;
  name: string;
  district: string;
  state: string;
  belt: string;
};

export const LOCATIONS: Place[] = [
  { id: "dindori", name: "Dindori", district: "Nashik", state: "Maharashtra", belt: "Nashik grape & tomato belt", lat: 20.2, lng: 73.83 },
  { id: "lasalgaon", name: "Lasalgaon", district: "Nashik", state: "Maharashtra", belt: "Onion belt", lat: 20.14, lng: 74.24 },
  { id: "junnar", name: "Junnar", district: "Pune", state: "Maharashtra", belt: "Western Ghats vegetable belt", lat: 19.2, lng: 73.88 },
  { id: "latur", name: "Latur", district: "Latur", state: "Maharashtra", belt: "Marathwada pulses belt", lat: 18.4, lng: 76.56 },
  { id: "sangola", name: "Sangola", district: "Solapur", state: "Maharashtra", belt: "Pomegranate belt", lat: 17.44, lng: 75.19 },
  { id: "kolar", name: "Kolar", district: "Kolar", state: "Karnataka", belt: "South tomato belt", lat: 13.14, lng: 78.13 },
  { id: "guntur", name: "Guntur", district: "Guntur", state: "Andhra Pradesh", belt: "Chilli belt", lat: 16.31, lng: 80.44 },
];

export const DEFAULT_LOCATION = LOCATIONS[0]!;

export function haversine(a: Coords, b: Coords) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Road distance approximation from a straight-line distance. */
export function roadKm(from: Coords, to: Coords) {
  return Math.max(2, Math.round(haversine(from, to) * 1.25));
}

/** Transport cost per kg (₹) for a given road distance. */
export function transportPerKg(km: number) {
  return Math.round((0.9 + 0.043 * km) * 10) / 10;
}

export const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: n < 100 ? 1 : 0 });

export const kg = (n: number) => n.toLocaleString("en-IN") + " kg";

export type LotStatus = "SELL NOW" | "HOLD" | "SPLIT";

export type Lot = {
  id: string;
  crop: string;
  emoji: string;
  grade: string;
  quantity: number;
  price: number;
  storagePerKg: number;
  harvest: string;
  status: LotStatus;
  stateLabel: string;
  confidence: number;
  place: Place;
};

const place = (id: string) => LOCATIONS.find((l) => l.id === id)!;

export const LOTS: Lot[] = [
  { id: "LOT-2411", crop: "Tomato", emoji: "🍅", grade: "Grade A", quantity: 5000, price: 30, storagePerKg: 0, harvest: "12 Sep 2026", status: "SELL NOW", stateLabel: "Active", confidence: 88, place: place("dindori") },
  { id: "LOT-2408", crop: "Onion", emoji: "🧅", grade: "Grade B", quantity: 12000, price: 18, storagePerKg: 0.6, harvest: "02 Sep 2026", status: "HOLD", stateLabel: "In storage", confidence: 74, place: place("lasalgaon") },
  { id: "LOT-2402", crop: "Soybean", emoji: "🌱", grade: "Grade A", quantity: 8000, price: 46, storagePerKg: 0.4, harvest: "28 Aug 2026", status: "SPLIT", stateLabel: "Under offer", confidence: 81, place: place("latur") },
  { id: "LOT-2396", crop: "Pomegranate", emoji: "🍎", grade: "Export Grade", quantity: 3200, price: 92, storagePerKg: 1.2, harvest: "20 Aug 2026", status: "SELL NOW", stateLabel: "Sold", confidence: 93, place: place("sangola") },
];

export type Market = {
  id: string;
  name: string;
  price: number;
  arrivals: string;
  trend: number;
  demand: "High" | "Medium" | "Low";
  lat: number;
  lng: number;
};

export const MARKETS: Market[] = [
  { id: "nashik", name: "Nashik APMC", price: 28, arrivals: "420 t", trend: 3.2, demand: "Medium", lat: 20.0, lng: 73.79 },
  { id: "vashi", name: "Mumbai Vashi APMC", price: 34, arrivals: "890 t", trend: 6.1, demand: "High", lat: 19.08, lng: 73.0 },
  { id: "pune", name: "Pune Market Yard", price: 31, arrivals: "530 t", trend: 4.8, demand: "High", lat: 18.49, lng: 73.86 },
  { id: "lasalgaon-m", name: "Lasalgaon APMC", price: 27, arrivals: "310 t", trend: 1.4, demand: "High", lat: 20.14, lng: 74.24 },
  { id: "aurangabad", name: "Aurangabad APMC", price: 29, arrivals: "212 t", trend: 0.8, demand: "Medium", lat: 19.88, lng: 75.34 },
  { id: "ahmednagar", name: "Ahmednagar APMC", price: 26, arrivals: "220 t", trend: -2.3, demand: "Low", lat: 19.09, lng: 74.75 },
];

export type Buyer = {
  id: string;
  name: string;
  type: string;
  city: string;
  offer: number;
  demandKg: number;
  terms: string;
  reliability: number;
  verified: boolean;
  lat: number;
  lng: number;
};

export const BUYERS: Buyer[] = [
  { id: "A", name: "Buyer A — Sahyadri Foods", type: "Food processor", city: "Nashik, Maharashtra", offer: 30, demandKg: 6000, terms: "50% advance · balance in 3 days", reliability: 96, verified: true, lat: 20.01, lng: 73.9 },
  { id: "D", name: "Buyer D — Annapurna Retail", type: "Retail chain", city: "Nashik, Maharashtra", offer: 29, demandKg: 2500, terms: "Net 7 days", reliability: 93, verified: true, lat: 19.98, lng: 73.72 },
  { id: "C", name: "Buyer C — GreenLeaf Exports", type: "Exporter", city: "Pune, Maharashtra", offer: 35, demandKg: 4000, terms: "Net 15 days", reliability: 84, verified: true, lat: 18.52, lng: 73.85 },
  { id: "B", name: "Buyer B — Mumbai Fresh Co.", type: "Wholesale distributor", city: "Vashi, Navi Mumbai", offer: 32, demandKg: 10000, terms: "Payment on delivery", reliability: 88, verified: true, lat: 19.07, lng: 73.0 },
];

export type Row = {
  key: string;
  name: string;
  sub: string;
  price: number;
  transport: number;
  storage: number;
  demand: string;
  reliability: number;
  net: number;
  km: number;
};

export function buildComparison(from: Coords): Row[] {
  const buyerRows = BUYERS.map((b) => {
    const km = roadKm(from, b);
    const transport = transportPerKg(km);
    return {
      key: b.id,
      name: b.name,
      sub: `Buyer · ${km} km`,
      price: b.offer,
      transport,
      storage: 0,
      demand: b.demandKg > 5000 ? "High" : "Medium",
      reliability: b.reliability,
      net: Math.round((b.offer - transport) * 10) / 10,
      km,
    };
  });
  const marketRows = MARKETS.slice(0, 3).map((m) => {
    const km = roadKm(from, m);
    const transport = transportPerKg(km);
    const storage = 0.5;
    return {
      key: m.id,
      name: m.name,
      sub: `Mandi · ${km} km`,
      price: m.price,
      transport,
      storage,
      demand: m.demand,
      reliability: 82,
      net: Math.round((m.price - transport - storage) * 10) / 10,
      km,
    };
  });
  return [...buyerRows, ...marketRows].sort((a, b) => b.net - a.net);
}

export const FORECAST = [
  { date: "01 Aug", actual: 22.4 },
  { date: "08 Aug", actual: 24.1 },
  { date: "15 Aug", actual: 21.2 },
  { date: "22 Aug", actual: 25.6 },
  { date: "29 Aug", actual: 27.1 },
  { date: "05 Sep", actual: 28.8 },
  { date: "12 Sep", actual: 30, forecast: 30, low: 30, high: 30 },
  { date: "19 Sep", forecast: 30.8, low: 28.9, high: 32.9 },
  { date: "26 Sep", forecast: 31.5, low: 28.1, high: 34.4 },
  { date: "03 Oct", forecast: 30.4, low: 26.2, high: 34.6 },
  { date: "10 Oct", forecast: 28.9, low: 24.1, high: 34.2 },
];

export const SIGNALS = [
  { icon: "price", title: "Price analysis", head: "₹30/kg peak offer", sub: "8% above 30-day average", score: 88 },
  { icon: "demand", title: "Demand analysis", head: "High demand", sub: "4 active buyers within 60 km", score: 92 },
  { icon: "buyer", title: "Buyer matching", head: "Grade A match", sub: "Sahyadri needs 6,000 kg this week", score: 90 },
  { icon: "transport", title: "Transport analysis", head: "Shared tempo available", sub: "Open tempo · 6 t capacity", score: 85 },
  { icon: "storage", title: "Storage analysis", head: "Not viable", sub: "Tomato spoilage risk 6% per week", score: 34 },
  { icon: "reliability", title: "Reliability analysis", head: "96 / 100", sub: "142 on-time payments", score: 96 },
];

export const DRIVERS = [
  { name: "Arrivals pressure", sub: "Nashik arrivals down 12% week on week", score: 78 },
  { name: "Festival demand", sub: "Navratri buying lifts urban demand from 22 Sep", score: 84 },
  { name: "Weather risk", sub: "Light rain forecast may affect Grade A share", score: 46 },
  { name: "Export enquiries", sub: "Two exporters active in Pune this month", score: 61 },
];

export const ORDERS = [
  { id: "ORD-8841", crop: "Tomato", qty: 5000, buyer: "Buyer A — Sahyadri Foods", value: 150000, status: "In transit", date: "14 Sep 2026" },
  { id: "ORD-8830", crop: "Pomegranate", qty: 3200, buyer: "Buyer C — GreenLeaf Exports", value: 294400, status: "Completed", date: "22 Aug 2026" },
  { id: "ORD-8812", crop: "Soybean", qty: 4000, buyer: "AgroPure Processing", value: 184000, status: "Awaiting pickup", date: "16 Sep 2026" },
];

export const ORDER_TIMELINE = [
  { label: "Offer accepted", time: "12 Sep · 15:02", done: true },
  { label: "Order confirmed", time: "12 Sep · 15:20", done: true },
  { label: "Pickup scheduled", time: "13 Sep · 08:00", done: true },
  { label: "In transit", time: "14 Sep · 10:30", done: true, now: true },
  { label: "Delivered", time: "Expected 14 Sep · 13:00", done: false },
  { label: "Payment released", time: "Expected 15 Sep", done: false },
  { label: "Completed", time: "—", done: false },
];

export const TRACKING_EVENTS = [
  { time: "08:30", text: "Loading completed at farm gate" },
  { time: "08:52", text: "Vehicle departed pickup point" },
  { time: "10:05", text: "Crossed Ozar checkpost" },
  { time: "10:30", text: "On schedule" },
  { time: "13:00", text: "Expected arrival at Nashik MIDC" },
];

export const PAYMENTS = [
  { id: "PAY-5521", order: "ORD-8841", value: 150000, paid: 75000, status: "Partially paid", ref: "UTR 4429183021", date: "12 Sep 2026" },
  { id: "PAY-5510", order: "ORD-8830", value: 294400, paid: 294400, status: "Paid", ref: "UTR 4419021884", date: "24 Aug 2026" },
  { id: "PAY-5498", order: "ORD-8812", value: 184000, paid: 0, status: "Pending", ref: "—", date: "—" },
];

export const NOTIFICATIONS = [
  { title: "Buyer A raised offer to ₹30/kg", time: "14 minutes ago" },
  { title: "Nashik APMC arrivals down 12%", time: "2 hours ago" },
  { title: "Pickup scheduled for LOT-2411", time: "Yesterday" },
];

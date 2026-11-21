/** States offered at sign-up. Keep in sync with `STATES` in backend/src/admin.rs. */
export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Delhi",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Tamil Nadu",
  "Telangana",
  "Uttar Pradesh",
  "West Bengal",
] as const;

/** Approximate centre of each state, for distance estimates when only the state is known. */
export const STATE_CENTRES: Record<(typeof INDIAN_STATES)[number], { lat: number; lng: number }> = {
  "Andhra Pradesh": { lat: 15.91, lng: 79.74 },
  Assam: { lat: 26.2, lng: 92.94 },
  Bihar: { lat: 25.6, lng: 85.14 },
  Chhattisgarh: { lat: 21.28, lng: 81.87 },
  Delhi: { lat: 28.7, lng: 77.1 },
  Gujarat: { lat: 22.26, lng: 71.19 },
  Haryana: { lat: 29.06, lng: 76.09 },
  "Himachal Pradesh": { lat: 31.1, lng: 77.17 },
  Jharkhand: { lat: 23.61, lng: 85.28 },
  Karnataka: { lat: 15.32, lng: 75.71 },
  Kerala: { lat: 10.85, lng: 76.27 },
  "Madhya Pradesh": { lat: 22.97, lng: 78.66 },
  Maharashtra: { lat: 19.75, lng: 75.71 },
  Odisha: { lat: 20.95, lng: 85.1 },
  Punjab: { lat: 31.15, lng: 75.34 },
  Rajasthan: { lat: 27.02, lng: 74.22 },
  "Tamil Nadu": { lat: 11.13, lng: 78.66 },
  Telangana: { lat: 18.11, lng: 79.02 },
  "Uttar Pradesh": { lat: 26.85, lng: 80.95 },
  "West Bengal": { lat: 22.99, lng: 87.85 },
};

export const isIndianState = (s: string | null | undefined): s is (typeof INDIAN_STATES)[number] =>
  INDIAN_STATES.includes(s as (typeof INDIAN_STATES)[number]);

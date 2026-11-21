import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCATION, LOCATIONS, type Place } from "./agri";
import { statePlace } from "./places";
import { useRouterState } from "@tanstack/react-router";
import { useMyProfile } from "@/hooks/use-market";

type Ctx = {
  /** The place prices, freight and advice use right now. */
  location: Place;
  /** The signed-in user's own saved place (from their profile), if known. */
  home: Place | null;
  /** Pick a sample place (public pages) — signed-in users use viewState instead. */
  setLocation: (p: Place) => void;
  /** Signed-in users: look at another state's prices for a while (null = back to home). */
  viewState: (state: string | null) => void;
};

const LocationContext = createContext<Ctx>({
  location: DEFAULT_LOCATION,
  home: null,
  setLocation: () => {},
  viewState: () => {},
});

const SAMPLE_KEY = "agrisense-location";
const VIEW_KEY = "agrisense-view-state";

function readStorage(store: "local" | "session", key: string): string | null {
  try {
    return (store === "local" ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(store: "local" | "session", key: string, value: string | null) {
  try {
    const s = store === "local" ? localStorage : sessionStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

/** Builds a place from the profile's stored "District, State" location. */
function profilePlace(location: string | null, state: string | null): Place | null {
  if (!state) return null;
  const first = (location ?? "").split(",")[0]?.trim() ?? "";
  const district = first && first.toLowerCase() !== state.toLowerCase() ? first : "";
  return {
    ...statePlace(state),
    id: "home",
    name: district || state,
    district,
  };
}

export function LocationProvider({ children }: { children: ReactNode }) {
  // Re-render on navigation so signing in or out (which always navigates)
  // switches to the new user's profile.
  useRouterState({ select: (s) => s.location.pathname });
  const profile = useMyProfile();
  const [sample, setSample] = useState<Place>(DEFAULT_LOCATION);
  const [view, setView] = useState<string | null>(null);

  useEffect(() => {
    const match = LOCATIONS.find((l) => l.id === readStorage("local", SAMPLE_KEY));
    if (match) setSample(match);
    setView(readStorage("session", VIEW_KEY));
  }, []);

  const home = useMemo(
    () => profilePlace(profile.data?.location ?? null, profile.data?.state ?? null),
    [profile.data?.location, profile.data?.state],
  );

  const value = useMemo<Ctx>(() => {
    // Signed in: the saved place, unless the user chose to look at another state.
    // Signed out (landing page): a sample place.
    const location = view && profile.data ? statePlace(view) : (home ?? sample);
    return {
      location,
      home,
      setLocation: (p: Place) => {
        setSample(p);
        writeStorage("local", SAMPLE_KEY, p.id);
      },
      viewState: (state: string | null) => {
        const next = state && state !== home?.state ? state : null;
        setView(next);
        writeStorage("session", VIEW_KEY, next);
      },
    };
  }, [home, profile.data, sample, view]);

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export const useFarmLocation = () => useContext(LocationContext);

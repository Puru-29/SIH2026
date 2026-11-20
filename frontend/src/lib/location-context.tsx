import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCATION, LOCATIONS, type Place } from "./agri";

type Ctx = { location: Place; setLocation: (p: Place) => void };

const LocationContext = createContext<Ctx>({ location: DEFAULT_LOCATION, setLocation: () => {} });

export function LocationProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Place>(DEFAULT_LOCATION);

  useEffect(() => {
    const saved = localStorage.getItem("agrisense-location");
    const match = LOCATIONS.find((l) => l.id === saved);
    if (match) setLocation(match);
  }, []);

  const value = useMemo(
    () => ({
      location,
      setLocation: (p: Place) => {
        setLocation(p);
        localStorage.setItem("agrisense-location", p.id);
      },
    }),
    [location],
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export const useFarmLocation = () => useContext(LocationContext);

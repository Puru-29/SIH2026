import { MapPin } from "lucide-react";
import { LOCATIONS } from "@/services";
import { useFarmLocation } from "@/lib/location-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function LocationSelector({ compact = false }: { compact?: boolean }) {
  const { location, setLocation } = useFarmLocation();

  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
      <MapPin className="h-4 w-4 shrink-0 text-primary" />
      <Select
        value={location.id}
        onValueChange={(id) => {
          const next = LOCATIONS.find((l) => l.id === id);
          if (next) setLocation(next);
        }}
      >
        <SelectTrigger className="h-auto border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {LOCATIONS.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              <span className="flex flex-col items-start">
                <span className="text-sm">
                  {l.name}, {l.district}
                </span>
                <span className="text-xs text-muted-foreground">{l.belt}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!compact ? (
        <span className="hidden text-xs text-muted-foreground lg:inline">{location.state}</span>
      ) : null}
    </div>
  );
}

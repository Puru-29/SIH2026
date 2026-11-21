import type { Place } from "./agri";
import { STATE_CENTRES, isIndianState } from "./states";

/** A place for a whole state (centre coordinates). */
export function statePlace(state: string): Place {
  const centre = isIndianState(state) ? STATE_CENTRES[state] : STATE_CENTRES.Maharashtra;
  return { id: `state:${state}`, name: state, district: "", state, belt: "", ...centre };
}

/** "Dindori, Nashik, Maharashtra · belt" without repeats or empty parts. */
export function placeLabel(p: Place, withBelt = true): string {
  const parts = [p.name, p.district, p.state].filter(
    (x, i, all) => x && all.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i,
  );
  return parts.join(", ") + (withBelt && p.belt ? ` · ${p.belt}` : "");
}

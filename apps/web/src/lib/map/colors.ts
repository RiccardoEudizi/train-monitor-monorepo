import type { RegionStat } from "~/lib/api-types";

/**
 * Choropleth steps for avg delay (minutes): pastel inks on the dark map
 * panel. Flat + legible, softened further by the dither overlay.
 */
export function regionFill(avgDelay: number | null): {
  fill: string;
  opacity: number;
} {
  if (avgDelay == null) return { fill: "#131316", opacity: 1 };
  if (avgDelay <= 0) return { fill: "#bbf7d0", opacity: 0.9 };
  if (avgDelay <= 3) return { fill: "#fef08a", opacity: 0.9 };
  if (avgDelay <= 7) return { fill: "#fed7aa", opacity: 0.9 };
  if (avgDelay <= 15) return { fill: "#fda4af", opacity: 0.9 };
  return { fill: "#fca5a5", opacity: 0.95 };
}

export function byRegionId(regions: RegionStat[]): Map<number, RegionStat> {
  return new Map(
    regions.flatMap((r) => (r.regionId == null ? [] : [[r.regionId, r] as const])),
  );
}

/** Dot ink for a live train stato (uniform size, color only). */
export function statoColor(stato: string): string {
  switch (stato) {
    case "delayed":
      return "#fbbf24";
    case "heavily-delayed":
      return "#f87171";
    case "cancelled":
    case "nodata":
      return "#71717a";
    case "partial":
      return "#fb923c";
    default:
      return "#34d399";
  }
}

/** Legend steps mirroring regionFill() thresholds — single source for /map. */
export const CHORO_LEGEND: Array<{ label: string; color: string }> = [
  { label: "in orario", color: "#bbf7d0" },
  { label: "+1–3'", color: "#fef08a" },
  { label: "+3–7'", color: "#fed7aa" },
  { label: "+7–15'", color: "#fda4af" },
  { label: "+15'", color: "#fca5a5" },
];

/** Legend states mirroring statoColor() — single source for /map. */
export const LIVE_LEGEND: Array<{ label: string; stato: string }> = [
  { label: "in orario", stato: "ok" },
  { label: "ritardo", stato: "delayed" },
  { label: "forte ritardo", stato: "heavily-delayed" },
  { label: "parziale/canc", stato: "partial" },
];

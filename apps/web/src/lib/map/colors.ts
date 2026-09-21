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

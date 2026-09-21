/**
 * Shared palette for the dashboard charts (Chart.js).
 *
 * Same visual language as the old ASCII charts (Geist Mono,
 * zinc + amber-500 + emerald-500).
 */

export const TM = {
  font: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  axisText: "#71717a", // zinc-500
  gridLight: "#e4e4e7", // zinc-200
  gridDark: "#27272a", // zinc-800
  amber: "#f59e0b", // amber-500
  amberSoft: "rgba(245,158,11,0.14)",
  emerald: "#10b981", // emerald-500
  emeraldSoft: "rgba(16,185,129,0.14)",
  zinc400: "#a1a1aa",
  zinc500: "#71717a",
} as const;

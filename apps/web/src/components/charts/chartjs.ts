import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type TooltipOptions,
} from "chart.js";
import { TM } from "./tm-theme";

// Granular registration: only what the dashboard charts need.
// Importing chart.js touches no DOM, so this module is SSR-safe;
// canvas instances are created in onMount only.
Chart.register(
  LineController,
  BarController,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Filler,
  Tooltip,
);

export { Chart };

export const MONO = TM.font;

/** Subtle gridline color for both themes (zinc-500 @ low alpha). */
export const GRID = "rgba(113, 113, 122, 0.18)";

/** Axis tick styling shared by all charts. */
export const TICKS = {
  color: TM.axisText,
  font: { family: MONO, size: 10 },
} as const;

/** Dark mono tooltip shell matching map popups. */
export function tooltipBase(extra?: Partial<TooltipOptions<"line" | "bar">>) {
  return {
    backgroundColor: "rgba(9, 9, 11, 0.95)",
    borderColor: "#3f3f46",
    borderWidth: 1,
    titleColor: "#f4f4f5",
    bodyColor: "#f4f4f5",
    padding: 8,
    cornerRadius: 6,
    displayColors: false,
    titleFont: { family: MONO, size: 11, weight: "bold" as const },
    bodyFont: { family: MONO, size: 11 },
    ...extra,
  };
}

/** Disable animation for prefers-reduced-motion users. */
export function animationFor(millis: number) {
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    return false as const;
  }
  return { duration: millis } as const;
}

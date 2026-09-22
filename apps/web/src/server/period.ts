/** Single source of truth for period windows.
 * Home: "1d" | "7d" | "30d" | "total". Train/station: "24h" | "7d" | "30d" | "all".
 * Returns window days, or null = full history. Unknown strings fall back to 30.
 */
export function normalizePeriodDays(period: string): number | null {
  const p = (period ?? "").trim().toLowerCase();
  if (p === "24h" || p === "1d" || p === "day" || p === "daily") return 1;
  if (p === "7d" || p === "week" || p === "7g") return 7;
  if (p === "30d" || p === "month" || p === "30g") return 30;
  if (p === "all" || p === "total" || p === "totale" || p === "tot") return null;
  return 30;
}

/** "YYYY-MM-DD" lower bound for a period, or null = no bound. */
export function periodSinceDate(period: string, now = Date.now()): string | null {
  const days = normalizePeriodDays(period);
  if (days == null) return null;
  return new Date(now - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

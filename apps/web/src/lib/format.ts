/** Small formatting helpers. All times rendered in Europe/Rome. */
import { DELAY_HEAVY, DELAY_MIN } from "~/lib/thresholds";

const tz = "Europe/Rome";

function fmtClock(iso: string | null, withSeconds: boolean, fallback: string): string {
  if (!iso) return fallback;
  try {
    return new Intl.DateTimeFormat("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
      ...(withSeconds ? { second: "2-digit" as const } : {}),
      hourCycle: "h23",
      timeZone: tz,
    }).format(new Date(iso));
  } catch {
    return fallback;
  }
}

export function fmtTime(iso: string | null): string {
  return fmtClock(iso, false, "--:--");
}

/** Time with seconds: "14:56:36" (Europe/Rome, 24h). */
export function fmtTimeSec(iso: string | null): string {
  return fmtClock(iso, true, "--:--:--");
}

/**
 * European short date for ViaggiaTreno `YYYY-MM-DD` date-only strings.
 * Parsed manually (no Date) so no timezone can shift the day.
 * "2026-09-15" → "15/09/2026".
 */
export function fmtDateEU(dateOnly: string | null): string {
  if (!dateOnly) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOnly.trim());
  if (!m) return dateOnly;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** European date+time: "15/09 11:53" (Europe/Rome, 24h). */
export function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const date = new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "2-digit",
      timeZone: tz,
    }).format(d);
    const time = new Intl.DateTimeFormat("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: tz,
    }).format(d);
    return `${date} ${time}`;
  } catch {
    return "";
  }
}

export function fmtDelay(min: number): string {
  if (min <= 0) return "in orario";
  return `+${min} min`;
}

export function delayClass(min: number): string {
  if (min >= DELAY_HEAVY) return "text-red-400";
  if (min >= DELAY_MIN) return "text-amber-400";
  return "text-emerald-400";
}

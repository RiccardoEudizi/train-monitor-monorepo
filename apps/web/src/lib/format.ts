/** Small formatting helpers. All times rendered in Europe/Rome. */

const tz = "Europe/Rome";

export function fmtTime(iso: string | null): string {
  if (!iso) return "--:--";
  try {
    return new Intl.DateTimeFormat("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: tz,
    }).format(new Date(iso));
  } catch {
    return "--:--";
  }
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "short",
      timeZone: tz,
    }).format(new Date(iso));
  } catch {
    return "";
  }
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
  if (min >= 15) return "text-red-400";
  if (min >= 5) return "text-amber-400";
  if (min > 0) return "text-zinc-300";
  return "text-emerald-400";
}

/** Shared UI-ready shapes returned by /api/*. Never raw ViaggiaTreno. */

export type TrainStato =
  | "ok"
  | "delayed"
  | "heavily-delayed"
  | "cancelled"
  | "partial"
  | "nodata";

/** Temporal status based on current time vs scheduled start/end times. */
export type TrainTemporalStatus =
  | "waiting"     // not started yet, within 50 min of departure
  | "traveling"   // between departure and arrival
  | "ended"       // past scheduled arrival
  | "unknown";    // missing time data

export interface TrainCard {
  runId: number | null;
  numero: string;
  categoria: string;
  origine: string;
  destinazione: string;
  dataPartenza: string | null;
  /** ISO scheduled departure from the board station (or origin). */
  scheduled: string | null;
  /** ISO expected departure/arrival at the board station. */
  expected: string | null;
  delay: number;
  binarioProg: string | null;
  binarioReal: string | null;
  stato: TrainStato;
  /** Temporal status: waiting/traveling/ended based on orario_partenza/orario_arrivo */
  temporalStatus: TrainTemporalStatus;
  /** Scheduled departure from origin (orario_partenza) */
  orarioPartenza: string | null;
  /** Scheduled arrival at destination (orario_arrivo) */
  orarioArrivo: string | null;
  lastRilevamento: string | null;
  lastRilevamentoStazione: string | null;
}

export interface StopRow {
  station: string;
  code: string;
  order: number;
  tipoFermata: string | null;
  scheduledArr: string | null;
  scheduledDep: string | null;
  actualArr: string | null;
  actualDep: string | null;
  delayArr: number;
  delayDep: number;
  status: "done" | "upcoming" | "skipped";
}

export interface TrainCandidate {
  numero: string;
  origine: string;
  origineCode: string;
  dataPartenza: string;
}

export interface TrainDetail {
  candidates: TrainCandidate[];
  live: TrainCard | null;
  stops: StopRow[];
}

export interface PeriodStats {
  runs: number;
  avgFinal: number;
  p95Final: number;
  maxFinal: number;
  avgMaxEnroute: number;
  avgRecupero: number;
  cancellRate: number;
  series: Array<{
    date: string;
    avgFinal: number;
    maxFinal: number;
    runs: number;
  }>;
}

export interface StationItem {
  code: string;
  name: string;
  city: string | null;
  region: number | null;
  major: boolean;
}

export function statoFor(delay: number, provvedimento: number): TrainStato {
  if (provvedimento === 1) return "cancelled";
  if (provvedimento === 2) return "partial";
  if (delay >= 15) return "heavily-delayed";
  if (delay >= 5) return "delayed";
  return "ok";
}

export interface DelaysRes {
  updatedAt: string;
  totalCircolanti: number;
  items: TrainCard[];
  dbConfigured: boolean;
}

export interface NewsRes {
  ticker: string[];
  news?: unknown;
  updatedAt: string;
  dbConfigured: boolean;
}

export interface BoardRes {
  station: { code: string; name: string; city: string | null };
  updatedAt: string;
  trains: TrainCard[];
  dbConfigured: boolean;
}

/** Compute temporal status from current time vs scheduled departure/arrival. */
export function temporalStatus(
  orarioPartenza: string | null,
  orarioArrivo: string | null,
  now: Date = new Date()
): TrainTemporalStatus {
  if (!orarioPartenza || !orarioArrivo) return "unknown";
  
  const partenza = new Date(orarioPartenza).getTime();
  const arrivo = new Date(orarioArrivo).getTime();
  const nowMs = now.getTime();
  
  // Waiting: before departure but within 50 minutes
  if (nowMs < partenza && nowMs >= partenza - 50 * 60 * 1000) {
    return "waiting";
  }
  // Traveling: between departure and arrival
  if (nowMs >= partenza && nowMs < arrivo) {
    return "traveling";
  }
  // Ended: past scheduled arrival
  if (nowMs >= arrivo) {
    return "ended";
  }
  // Before 50-minute window
  return "unknown";
}

/** Combined display status: temporal takes precedence for waiting/ended. */
export function displayStatus(
  temporal: TrainTemporalStatus,
  delayStato: TrainStato
): { label: string; class: string } {
  switch (temporal) {
    case "waiting":
      return { label: "in attesa", class: "text-amber-400" };
    case "traveling":
      if (delayStato === "cancelled") return { label: "cancellato", class: "text-red-400" };
      if (delayStato === "partial") return { label: "parziale", class: "text-amber-400" };
      if (delayStato === "heavily-delayed") return { label: "in viaggio · forte ritardo", class: "text-red-400" };
      if (delayStato === "delayed") return { label: "in viaggio · ritardo", class: "text-amber-400" };
      return { label: "in viaggio", class: "text-emerald-400" };
    case "ended":
      if (delayStato === "cancelled") return { label: "cancellato", class: "text-red-400" };
      if (delayStato === "partial") return { label: "parziale", class: "text-amber-400" };
      return { label: "arrivato", class: "text-zinc-400" };
    default:
      // "unknown" - fallback to delay-based
      if (delayStato === "cancelled") return { label: "cancellato", class: "text-red-400" };
      if (delayStato === "partial") return { label: "parziale", class: "text-amber-400" };
      if (delayStato === "heavily-delayed") return { label: "forte ritardo", class: "text-red-400" };
      if (delayStato === "delayed") return { label: "ritardo", class: "text-amber-400" };
      return { label: "in orario", class: "text-emerald-400" };
  }
}

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
  /** Corse con ritardo finale oltre la soglia (home: > 0'). */
  delayedCount: number;
  /** % corse in ritardo sul totale (0-100, 1 decimale). */
  delayedRate: number;
  /** Somma dei ritardi finali, in minuti. */
  totalDelay: number;
  /** Corsa con il ritardo peggiore nel periodo (solo scope=station).
   *  Stessa forma delle card ritardi (TrainRow): link a /treno/{numero}. */
  worstTrain?: (TrainCard & { runDate: string }) | null;
  series: Array<{
    date: string;
    avgFinal: number;
    maxFinal: number;
    runs: number;
  }>;
}

/** Aggregato regionale: ogni corsa conta una volta sola, attribuita alla
 * regione del suo ultimo rilevamento; il criterio di ranking è la somma
 * cumulata dei ritardi nel periodo. */
export interface RegionStat {
  regionId: number | null;
  name: string;
  runs: number;
  delayedCount: number;
  totalDelay: number;
  avgDelay: number;
  maxDelay: number;
}

export interface OverviewRes {
  period: string;
  dbConfigured: boolean;
  national: PeriodStats;
  worstRegion: RegionStat | null;
  /** Top regioni per ritardo cumulato (max 6, per barre ASCII). */
  regions: RegionStat[];
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
  news?: unknown[];
  lavori?: unknown[];
  updatedAt: string;
  dbConfigured: boolean;
}

export interface BoardRes {
  station: {
    code: string;
    name: string;
    city: string | null;
    region: number | null;
    major: boolean;
  };
  updatedAt: string;
  trains: TrainCard[];
  dbConfigured: boolean;
}

export type StatsPeriod = "1d" | "7d" | "30d" | "total";

/** Compute temporal status from current time vs scheduled departure/arrival.
 * `delayMins` shifts the effective arrival (a train scheduled to arrive at
 * 10:00 with +60' is still traveling at 10:30, not "ended"). */
export function temporalStatus(
  orarioPartenza: string | null,
  orarioArrivo: string | null,
  now: Date = new Date(),
  delayMins: number = 0,
): TrainTemporalStatus {
  if (!orarioPartenza || !orarioArrivo) return "unknown";
  
  const partenza = new Date(orarioPartenza).getTime();
  const arrivo = new Date(orarioArrivo).getTime();
  if (!Number.isFinite(partenza) || !Number.isFinite(arrivo)) return "unknown";
  const delay = Number.isFinite(delayMins) ? Math.max(0, delayMins) : 0;
  const effArrivo = arrivo + delay * 60 * 1000;
  const nowMs = now.getTime();
  
  // Waiting: before departure but within 50 minutes
  if (nowMs < partenza && nowMs >= partenza - 50 * 60 * 1000) {
    return "waiting";
  }
  // Traveling: between departure and effective (delay-shifted) arrival
  if (nowMs >= partenza && nowMs < effArrivo) {
    return "traveling";
  }
  // Ended: past effective arrival
  if (nowMs >= effArrivo) {
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

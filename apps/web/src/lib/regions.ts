import { MAJOR_STATIONS } from "~/lib/stations-seed";

/**
 * ViaggiaTreno `region_id` → nome italiano.
 * Ricavata dai dati seed (stazioni principali) + compartimenti standard.
 * `0` = bucket "principali" dell'endpoint elencoStazioni/0 (mix geografico):
 * nel DB molte major hanno region_id=0, per questo esiste
 * MAJOR_REGION_OVERRIDE (codice stazione → regione geografica).
 */
export const REGION_NAMES: Record<number, string> = {
  0: "Principali",
  1: "Lombardia",
  2: "Liguria",
  3: "Piemonte",
  4: "Valle d'Aosta",
  5: "Lazio",
  6: "Umbria",
  7: "Molise",
  8: "Emilia-Romagna",
  10: "Friuli-Venezia Giulia",
  11: "Marche",
  12: "Veneto",
  13: "Toscana",
  14: "Sicilia",
  15: "Basilicata",
  16: "Puglia",
  17: "Calabria",
  18: "Campania",
  19: "Abruzzo",
  20: "Sardegna",
  21: "Trentino",
  22: "Alto Adige",
};

export function regionName(id: number | null | undefined): string {
  if (id == null) return "Sconosciuta";
  return REGION_NAMES[id] ?? `Regione ${id}`;
}

/**
 * Codice stazione major → regione geografica.
 * Serve perché il poller assegna region_id=0 alle stazioni viste per prime
 * sotto elencoStazioni/0 (principali). Usato come fallback quando
 * stations.region_id è 0 o NULL.
 */
export const MAJOR_REGION_OVERRIDE: ReadonlyMap<string, number> = new Map(
  MAJOR_STATIONS.filter((s) => s.region != null).map((s) => [
    s.code,
    s.region as number,
  ]),
);

/** Risolve la regione geografica: override major vince su 0/NULL. */
export function resolveRegion(
  stationCode: string | null | undefined,
  regionId: number | null | undefined,
): number | null {
  if (stationCode) {
    const override = MAJOR_REGION_OVERRIDE.get(stationCode);
    if (override != null && (regionId == null || regionId === 0)) {
      return override;
    }
  }
  return regionId ?? null;
}

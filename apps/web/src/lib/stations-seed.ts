import type { StationItem } from "~/lib/api-types";

/**
 * Tier-1 major stations, verified against ViaggiaTreno elencoStazioni/0.
 * Used as fallback for /api/stations + /api/board when DATABASE_URL
 * is not configured yet, and as the poller's initial target list.
 * The poller replaces/extends this from the DB once seeded.
 */
export const MAJOR_STATIONS: StationItem[] = [
  { code: "S01700", name: "MILANO CENTRALE", city: "Milano", region: 1, major: true },
  { code: "S01820", name: "MILANO ROGOREDO", city: "Milano", region: 1, major: true },
  { code: "S00219", name: "TORINO PORTA NUOVA", city: "Torino", region: 3, major: true },
  { code: "S04700", name: "GENOVA PIAZZA PRINCIPE", city: "Genova", region: 2, major: true },
  { code: "S06000", name: "LA SPEZIA CENTRALE", city: "La Spezia", region: 2, major: true },
  { code: "S02593", name: "VENEZIA S.LUCIA", city: "Venezia", region: 12, major: true },
  { code: "S02581", name: "PADOVA", city: "Padova", region: 12, major: true },
  { code: "S02430", name: "VERONA PORTA NUOVA", city: "Verona", region: 12, major: true },
  { code: "S02446", name: "VICENZA", city: "Vicenza", region: 12, major: true },
  { code: "S03317", name: "TRIESTE CENTRALE", city: "Trieste", region: 10, major: true },
  { code: "S03026", name: "UDINE", city: "Udine", region: 10, major: true },
  { code: "S02026", name: "BOLZANO", city: "Bolzano", region: 22, major: true },
  { code: "S02038", name: "TRENTO", city: "Trento", region: 21, major: true },
  { code: "S01717", name: "BRESCIA", city: "Brescia", region: 1, major: true },
  { code: "S01307", name: "COMO S.GIOVANNI", city: "Como", region: 1, major: true },
  { code: "S00248", name: "NOVARA", city: "Novara", region: 3, major: true },
  { code: "S00245", name: "VERCELLI", city: "Vercelli", region: 3, major: true },
  { code: "S00470", name: "ALESSANDRIA", city: "Alessandria", region: 3, major: true },
  { code: "S00462", name: "ASTI", city: "Asti", region: 3, major: true },
  { code: "S04801", name: "SAVONA", city: "Savona", region: 2, major: true },
  { code: "S04523", name: "IMPERIA", city: "Imperia", region: 2, major: true },
  { code: "S04501", name: "VENTIMIGLIA", city: "Ventimiglia", region: 2, major: true },
  { code: "S05043", name: "BOLOGNA CENTRALE", city: "Bologna", region: 8, major: true },
  { code: "S05032", name: "MODENA", city: "Modena", region: 8, major: true },
  { code: "S05014", name: "PARMA", city: "Parma", region: 8, major: true },
  { code: "S05000", name: "PIACENZA", city: "Piacenza", region: 8, major: true },
  { code: "S05254", name: "REGGIO EMILIA AV MEDIOPADANA", city: "Reggio Emilia", region: 8, major: true },
  { code: "S05712", name: "FERRARA", city: "Ferrara", region: 8, major: true },
  { code: "S05071", name: "RIMINI", city: "Rimini", region: 8, major: true },
  { code: "S07113", name: "ANCONA", city: "Ancona", region: 11, major: true },
  { code: "S07104", name: "PESARO", city: "Pesaro", region: 11, major: true },
  { code: "S06421", name: "FIRENZE SANTA MARIA NOVELLA", city: "Firenze", region: 13, major: true },
  { code: "S06915", name: "AREZZO", city: "Arezzo", region: 13, major: true },
  { code: "S06500", name: "PISA CENTRALE", city: "Pisa", region: 13, major: true },
  { code: "S06725", name: "LIVORNO CENTRALE", city: "Livorno", region: 13, major: true },
  { code: "S06039", name: "GROSSETO", city: "Grosseto", region: 13, major: true },
  { code: "S07226", name: "TERNI", city: "Terni", region: 6, major: true },
  { code: "S07217", name: "FOLIGNO", city: "Foligno", region: 6, major: true },
  { code: "S07004", name: "PERUGIA", city: "Perugia", region: 6, major: true },
  { code: "S08209", name: "ORTE", city: "Orte", region: 5, major: true },
  { code: "S08409", name: "ROMA TERMINI", city: "Roma", region: 5, major: true },
  { code: "S08608", name: "LATINA", city: "Latina", region: 5, major: true },
  { code: "S08662", name: "FROSINONE", city: "Frosinone", region: 5, major: true },
  { code: "S08539", name: "SULMONA", city: "Sulmona", region: 19, major: true },
  { code: "S07712", name: "CHIETI", city: "Chieti", region: 19, major: true },
  { code: "S07810", name: "PESCARA", city: "Pescara", region: 19, major: true },
  { code: "S09459", name: "CAMPOBASSO", city: "Campobasso", region: 7, major: true },
  { code: "S09053", name: "ISERNIA", city: "Isernia", region: 7, major: true },
  { code: "S09311", name: "BENEVENTO", city: "Benevento", region: 18, major: true },
  { code: "S09211", name: "CASERTA", city: "Caserta", region: 18, major: true },
  { code: "S09218", name: "NAPOLI CENTRALE", city: "Napoli", region: 18, major: true },
  { code: "S09818", name: "SALERNO", city: "Salerno", region: 18, major: true },
  { code: "S11723", name: "MARATEA", city: "Maratea", region: 15, major: true },
  { code: "S11739", name: "PAOLA", city: "Paola", region: 17, major: true },
  { code: "S11749", name: "LAMEZIA TERME CENTRALE", city: "Lamezia Terme", region: 17, major: true },
  { code: "S11781", name: "REGGIO DI CALABRIA CENTRALE", city: "Reggio Calabria", region: 17, major: true },
  { code: "S11910", name: "COSENZA", city: "Cosenza", region: 17, major: true },
  { code: "S11956", name: "CATANZARO", city: "Catanzaro", region: 17, major: true },
  { code: "S11823", name: "CROTONE", city: "Crotone", region: 17, major: true },
  { code: "S11811", name: "SIBARI", city: "Sibari", region: 17, major: true },
  { code: "S11461", name: "METAPONTO", city: "Metaponto", region: 15, major: true },
  { code: "S11420", name: "POTENZA CENTRALE", city: "Potenza", region: 15, major: true },
  { code: "S11465", name: "TARANTO", city: "Taranto", region: 16, major: true },
  { code: "S11119", name: "BARI CENTRALE", city: "Bari", region: 16, major: true },
  { code: "S11108", name: "BARLETTA", city: "Barletta", region: 16, major: true },
  { code: "S11100", name: "FOGGIA", city: "Foggia", region: 16, major: true },
  { code: "S11136", name: "BRINDISI", city: "Brindisi", region: 16, major: true },
  { code: "S11145", name: "LECCE", city: "Lecce", region: 16, major: true },
  { code: "S12301", name: "MESSINA CENTRALE", city: "Messina", region: 14, major: true },
  { code: "S12332", name: "CATANIA CENTRALE", city: "Catania", region: 14, major: true },
  { code: "S12349", name: "SIRACUSA", city: "Siracusa", region: 14, major: true },
  { code: "S12002", name: "PALERMO CENTRALE", city: "Palermo", region: 14, major: true },
  { code: "S12891", name: "CAGLIARI", city: "Cagliari", region: 20, major: true },
  { code: "S12807", name: "SASSARI", city: "Sassari", region: 20, major: true },
  { code: "S12855", name: "OLBIA", city: "Olbia", region: 20, major: true },
];

export function searchSeed(q: string, limit = 8): StationItem[] {
  const norm = q.trim().toLowerCase();
  if (norm.length < 2) return [];
  return MAJOR_STATIONS.filter((s) =>
    s.name.toLowerCase().includes(norm),
  ).slice(0, limit);
}

export function seedByCode(code: string): StationItem | undefined {
  return MAJOR_STATIONS.find((s) => s.code === code);
}

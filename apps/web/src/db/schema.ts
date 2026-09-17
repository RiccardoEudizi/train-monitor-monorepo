import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Stations table.
 * Seeded by the Go poller from ViaggiaTreno elencoStazioni/0..22.
 * `code` is the ViaggiaTreno S-code (e.g. S01700).
 */
export const stations = pgTable(
  "stations",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    shortName: text("short_name"),
    city: text("city"),
    regionId: integer("region_id"),
    lat: real("lat"),
    lon: real("lon"),
    isMajor: boolean("is_major").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("stations_name_idx").on(t.name),
    index("stations_major_idx").on(t.isMajor),
  ],
);

/**
 * One row per train run, keyed by the ViaggiaTreno triple:
 * (numero, origine_code, data_partenza).
 * v1 keyed by numero only — that mixed different days/origins.
 */
export const trainRuns = pgTable(
  "train_runs",
  {
    id: serial("id").primaryKey(),
    numero: text("numero").notNull(),
    origineCode: text("origine_code").notNull(),
    dataPartenza: date("data_partenza").notNull(),
    categoria: text("categoria"),
    origine: text("origine"),
    destinazione: text("destinazione"),
    destCode: text("dest_code"),
    tipoTreno: text("tipo_treno"),
    provvedimento: integer("provvedimento").notNull().default(0),
    orarioPartenza: timestamp("orario_partenza", { withTimezone: true }),
    orarioArrivo: timestamp("orario_arrivo", { withTimezone: true }),
    lastDelay: integer("last_delay").notNull().default(0),
    maxDelay: integer("max_delay").notNull().default(0),
    lastRilevamentoAt: timestamp("last_rilevamento_at", {
      withTimezone: true,
    }),
    lastRilevamentoStazione: text("last_rilevamento_stazione"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("train_runs_triple_idx").on(
      t.numero,
      t.origineCode,
      t.dataPartenza,
    ),
    index("train_runs_numero_idx").on(t.numero),
    index("train_runs_data_idx").on(t.dataPartenza),
  ],
);

/**
 * Current truth per (run, station). UPSERTed by the poller on every cycle.
 */
export const stops = pgTable(
  "stops",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => trainRuns.id, { onDelete: "cascade" }),
    stationCode: text("station_code").notNull(),
    orderIdx: integer("order_idx").notNull().default(0),
    tipoFermata: text("tipo_fermata"),
    programmataArr: timestamp("programmata_arr", { withTimezone: true }),
    programmataDep: timestamp("programmata_dep", { withTimezone: true }),
    actualArr: timestamp("actual_arr", { withTimezone: true }),
    actualDep: timestamp("actual_dep", { withTimezone: true }),
    delayArr: integer("delay_arr").notNull().default(0),
    delayDep: integer("delay_dep").notNull().default(0),
    actualType: integer("actual_type").notNull().default(1),
    binarioProg: text("binario_prog"),
    binarioReal: text("binario_real"),
  },
  (t) => [
    uniqueIndex("stops_run_station_idx").on(t.runId, t.stationCode),
    index("stops_station_idx").on(t.stationCode),
  ],
);

/**
 * Append-only raw history: one row per (run, station) per poll cycle.
 * This replaces v1's `delays` table. Aggregates are computed over
 * train_runs (final/max delay), never by averaging these rows directly.
 */
export const stopSnapshots = pgTable(
  "stop_snapshots",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => trainRuns.id, { onDelete: "cascade" }),
    stationCode: text("station_code").notNull(),
    delayArr: integer("delay_arr").notNull().default(0),
    delayDep: integer("delay_dep").notNull().default(0),
    stato: text("stato").notNull().default("ok"),
    rilevatoAt: timestamp("rilevato_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("snapshots_run_station_time_idx").on(
      t.runId,
      t.stationCode,
      t.rilevatoAt,
    ),
    index("snapshots_station_time_idx").on(t.stationCode, t.rilevatoAt),
    index("snapshots_rilevato_idx").on(t.rilevatoAt),
  ],
);

/**
 * Rolled-up daily per-stop stats for charts older than raw retention.
 * Written by a Go rollup job (or SQL cron) from stop_snapshots.
 */
export const dailyStopStats = pgTable(
  "daily_stop_stats",
  {
    id: serial("id").primaryKey(),
    runDate: date("run_date").notNull(),
    numero: text("numero").notNull(),
    stationCode: text("station_code").notNull(),
    delayArrFinal: integer("delay_arr_final").notNull().default(0),
    delayMax: integer("delay_max").notNull().default(0),
    cancelled: boolean("cancelled").notNull().default(false),
    samples: integer("samples").notNull().default(0),
  },
  (t) => [
    uniqueIndex("daily_stats_unique_idx").on(
      t.runDate,
      t.numero,
      t.stationCode,
    ),
    index("daily_stats_numero_idx").on(t.numero),
    index("daily_stats_station_idx").on(t.stationCode),
  ],
);

/**
 * National counters + infomobility news, refreshed by the poller.
 * `kind`: ticker | news | lavori | stats
 */
export const infoNews = pgTable("info_news", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull().unique(),
  payload: jsonb("payload").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Station = typeof stations.$inferSelect;
export type TrainRun = typeof trainRuns.$inferSelect;
export type Stop = typeof stops.$inferSelect;
export type DailyStopStat = typeof dailyStopStats.$inferSelect;

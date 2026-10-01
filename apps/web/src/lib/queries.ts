import { query } from "@solidjs/router";

/**
 * Blessed data layer: `query` server functions + `createAsync` in pages.
 * Each fetcher runs on the server during SSR (result serialized to the
 * client), so server HTML and the hydrated tree come from the same data —
 * no hydration mismatch. The DB code is dynamically imported inside the
 * "use server" scope so it never ships to the client bundle.
 */

export const getDelaysQuery = query(async (min: number, cat: string, limit: number) => {
  "use server";
  const { fetchDelays } = await import("~/server/data");
  const { parseCats, parseLimit, parseMin } = await import("~/server/api-helpers");
  return fetchDelays(parseMin(String(min)), parseCats(cat), parseLimit(String(limit)));
}, "delays");

export const getNewsQuery = query(async () => {
  "use server";
  const { fetchNews } = await import("~/server/data");
  return fetchNews();
}, "news");

export const getBoardQuery = query(async (station: string) => {
  "use server";
  const { fetchBoard } = await import("~/server/data");
  return fetchBoard(station.trim().toUpperCase());
}, "board");

export const getTrainQuery = query(async (numero: string, origine?: string, date?: string) => {
  "use server";
  const { fetchTrain } = await import("~/server/data");
  return fetchTrain(numero.trim(), origine?.trim().toUpperCase() || undefined, date?.trim() || undefined);
}, "train");

export const getStatsQuery = query(async (scope: string, id: string, period: string) => {
  "use server";
  const { fetchStats } = await import("~/server/data");
  return fetchStats(scope, id, period);
}, "stats");

export const getOverviewQuery = query(async (period: string) => {
  "use server";
  const { fetchOverview } = await import("~/server/data");
  return fetchOverview(period);
}, "overview");

export const getMapRegionsQuery = query(async (period: string) => {
  "use server";
  const { fetchMapRegions } = await import("~/server/map-data");
  return fetchMapRegions(period);
}, "map-regions");

/**
 * Homepage hero counters. Same server function as /map renders its dots
 * (fetchLiveTrains), so the two pages report the same number for the same
 * snapshot by construction — not two queries that happen to look alike.
 * Only the counts cross the wire; the trains array stays with /map.
 */
export const getLiveCountsQuery = query(async () => {
  "use server";
  const { fetchLiveTrains } = await import("~/server/map-data");
  const { counts, updatedAt, dbConfigured } = await fetchLiveTrains();
  return { ...counts, updatedAt, dbConfigured };
}, "live-counts");

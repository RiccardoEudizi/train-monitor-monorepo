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
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeLimit = Number.isFinite(limit) ? limit : 50;
  return fetchDelays(safeMin, cat ? cat.split(",") : [], safeLimit);
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

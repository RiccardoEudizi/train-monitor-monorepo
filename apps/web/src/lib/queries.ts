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
  return fetchDelays(min, cat ? cat.split(",") : [], limit);
}, "delays");

export const getNewsQuery = query(async () => {
  "use server";
  const { fetchNews } = await import("~/server/data");
  return fetchNews();
}, "news");

export const getBoardQuery = query(async (station: string) => {
  "use server";
  const { fetchBoard } = await import("~/server/data");
  return fetchBoard(station.toUpperCase());
}, "board");

export const getTrainQuery = query(async (numero: string) => {
  "use server";
  const { fetchTrain } = await import("~/server/data");
  return fetchTrain(numero.trim());
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

import { logError } from "~/server/log";

/** Wrap a GET handler: JSON on success, uniform 500 + server log on throw. */
export function withApi<T>(fn: () => Promise<T>, errorMsg: string): Promise<Response> {
  return fn().then(
    (data) => Response.json(data),
    (e) => {
      logError(errorMsg, e);
      return Response.json({ error: errorMsg }, { status: 500 });
    },
  );
}

export function queryParam(url: URL, key: string, fallback = ""): string {
  return (url.searchParams.get(key) ?? fallback).trim();
}

/** Clamp limit to 1..200, default 50. */
export function parseLimit(raw: string | null): number {
  const n = Number(raw ?? "50");
  if (!Number.isFinite(n)) return 50;
  return Math.min(Math.max(Math.floor(n), 1), 200);
}

export function parseMin(raw: string | null): number {
  const n = Number(raw ?? "0");
  return Number.isFinite(n) ? n : 0;
}

export function parseCats(raw: string | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
}

export function parseStationCode(raw: string | null): string {
  return (raw ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function parseTrainNumber(raw: string | null): string {
  return (raw ?? "").trim().replace(/[^0-9]/g, "");
}

import { fetchBoard, fetchDelays, fetchTrain } from "~/server/data";
import { parseStationCode, parseTrainNumber } from "~/server/api-helpers";
import { logError } from "~/server/log";
import { POLL_MS } from "~/lib/map/interpolate";
import {
  LiveHub,
  ScopeLimitError,
  SubscriberLimitError,
  scopeKey,
  type Scope,
  type ServerMessage,
  type Snapshot,
} from "~/server/live-hub";

/** Serialize current snapshot for a scope via the shared data layer. */
async function snapshot(scope: Scope): Promise<Snapshot> {
  try {
    if (scope.kind === "station") {
      const board = await fetchBoard(scope.id);
      return {
        updatedAt: board.updatedAt,
        trains: board.trains,
        dbConfigured: board.dbConfigured,
      };
    }
    if (scope.kind === "train") {
      const detail = await fetchTrain(scope.id);
      return {
        updatedAt: new Date().toISOString(),
        trains: detail.live ? [detail.live] : [],
        dbConfigured: detail.dbConfigured,
      };
    }
    const delays = await fetchDelays(0, [], 50);
    return {
      updatedAt: delays.updatedAt,
      trains: delays.items,
      dbConfigured: delays.dbConfigured,
    };
  } catch (e) {
    logError(`live snapshot failed (${scopeKey(scope)})`, e);
    return {
      updatedAt: new Date().toISOString(),
      trains: [],
      dbConfigured: false,
    };
  }
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * One hub per process. Stashed on `globalThis` so dev HMR (and Nitro's module
 * graph) can't spawn a second set of timers for the same instance.
 */
const store = globalThis as typeof globalThis & { __trainLiveHub?: LiveHub };

function hub(): LiveHub {
  return (store.__trainLiveHub ??= new LiveHub({
    fetchSnapshot: snapshot,
    intervalMs: envInt("LIVE_SNAPSHOT_MS", POLL_MS),
    idleGraceMs: envInt("LIVE_IDLE_GRACE_MS", 60_000),
    freshMs: envInt("LIVE_FRESH_MS", 5_000),
    maxScopes: envInt("LIVE_MAX_SCOPES", 100),
    maxSubscribers: envInt("LIVE_MAX_CLIENTS", 500),
    log: logError,
  }));
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/** Stop buffering when a client stops reading (~33 frames ≈ 0.5 MB). */
const MAX_BACKLOG = 32;

/**
 * GET /api/live[?station=S01700][?train=9583]
 * SSE: global board + per-page subscriptions over the same handler.
 * One poll per scope per process; fans out to every subscriber.
 */
export async function GET(event: { request: Request }) {
  const url = new URL(event.request.url);
  const station = parseStationCode(url.searchParams.get("station")) || undefined;
  const train = parseTrainNumber(url.searchParams.get("train")) || undefined;
  const scope: Scope = station
    ? { kind: "station", id: station }
    : train
      ? { kind: "train", id: train }
      : { kind: "global", id: "" };
  const key = scopeKey(scope);
  const encoder = new TextEncoder();

  // Subscribe before opening the stream so a cap rejection can still be a
  // real 503 instead of a 200 that closes immediately.
  let sink: ((msg: ServerMessage) => void) | null = null;
  let done = false;
  const pending: ServerMessage[] = [];
  let unsubscribe: (() => void) | null = null;
  try {
    unsubscribe = hub().subscribe(scope, (msg) => {
      if (done) return;
      if (sink) sink(msg);
      else pending.push(msg);
    });
  } catch (e) {
    if (e instanceof ScopeLimitError || e instanceof SubscriberLimitError) {
      return Response.json({ error: e.message }, { status: 503 });
    }
    logError(`live subscribe failed (${key})`, e);
    return Response.json({ error: "live hub unavailable" }, { status: 500 });
  }

  const release = () => {
    done = true;
    unsubscribe?.();
    unsubscribe = null;
    sink = null;
    pending.length = 0;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      try {
        controller.enqueue(
          encoder.encode(`event: connected\ndata: {"scope":${JSON.stringify(key)}}\n\n`),
        );
      } catch {
        release();
        return;
      }

      const write = (msg: ServerMessage) => {
        if (controller.desiredSize !== null && controller.desiredSize < -MAX_BACKLOG) {
          release();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          return;
        }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
        } catch {
          release();
        }
      };

      sink = write;
      for (const msg of pending) write(msg);
      pending.length = 0;
    },
    cancel() {
      release();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

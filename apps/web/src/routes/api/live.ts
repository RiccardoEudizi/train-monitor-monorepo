import { fetchBoard, fetchDelays, fetchTrain } from "~/server/data";
import { parseStationCode, parseTrainNumber } from "~/server/api-helpers";
import { logError } from "~/server/log";
import { POLL_MS } from "~/lib/map/interpolate";

/** Serialize current snapshot for a scope via the shared data layer. */
async function snapshot(station?: string, train?: string) {
  try {
    if (station) {
      const board = await fetchBoard(station);
      return {
        updatedAt: board.updatedAt,
        trains: board.trains,
        dbConfigured: board.dbConfigured,
      };
    }
    if (train) {
      const detail = await fetchTrain(train);
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
    logError("live snapshot failed", e);
    return { updatedAt: new Date().toISOString(), trains: [], dbConfigured: false };
  }
}

/**
 * GET /api/live[?station=S01700][?train=9583]
 * SSE: global board + per-page subscriptions over the same handler.
 * Polls the DB every 12s, pushes only when the payload changes.
 */
export async function GET(event: { request: Request }) {
  const url = new URL(event.request.url);
  const station = parseStationCode(url.searchParams.get("station")) || undefined;
  const train = parseTrainNumber(url.searchParams.get("train")) || undefined;
  const scope = station
    ? `station:${station}`
    : train
      ? `train:${train}`
      : "global";

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* closed */
        }
      };
      try {
        controller.enqueue(encoder.encode(`event: connected\ndata: {"scope":"${scope}"}\n\n`));
      } catch {
        return;
      }

      let last = "";
      const tick = async () => {
        const snap = await snapshot(station, train);
        const key = JSON.stringify(snap.trains);
        if (key !== last) {
          last = key;
          send({ scope, ...snap });
        } else {
          send({ scope, updatedAt: snap.updatedAt, heartbeat: true });
        }
      };
      await tick();
      timer = setInterval(tick, POLL_MS);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

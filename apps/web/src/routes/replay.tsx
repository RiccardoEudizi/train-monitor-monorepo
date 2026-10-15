import { createAsync } from "@solidjs/router";
import type { RouteDefinition } from "@solidjs/router";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import DitherOverlay from "~/components/map/DitherOverlay";
import LiveMap3D from "~/components/map/LiveMap3D";
import ReplaySidebar from "~/components/map/ReplaySidebar";
import TrainHud from "~/components/map/TrainHud";
import Seo from "~/components/Seo";
import { Chip, EmptyState, ErrorBox, Spinner } from "~/components/ui";
import { fmtDateEU, fmtTimeSec } from "~/lib/format";
import { LIVE_LEGEND, statoColor } from "~/lib/map/colors";
import type { LiveTrain } from "~/lib/map/interpolate";
import {
  activeTrainsAt,
  createReplayFeed,
  decodeDay,
  eventsAround,
  type DayReplay,
  type ReplayDay,
  type ReplayEvent,
} from "~/lib/map/replay";
import { getReplayDaysQuery } from "~/lib/queries";
import { pageTitle } from "~/lib/seo";

export const route = {
  preload: () => getReplayDaysQuery(),
} satisfies RouteDefinition;

const SPEEDS = [10, 50, 100] as const;
const TRAINS_MS = 200; // refresh the active set ~5×/s
const EVENTS_MS = 300; // refresh the event feed ~3×/s
const UI_MS = 100; // throttle the clock signal the DOM reads
const EVENT_LOOKBACK_MS = 10 * 60_000;
const TOP_TRAINS = 60;

/** Today's date in Europe/Rome as YYYY-MM-DD. */
function romeToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** `?date=` from the URL, if it is a valid YYYY-MM-DD. */
function urlDate(): string | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search).get("date");
  return q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : null;
}

export default function ReplayPage() {
  const days = createAsync(() => getReplayDaysQuery());
  // Starts null so SSR and hydration agree; the effect below then applies the
  // URL override or the newest complete day (client only).
  const [date, setDate] = createSignal<string | null>(null);
  const [data, setData] = createSignal<ReplayDay | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [playing, setPlaying] = createSignal(true);
  const [speed, setSpeed] = createSignal<(typeof SPEEDS)[number]>(10);
  const [cursorMs, setCursorMs] = createSignal(0);
  const [trains, setTrains] = createSignal<LiveTrain[]>([]);
  const [events, setEvents] = createSignal<ReplayEvent[]>([]);
  const [selected, setSelected] = createSignal<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = createSignal(true);

  // Authoritative playback instant (plain var), read by the map's `clock`
  // every frame; `cursorMs` is the throttled mirror the DOM renders.
  let cursor = 0;

  const clock = () => (data() ? cursor : Date.now());
  const iso = () => new Date(cursorMs()).toISOString();
  const seek = (v: number) => {
    cursor = v;
    setCursorMs(v);
  };

  // Exact per-frame feed: the map pulls active trains (and their legs) every
  // animation frame, so dots move continuously at any playback speed.
  const feed = createMemo(() => {
    const d = data();
    return d ? createReplayFeed(d) : undefined;
  });

  const loadDay = async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/map/day?date=${encodeURIComponent(d)}`);
      if (!r.ok) throw new Error(`http ${r.status}`);
      const raw = (await r.json()) as DayReplay;
      const day = decodeDay(raw);
      setData(day);
      seek(day.minMs);
      setPlaying(true);
      setSelected(null);
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("date", d);
        window.history.replaceState(window.history.state, "", url);
      } catch {
        /* history unavailable */
      }
    } catch {
      setError("dati del giorno non disponibili");
    } finally {
      setLoading(false);
    }
  };

  // Pick the initial day once the list loads: URL override wins, else the
  // most recent COMPLETE day (skip today), else the newest available.
  createEffect(() => {
    const d = days();
    if (!d || date() || d.days.length === 0) return;
    const q = urlDate();
    const today = romeToday();
    const pick =
      (q && d.days.find((x) => x.date === q)) ||
      d.days.find((x) => x.date !== today) ||
      d.days[0];
    if (pick) setDate(pick.date);
  });

  createEffect(() => {
    const d = date();
    if (d) void loadDay(d);
  });

  // Playback clock: advances `cursor` at `speed`× real time.
  onMount(() => {
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const d = data();
      const dt = Math.min(t - last, 250);
      last = t;
      if (!d) return;
      if (playing()) {
        cursor += dt * speed();
        if (cursor >= d.maxMs) {
          cursor = d.maxMs;
          setPlaying(false);
        }
        if (t - lastUi > UI_MS) {
          lastUi = t;
          setCursorMs(cursor);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  // Active train set (drives the dots + sidebar list).
  onMount(() => {
    const id = setInterval(() => {
      const d = data();
      if (!d) return;
      const list = activeTrainsAt(d, cursor);
      list.sort((a, b) => b.delay - a.delay);
      setTrains(list);
    }, TRAINS_MS);
    onCleanup(() => clearInterval(id));
  });

  // Event feed.
  onMount(() => {
    const id = setInterval(() => {
      const d = data();
      if (!d) return;
      setEvents(eventsAround(d, cursor, EVENT_LOOKBACK_MS, 40));
    }, EVENTS_MS);
    onCleanup(() => clearInterval(id));
  });

  const onScrub = (v: number) => {
    seek(v);
  };

  const restart = () => {
    const d = data();
    if (!d) return;
    seek(d.minMs);
    setPlaying(true);
  };

  // Pick a specific run: select it and, if it is not on the rails at the
  // current instant, jump to its departure so it becomes visible.
  const selectRun = (runId: number | null) => {
    setSelected(runId);
    if (runId == null) return;
    const d = data();
    if (!d) return;
    const r = d.runs.find((x) => x.runId === runId);
    if (r && (cursor < r.startMs || cursor > r.endMs)) {
      seek(Math.max(d.minMs, r.startMs));
      setPlaying(true);
    }
  };

  const inRitardo = () =>
    trains().filter(
      (t) => t.stato === "delayed" || t.stato === "heavily-delayed",
    ).length;
  const countStato = (stato: string) =>
    trains().filter((t) => t.stato === stato).length;
  const topTrains = () => trains().slice(0, TOP_TRAINS);

  return (
    <main>
      <Seo
        title={pageTitle("Replay — un giorno di treni in 3D")}
        description="Rivedi un'intera giornata di treni sulla mappa 3D dell'Italia: riproduzione a velocità aumentata, orario e aggiornamenti in tempo reale."
        path="/replay"
      />

      <div class="relative h-[calc(100dvh-57px)] overflow-hidden border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#09090b]">
        <LiveMap3D
          trains={trains()}
          showTracks
          showStations
          fullscreen
          clock={clock}
          recolorTracks={false}
          feed={feed()}
          selectedRunId={selected()}
          onSelect={(t) => setSelected(t?.runId ?? null)}
          renderHud={(tr, close) => <TrainHud train={tr} onClose={close} />}
        />
        <DitherOverlay animated={false} amount={1.1} />

        {/* Clock (top center) */}
        <div class="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2">
          <div class="flex items-baseline gap-2 rounded border border-zinc-300 bg-white/85 px-3 py-1.5 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/85">
            <span class="text-2xl font-bold tabular-nums leading-none">
              {data() ? fmtTimeSec(iso()) : "--:--:--"}
            </span>
            <span class="text-xs text-zinc-500">{fmtDateEU(date())}</span>
            <span class="flex items-baseline gap-1 border-l border-zinc-300 pl-2 dark:border-zinc-700">
              <span class="text-lg font-bold tabular-nums leading-none">
                {trains().length}
              </span>
              <span class="text-[10px] uppercase tracking-wider text-zinc-500">
                in viaggio
              </span>
            </span>
            <span class="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white dark:bg-zinc-100 dark:text-zinc-900">
              {speed()}×
            </span>
          </div>
        </div>

        {/* Counts (bottom left) */}
        <div class="pointer-events-none absolute bottom-3 left-3 z-30 hidden w-40 rounded border border-zinc-300 bg-white/85 px-3 py-2 text-[11px] shadow-lg backdrop-blur sm:block dark:border-zinc-700 dark:bg-zinc-900/85">
          <div class="flex items-baseline gap-1.5">
            <span class="text-base font-bold tabular-nums">
              {trains().length}
            </span>
            <span class="text-zinc-500">in viaggio</span>
          </div>
          <div class="mt-0.5 tabular-nums text-[10px] text-zinc-500">
            {inRitardo()} in ritardo
          </div>
          <div class="mt-1.5 flex flex-col gap-0.5">
            <For each={LIVE_LEGEND}>
              {(l) => (
                <span class="inline-flex items-center gap-1.5 tabular-nums">
                  <span
                    aria-hidden="true"
                    class="inline-block size-2 shrink-0 rounded-full"
                    style={{ background: statoColor(l.stato) }}
                  />
                  <span class="text-zinc-500">{l.label}</span>
                  <span class="ml-auto">{countStato(l.stato)}</span>
                </span>
              )}
            </For>
          </div>
        </div>

        {/* Transport controls (bottom center) */}
        <div class="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center px-3">
          <div class="pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded border border-zinc-300 bg-white/90 px-3 py-2 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/90">
            <button
              type="button"
              onClick={restart}
              aria-label="torna all'inizio della giornata"
              class="shrink-0 rounded border border-zinc-300 px-2 py-1 text-zinc-600 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-white"
            >
              ⏮
            </button>
            <button
              type="button"
              onClick={() => setPlaying(!playing())}
              aria-label={playing() ? "pausa" : "riproduci"}
              class="shrink-0 rounded border border-zinc-300 px-2.5 py-1 font-bold text-zinc-800 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-100"
            >
              {playing() ? "❚❚" : "▶"}
            </button>
            <input
              type="range"
              min={data()?.minMs ?? 0}
              max={data()?.maxMs ?? 1}
              step={1000}
              value={cursorMs()}
              onInput={(e) => onScrub(Number(e.currentTarget.value))}
              aria-label="posizione nella giornata"
              class="h-1 min-w-0 flex-1 cursor-pointer accent-zinc-900 dark:accent-zinc-100"
            />
            <div class="flex shrink-0 items-center gap-1">
              <For each={SPEEDS}>
                {(s) => (
                  <Chip
                    active={speed() === s}
                    onClick={() => setSpeed(s)}
                    class="tabular-nums"
                  >
                    {s}×
                  </Chip>
                )}
              </For>
            </div>
          </div>
        </div>

        <ReplaySidebar
          days={days()?.days ?? []}
          date={date()}
          onDate={setDate}
          runs={data()?.runs ?? []}
          active={topTrains()}
          total={trains().length}
          events={events()}
          selectedRunId={selected()}
          onSelect={setSelected}
          onSelectRun={selectRun}
          open={sidebarOpen()}
          onToggle={setSidebarOpen}
          loading={loading()}
        />

        {/* Loading / error / empty overlays */}
        <Show when={!data() && loading()}>
          <div class="pointer-events-none absolute inset-0 z-30 grid place-items-center">
            <div class="rounded border border-zinc-300 bg-white/90 px-4 py-3 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/90">
              <Spinner label="carico il giorno" />
            </div>
          </div>
        </Show>
        <Show when={error()}>
          <div class="absolute inset-x-0 top-16 z-30 mx-auto w-fit">
            <ErrorBox message={error() as string} />
          </div>
        </Show>
        <Show
          when={
            days() && days()!.days.length === 0 && !data() && !loading()
          }
        >
          <div class="pointer-events-none absolute inset-x-0 top-16 z-30 mx-auto w-fit">
            <EmptyState>
              {days()?.dbConfigured === false
                ? "DB non configurato."
                : "nessuna giornata registrata"}
            </EmptyState>
          </div>
        </Show>
        <Show when={data() && !loading() && trains().length === 0}>
          <div class="pointer-events-none absolute inset-x-0 top-16 z-30 mx-auto w-fit">
            <EmptyState>
              {data()?.dbConfigured === false
                ? "DB non configurato."
                : "nessun treno in viaggio a questo orario"}
            </EmptyState>
          </div>
        </Show>
      </div>
    </main>
  );
}

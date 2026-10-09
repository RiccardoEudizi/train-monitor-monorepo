import { createAsync, revalidate } from "@solidjs/router";
import type { RouteDefinition } from "@solidjs/router";
import {
  createEffect,
  createSignal,
  ErrorBoundary,
  For,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from "solid-js";
import DitherOverlay from "~/components/map/DitherOverlay";
import ChoroplethMap from "~/components/map/ChoroplethMap";
import LiveMap3D from "~/components/map/LiveMap3D";
import TrainHud from "~/components/map/TrainHud";
import Seo from "~/components/Seo";
import {
  Card,
  Chip,
  EmptyState,
  ErrorBox,
  SectionTitle,
  Spinner,
} from "~/components/ui";
import type { StatsPeriod, TrainStato } from "~/lib/api-types";
import { fmtTimeSec } from "~/lib/format";
import { CHORO_LEGEND, LIVE_LEGEND, statoColor } from "~/lib/map/colors";
import type { LiveCounts, LiveTrain } from "~/lib/map/interpolate";
import { POLL_MS as LIVE_POLL_MS } from "~/lib/map/interpolate";
import { getMapRegionsQuery } from "~/lib/queries";
import { pageTitle } from "~/lib/seo";

export const route = {
  preload: () => getMapRegionsQuery("30d"),
} satisfies RouteDefinition;

/** Fullscreen (expand) icon. */
function ExpandIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M8 3H3v5" />
      <path d="M16 3h5v5" />
      <path d="M8 21H3v-5" />
      <path d="M16 21h5v-5" />
    </svg>
  );
}

/** Exit-fullscreen (compress) icon. */
function CompressIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8h5V3" />
      <path d="M21 8h-5V3" />
      <path d="M3 16h5v5" />
      <path d="M21 16h-5v5" />
    </svg>
  );
}

export default function MapPage() {
  const [period, setPeriod] = createSignal<StatsPeriod>("30d");
  const regions = createAsync(() => getMapRegionsQuery(period()), {
    deferStream: true,
  });

  // Live trains: client poll, never SSR (three.js + clock only on mount).
  const [trains, setTrains] = createSignal<LiveTrain[]>([]);
  const [liveAt, setLiveAt] = createSignal<string | null>(null);
  const [liveOk, setLiveOk] = createSignal(true);
  // Counts come from the same response as the dots (server-side tally of the
  // very array we render), so the header can't drift from what is drawn.
  const [counts, setCounts] = createSignal<LiveCounts | null>(null);

  // Toggle visibility of railway tracks and station markers
  const [showTracks, setShowTracks] = createSignal(true);
  const [showStations, setShowStations] = createSignal(true);

  // Fullscreen + train inspection (3D map only).
  const [fullscreen, setFullscreen] = createSignal(false);
  const [selected, setSelected] = createSignal<LiveTrain | null>(null);

  const toggleFullscreen = () => {
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => {
        skipTransition?: () => void;
        ready?: Promise<void>;
        updateCallbackDone?: Promise<void>;
        finished?: Promise<void>;
      };
    };
    const apply = () => setFullscreen((v) => !v);
    // View Transitions API morphs the card between its inline box and the
    // full-viewport overlay.
    if (typeof doc.startViewTransition === "function") {
      const vt = doc.startViewTransition(apply);
      // A skipped/aborted transition rejects these; ignore them.
      vt.ready?.catch(() => {});
      vt.updateCallbackDone?.catch(() => {});
      vt.finished?.catch(() => {});
      // Safety net: a stalled transition (the WebGL canvas repaints while the
      // browser is capturing snapshots) must never leave the page stuck showing
      // the old snapshot. Skip to the end if it hasn't finished promptly.
      window.setTimeout(() => {
        try {
          vt.skipTransition?.();
        } catch {
          /* already finished */
        }
      }, 650);
    } else {
      apply();
    }
  };

  // Leaving fullscreen drops the selection + releases the body scroll lock.
  createEffect(() => {
    const fs = fullscreen();
    if (typeof document !== "undefined") {
      document.body.style.overflow = fs ? "hidden" : "";
    }
    if (!fs) setSelected(null);
  });

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selected()) setSelected(null);
      else if (fullscreen()) toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    });
  });

  onMount(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = async () => {
      try {
        const r = await fetch("/api/map/live");
        if (!r.ok) throw new Error(`http ${r.status}`);
        const j = (await r.json()) as {
          trains: LiveTrain[];
          counts: LiveCounts;
          updatedAt: string;
        };
        setTrains(j.trains ?? []);
        setCounts(j.counts ?? null);
        setLiveAt(j.updatedAt ?? new Date().toISOString());
        setLiveOk(true);
      } catch {
        setLiveOk(false);
      }
    };
    void tick();
    timer = setInterval(tick, LIVE_POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  const worst = () => regions.latest?.regions[0] ?? null;
  const liveCount = (stato: string) =>
    counts()?.byStato[stato as TrainStato] ?? 0;
  const liveTotal = () => counts()?.total ?? trains().length;

  return (
    <main class="mx-auto max-w-5xl px-4 pb-16">
      <Seo
        title={pageTitle("Mappa ritardi e treni live")}
        description="Due mappe stilizzate dell'Italia: ritardi per regione nel periodo e treni in viaggio in tempo reale."
        path="/map"
      />
      <section class="py-8">
        <p class="text-xs uppercase tracking-[0.25em] text-zinc-500">
          mappa · italia · live
        </p>
        <h1 class="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          L'Italia dei ritardi<span class="text-zinc-500">, in diretta.</span>
        </h1>
        <div class="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <For each={["1d", "7d", "30d", "total"] as const}>
            {(p) => (
              <Chip
                active={period() === p}
                onClick={() => {
                  setPeriod(p);
                  revalidate(getMapRegionsQuery.key);
                }}
                class="uppercase tracking-widest"
              >
                {p === "total" ? "tot" : p}
              </Chip>
            )}
          </For>
        </div>
      </section>

      <div class="grid gap-4 lg:grid-cols-2">
        {/* map 1 — choropleth (custom SVG, hover popup) */}
        <Card>
          <SectionTitle
            right={
              <Show when={worst()} fallback={<span>—</span>}>
                <span>
                  peggio: {(worst() as NonNullable<ReturnType<typeof worst>>).name} +
                  {(worst() as NonNullable<ReturnType<typeof worst>>).avgDelay}'
                </span>
              </Show>
            }
          >
            ritardi per regione · {period()}
          </SectionTitle>
          <ErrorBoundary
            fallback={<ErrorBox message="mappa regioni non disponibile" />}
          >
            <Suspense fallback={<Spinner label="caricamento mappa" />}>
              <Show
                when={(regions.latest?.regions ?? []).length > 0}
                fallback={
                  <EmptyState>
                    {regions.latest && !regions.latest.dbConfigured
                      ? "DB non configurato — nessuna statistica."
                      : "Nessuna corsa nel periodo selezionato."}
                  </EmptyState>
                }
              >
                <ChoroplethMap regions={regions.latest?.regions ?? []} />
                <div class="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                  <For each={CHORO_LEGEND}>
                    {(l) => (
                      <span class="inline-flex items-center gap-1">
                        <span
                          aria-hidden="true"
                          class="inline-block size-2 rounded-sm"
                          style={{ background: l.color }}
                        />
                        {l.label}
                      </span>
                    )}
                  </For>
                </div>
                <p class="mt-2 text-[11px] leading-relaxed text-zinc-500">
                  media per corsa nel periodo · regione dall'ultimo
                  rilevamento · ranking per cumulato
                </p>
              </Show>
            </Suspense>
          </ErrorBoundary>
        </Card>

        {/* map 2 — live trains */}
        <Card>
          <SectionTitle
            right={
              <span class="tabular-nums">
                {liveTotal()} in viaggio
                {liveAt() ? ` · ${fmtTimeSec(liveAt())}` : ""}
              </span>
            }
          >
            treni live
          </SectionTitle>
          <div
            class={`live-map-vt overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#09090b] ${
              fullscreen()
                ? "fixed inset-0 z-50 h-screen w-screen rounded-none border-0"
                : "relative aspect-[360/440] rounded"
            }`}
          >
            <LiveMap3D
              trains={trains()}
              showTracks={showTracks()}
              showStations={showStations()}
              fullscreen={fullscreen()}
              selectedRunId={selected()?.runId ?? null}
              onSelect={(t) => setSelected(t)}
              renderHud={(tr, close) => <TrainHud train={tr} onClose={close} />}
            />
            <DitherOverlay animated={false} amount={1.1} />
            {/* Permanent live-counts HUD (full-screen only). */}
            <Show when={fullscreen()}>
              <div class="pointer-events-none absolute left-3 top-3 z-40 w-48 rounded border border-zinc-300 bg-white/85 px-3 py-2 text-[11px] shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/85">
                <div class="mb-1.5">
                  <div class="flex items-baseline gap-1.5">
                    <span class="text-base font-bold tabular-nums">
                      {liveTotal()}
                    </span>
                    <span class="text-zinc-500">in viaggio</span>
                  </div>
                  <Show when={liveAt()}>
                    <div class="tabular-nums text-[10px] text-zinc-500">
                      aggiornato {fmtTimeSec(liveAt() as string)}
                    </div>
                  </Show>
                </div>
                <div class="flex flex-col gap-0.5">
                  <For each={LIVE_LEGEND}>
                    {(l) => (
                      <span class="inline-flex items-center gap-1.5 tabular-nums">
                        <span
                          aria-hidden="true"
                          class="inline-block size-2 shrink-0 rounded-full"
                          style={{ background: statoColor(l.stato) }}
                        />
                        <span class="text-zinc-500">{l.label}</span>
                        <span class="ml-auto">
                          {liveCount(l.stato)}
                        </span>
                      </span>
                    )}
                  </For>
                </div>
              </div>
            </Show>
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen() ? "esci da schermo intero" : "schermo intero"}
              class="absolute right-2 top-2 z-40 rounded border border-zinc-300 bg-white/80 p-1.5 text-zinc-600 backdrop-blur transition-colors hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:text-white"
            >
              {fullscreen() ? <CompressIcon /> : <ExpandIcon />}
            </button>
            <Show when={trains().length === 0}>
              <p class="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11px] text-zinc-500">
                {liveOk()
                  ? "nessun treno in viaggio rilevato"
                  : "live non disponibile — riprovo…"}
              </p>
            </Show>
          </div>
          <div class="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
            <For each={LIVE_LEGEND}>
              {(l) => (
                <span class="inline-flex items-center gap-1 tabular-nums">
                  <span
                    aria-hidden="true"
                    class="inline-block size-2 rounded-full"
                    style={{ background: statoColor(l.stato) }}
                  />
                  {l.label} · {liveCount(l.stato)}
                </span>
              )}
            </For>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <Chip active={showTracks()} onClick={() => setShowTracks(!showTracks())}>
              binari
            </Chip>
            <Chip active={showStations()} onClick={() => setShowStations(!showStations())}>
              fermate
            </Chip>
          </div>
          <p class="mt-2 text-[11px] leading-relaxed text-zinc-500">
            posizione interpolata tra ultima e prossima fermata ·
            aggiornamento ogni 12s · confini ISTAT via openpolis (CC-BY 4.0) ·
            binari OSM (ODbL 1.0)
          </p>
        </Card>
      </div>
    </main>
  );
}

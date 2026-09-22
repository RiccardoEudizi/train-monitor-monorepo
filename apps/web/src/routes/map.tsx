import { createAsync, revalidate } from "@solidjs/router";
import type { RouteDefinition } from "@solidjs/router";
import {
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
import Seo from "~/components/Seo";
import {
  Card,
  Chip,
  EmptyState,
  ErrorBox,
  SectionTitle,
  Spinner,
} from "~/components/ui";
import type { StatsPeriod } from "~/lib/api-types";
import { fmtTimeSec } from "~/lib/format";
import { CHORO_LEGEND, LIVE_LEGEND, statoColor } from "~/lib/map/colors";
import type { LiveTrain } from "~/lib/map/interpolate";
import { POLL_MS as LIVE_POLL_MS } from "~/lib/map/interpolate";
import { getMapRegionsQuery } from "~/lib/queries";
import { pageTitle } from "~/lib/seo";

export const route = {
  preload: () => getMapRegionsQuery("30d"),
} satisfies RouteDefinition;

export default function MapPage() {
  const [period, setPeriod] = createSignal<StatsPeriod>("30d");
  const regions = createAsync(() => getMapRegionsQuery(period()), {
    deferStream: true,
  });

  // Live trains: client poll, never SSR (three.js + clock only on mount).
  const [trains, setTrains] = createSignal<LiveTrain[]>([]);
  const [liveAt, setLiveAt] = createSignal<string | null>(null);
  const [liveOk, setLiveOk] = createSignal(true);
  onMount(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = async () => {
      try {
        const r = await fetch("/api/map/live");
        if (!r.ok) throw new Error(`http ${r.status}`);
        const j = (await r.json()) as {
          trains: LiveTrain[];
          updatedAt: string;
        };
        setTrains(j.trains ?? []);
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
    trains().filter((t) => t.stato === stato).length;

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
                {trains().length} in viaggio
                {liveAt() ? ` · ${fmtTimeSec(liveAt())}` : ""}
              </span>
            }
          >
            treni live
          </SectionTitle>
          <div class="relative aspect-[360/440] overflow-hidden rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#09090b]">
            <LiveMap3D trains={trains()} />
            <DitherOverlay animated={false} amount={1.1} />
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
          <p class="mt-2 text-[11px] leading-relaxed text-zinc-500">
            posizione interpolata tra ultima e prossima fermata ·
            aggiornamento ogni 12s · confini ISTAT via openpolis (CC-BY 4.0)
          </p>
        </Card>
      </div>
    </main>
  );
}

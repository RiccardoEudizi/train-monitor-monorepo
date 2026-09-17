import { A, createAsync, revalidate } from "@solidjs/router";
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
import {
  AsciiGauge,
  AsciiHBars,
  AsciiTrend,
  Card,
  Chip,
  EmptyState,
  ErrorBox,
  Field,
  LiveDot,
  SectionTitle,
  ShimmerList,
  Spinner,
  TrainRow,
} from "~/components/ui";
import { AsciiFx, PixelValue } from "~/components/fx";
import type { StationItem, StatsPeriod } from "~/lib/api-types";
import { getDelaysQuery, getNewsQuery, getOverviewQuery } from "~/lib/queries";
import { useLive } from "~/lib/sse";

export const route = {
  preload: () =>
    Promise.allSettled([
      getDelaysQuery(1, "", 20),
      getNewsQuery(),
      getOverviewQuery("30d"),
    ]),
} satisfies RouteDefinition;

export default function Home() {
  const [stationQ, setStationQ] = createSignal("");
  const [trainN, setTrainN] = createSignal("");
  const [matches, setMatches] = createSignal<StationItem[]>([]);

  // Debounced autocomplete. Effect-only → never runs during SSR,
  // so server and hydrated HTML always agree (empty list).
  createEffect(() => {
    const q = stationQ();
    const t = setTimeout(async () => {
      const query = q.trim();
      if (query.length < 2) {
        setMatches([]);
        return;
      }
      try {
        const r = await fetch(`/api/stations?q=${encodeURIComponent(query)}`);
        if (r.ok) {
          setMatches(
            ((await r.json()) as { stations: StationItem[] }).stations,
          );
        }
      } catch {
        /* keep previous matches */
      }
    }, 300);
    return () => clearTimeout(t);
  });

  const delays = createAsync(() => getDelaysQuery(1, "", 20), {
    deferStream: true,
  });
  const news = createAsync(() => getNewsQuery(), { deferStream: true });

  // Panoramica nazionale con filtri come /treno/: 1d / 7d / 30d / total.
  const [ovPeriod, setOvPeriod] = createSignal<StatsPeriod>("30d");

  // Trend rows follow the md breakpoint: 4 rows on mobile so the chart
  // matches the text column height beside it, 7 rows stacked on md+.
  // Mount-only → SSR renders the mobile variant, desktop upgrades on hydrate.
  const [isDesktop, setIsDesktop] = createSignal(false);
  onMount(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    onCleanup(() => mq.removeEventListener("change", onChange));
  });
  const overview = createAsync(() => getOverviewQuery(ovPeriod()), {
    deferStream: true,
  });

  // `createAsync` doesn't expose the underlying resource state, so track
  // fetching manually: set on period pick / live revalidate, cleared when
  // `overview.latest` reference changes (new payload resolved).
  // Effect-only → never runs during SSR, so SSR HTML has no spinner.
  const [ovPending, setOvPending] = createSignal(false);
  let ovSeen: unknown = undefined;
  let ovSeenInit = false;
  const markOvFetching = () => setOvPending(true);
  const pickOvPeriod = (p: StatsPeriod) => {
    if (p === ovPeriod()) return;
    markOvFetching();
    setOvPeriod(p);
  };
  createEffect(() => {
    const cur = overview.latest;
    if (!ovSeenInit) {
      ovSeenInit = true;
      ovSeen = cur;
      if (cur === undefined) setOvPending(true);
      return;
    }
    if (cur !== ovSeen) {
      ovSeen = cur;
      setOvPending(false);
    }
  });

  // Global live feed → revalidate queries on change.
  const live = useLive({
    url: "/api/live",
    onMessage: (msg) => {
      if (msg.heartbeat) return;
      markOvFetching();
      revalidate(getDelaysQuery.key);
      revalidate(getNewsQuery.key);
      revalidate(getOverviewQuery.key);
    },
  });

  return (
    <main class="mx-auto max-w-5xl px-4 pb-16">
      {/* hero */}
      <section class="py-8">
        <p class="text-xs uppercase tracking-[0.25em] text-zinc-500">
          ritardi treni · italia · live
        </p>
        <h1 class="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Tutti i ritardi,
          <span class="text-zinc-500"> in tempo reale.</span>
        </h1>
        <div class="mt-4 flex flex-wrap items-center gap-4 text-sm tabular-nums">
          <ErrorBoundary fallback={<ErrorBox message="contatori non disponibili" />}>
            <Suspense fallback={<Spinner label="loading" />}>
              <Show when={delays()}>
                <span>
                  <span class="text-2xl font-bold">
                    <PixelValue value={`${delays()?.totalCircolanti ?? 0}`}>
                      {delays()?.totalCircolanti ?? 0}
                    </PixelValue>
                  </span>{" "}
                  <span class="text-zinc-500">treni circolanti</span>
                </span>
                <span>
                  <span class="text-2xl font-bold">
                    <PixelValue value={`${delays()?.items.length ?? 0}`}>
                      {delays()?.items.length ?? 0}
                    </PixelValue>
                  </span>{" "}
                  <span class="text-zinc-500">in ritardo ora</span>
                </span>
              </Show>
            </Suspense>
          </ErrorBoundary>
          <span class="ml-auto">
            <LiveDot connected={live.connected()} />
          </span>
        </div>
        <ErrorBoundary fallback={<></>}>
          <Suspense>
            <Show when={(news()?.ticker ?? []).length > 0}>
              <p class="mt-3 border-l-2 border-amber-400 pl-3 text-xs text-zinc-500">
                {(news()?.ticker ?? []).join(" · ")}
              </p>
            </Show>
          </Suspense>
        </ErrorBoundary>
      </section>

      {/* overview stats — above search */}
      <Card class="mt-2">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            panoramica ritardi · {ovPeriod()}
          </h2>
          <div class="flex items-center gap-2 text-xs">
            {/* Fetch indicator: same box as the day chips (transparent
                border) + fixed inner width, so idle and spinning states
                occupy identical space — true shim, zero shift. Mobile:
                spinner after the chips; sm+: spinner before them. */}
            <span
              class="inline-flex order-last items-center justify-center rounded border border-transparent px-2 py-1 text-zinc-400 sm:order-first"
              role="status"
              aria-label={ovPending() ? "caricamento statistiche" : undefined}
            >
              <Show
                when={ovPending()}
                fallback={
                  <span
                    class="inline-block w-3 text-center text-[11px] invisible"
                    aria-hidden="true"
                  >
                    ⠋
                  </span>
                }
              >
                <Spinner slim />
              </Show>
            </span>
            <For each={["1d", "7d", "30d", "total"] as const}>
              {(p) => (
                <Chip
                  active={ovPeriod() === p}
                  onClick={() => pickOvPeriod(p)}
                  class="uppercase tracking-widest"
                >
                  {p === "total" ? "tot" : p}
                </Chip>
              )}
            </For>
          </div>
        </div>
        <ErrorBoundary
          fallback={<ErrorBox message="statistiche non disponibili" />}
        >
          {/* Empty state: only when resolved data says 0 runs. */}
          <Show
            when={
              overview.latest && (overview.latest.national.runs ?? 0) === 0
            }
          >
            <EmptyState>
              {overview.latest && !overview.latest.dbConfigured
                ? "DB non configurato — nessuna statistica."
                : "Nessuna corsa nel periodo selezionato."}
            </EmptyState>
          </Show>
          {/* Main grid: reads `.latest` only → never suspends, never shows
              skeletons. Period switches keep old data visible, then
              PixelValue / AsciiFx animate old → new. */}
          <Show
            when={
              !overview.latest || (overview.latest.national.runs ?? 0) > 0
            }
          >
            <div class="grid gap-4 md:grid-cols-3">
              <div>
                <p class="text-[11px] uppercase tracking-widest text-zinc-500">
                  media nazionale ritardi
                </p>
                {/* Mobile: text left, chart right. md+: contents → stacks as before. */}
                <div class="flex items-center justify-between gap-3 md:contents">
                  <div class="min-w-0">
                    <p class="mt-1 min-h-9 text-3xl font-bold tabular-nums">
                      <PixelValue
                        value={`+${overview.latest?.national.avgFinal ?? 0}'`}
                      >
                        +{overview.latest?.national.avgFinal ?? 0}'
                      </PixelValue>
                    </p>
                    <p class="mt-1 min-h-4 text-xs tabular-nums text-zinc-500">
                      su{" "}
                      <PixelValue
                        value={`${overview.latest?.national.runs ?? 0}`}
                      >
                        {overview.latest?.national.runs ?? 0}
                      </PixelValue>{" "}
                      corse · max{" "}
                      <PixelValue
                        value={`+${overview.latest?.national.maxFinal ?? 0}'`}
                      >
                        +{overview.latest?.national.maxFinal ?? 0}'
                      </PixelValue>
                    </p>
                  </div>
                  <div class="min-w-0 flex-1 md:mt-2 md:min-h-[86px]">
                    <AsciiFx
                      watch={(overview.latest?.national.series ?? [])
                        .map((s) => s.avgFinal)
                        .join(",")}
                    >
                      <AsciiTrend
                        values={(overview.latest?.national.series ?? []).map(
                          (s) => s.avgFinal,
                        )}
                        height={isDesktop() ? 7 : 4}
                        label="trend media giornaliera ritardi"
                      />
                    </AsciiFx>
                  </div>
                </div>
              </div>
              <div>
                <p class="text-[11px] uppercase tracking-widest text-zinc-500">
                  regione con più ritardo
                </p>
                <div class="min-h-[92px]">
                  <Show
                    when={overview.latest?.worstRegion}
                    fallback={
                      <p class="mt-1 text-sm text-zinc-500">
                        — nessuna attribuzione regionale
                      </p>
                    }
                  >
                    <p class="mt-1 truncate text-2xl font-bold">
                      <PixelValue
                        value={overview.latest?.worstRegion?.name ?? ""}
                      >
                        {overview.latest?.worstRegion?.name}
                      </PixelValue>
                    </p>
                    <div class="mt-1 flex flex-col gap-1 text-xs tabular-nums text-zinc-500">
                      <span>
                        cumulato{" "}
                        <span class="font-bold text-zinc-700 dark:text-zinc-300">
                          <PixelValue
                            value={`+${overview.latest?.worstRegion?.totalDelay ?? 0}'`}
                          >
                            +{overview.latest?.worstRegion?.totalDelay ?? 0}'
                          </PixelValue>
                        </span>
                      </span>
                      <span>
                        max{" "}
                        <span class="font-bold text-zinc-700 dark:text-zinc-300">
                          <PixelValue
                            value={`+${overview.latest?.worstRegion?.maxDelay ?? 0}'`}
                          >
                            +{overview.latest?.worstRegion?.maxDelay ?? 0}'
                          </PixelValue>
                        </span>
                        {" · "}media{" "}
                        <span class="font-bold text-zinc-700 dark:text-zinc-300">
                          <PixelValue
                            value={`+${overview.latest?.worstRegion?.avgDelay ?? 0}'`}
                          >
                            +{overview.latest?.worstRegion?.avgDelay ?? 0}'
                          </PixelValue>
                        </span>
                      </span>
                      <span>
                        <span class="font-bold text-zinc-700 dark:text-zinc-300">
                          <PixelValue
                            value={`${overview.latest?.worstRegion?.delayedCount ?? 0}`}
                          >
                            {overview.latest?.worstRegion?.delayedCount ?? 0}
                          </PixelValue>
                        </span>{" "}
                        treni in ritardo su{" "}
                        <PixelValue
                          value={`${overview.latest?.worstRegion?.runs ?? 0}`}
                        >
                          {overview.latest?.worstRegion?.runs ?? 0}
                        </PixelValue>{" "}
                        corse
                      </span>
                    </div>
                  </Show>
                </div>
              </div>
              <div>
                <p class="text-[11px] uppercase tracking-widest text-zinc-500">
                  incidenza ritardi
                </p>
                {/* Mobile: text left, chart right. md+: contents → stacks as before. */}
                <div class="flex items-center justify-between gap-3 md:contents">
                  <div class="min-w-0">
                    <p class="mt-1 min-h-9 text-3xl font-bold tabular-nums">
                      <PixelValue
                        value={`${overview.latest?.national.delayedRate ?? 0}%`}
                      >
                        {overview.latest?.national.delayedRate ?? 0}%
                      </PixelValue>
                    </p>
                  </div>
                  <div class="min-w-0 flex-1 md:mt-2">
                    <AsciiFx
                      watch={`${overview.latest?.national.delayedRate ?? 0}`}
                    >
                      <AsciiGauge
                        pct={overview.latest?.national.delayedRate ?? 0}
                      />
                    </AsciiFx>
                  </div>
                </div>
                <div class="min-h-4">
                  <p class="mt-1 text-xs tabular-nums text-zinc-500">
                    <PixelValue
                      value={`${overview.latest?.national.delayedCount ?? 0}`}
                    >
                      {overview.latest?.national.delayedCount ?? 0}
                    </PixelValue>{" "}
                    in ritardo (&gt;0') su{" "}
                    <PixelValue value={`${overview.latest?.national.runs ?? 0}`}>
                      {overview.latest?.national.runs ?? 0}
                    </PixelValue>{" "}
                    totali
                  </p>
                </div>
              </div>
            </div>
            <Show when={(overview.latest?.regions ?? []).length > 1}>
              <div class="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <p class="mb-2 text-[11px] uppercase tracking-widest text-zinc-500">
                  top regioni per ritardo cumulato
                </p>
                <AsciiHBars
                  rows={(overview.latest?.regions ?? []).map((r) => ({
                    label: r.name,
                    value: r.totalDelay,
                    suffix: "'",
                  }))}
                />
              </div>
            </Show>
            <p class="mt-3 text-[11px] leading-relaxed text-zinc-500">
              soglia ritardo &gt;0' · regione dall'ultimo rilevamento di
              ogni corsa · ranking per somma cumulata nel periodo
            </p>
          </Show>
        </ErrorBoundary>
      </Card>

      {/* search */}
      <section class="mt-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <SectionTitle>cerca stazione</SectionTitle>
          <Field
            value={stationQ()}
            onInput={setStationQ}
            placeholder="es. Milano Centrale"
            label="cerca stazione"
          />
          <div class="mt-2 flex flex-col gap-1">
            <For each={matches()}>
              {(s) => (
                <A
                  href={`/stazione/${s.code}`}
                  class="rounded px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  <span class="font-bold">{s.name}</span>
                  <span class="ml-2 text-xs text-zinc-500">{s.code}</span>
                </A>
              )}
            </For>
          </div>
        </Card>
        <Card>
          <SectionTitle>cerca treno</SectionTitle>
          <form
            class="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = trainN().trim();
              if (n) window.location.href = `/treno/${encodeURIComponent(n)}`;
            }}
          >
            <Field
              value={trainN()}
              onInput={setTrainN}
              placeholder="es. 9583"
              inputmode="numeric"
              label="cerca treno per numero"
            />
            <button
              type="submit"
              aria-label="vai al treno"
              class="rounded bg-zinc-900 px-4 py-2 text-sm font-bold text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <p class="mt-3 text-xs leading-relaxed text-zinc-500">
            Inserisci il numero del treno per vedere fermate, ritardo per
            stazione e storico 24h / 30d / all.
          </p>
        </Card>
      </section>

      {/* top delays */}
      <section class="mt-8">
        <SectionTitle
          right={
            <A href="/ritardi" class="hover:underline">
              tutti →
            </A>
          }
        >
          peggiori ritardi ora
        </SectionTitle>
        <ErrorBoundary fallback={<ErrorBox message="ranking non disponibile" />}>
          <Suspense fallback={<ShimmerList rows={8} />}>
            <Show
              when={(delays()?.items ?? []).length > 0}
              fallback={
                <EmptyState>
                  Nessun ritardo sopra 1 min al momento — o DB non ancora popolato.
                </EmptyState>
              }
            >
              <div class="flex flex-col gap-2">
                <For each={delays()?.items ?? []}>{(t) => <TrainRow t={t} />}</For>
              </div>
            </Show>
          </Suspense>
        </ErrorBoundary>
      </section>
    </main>
  );
}

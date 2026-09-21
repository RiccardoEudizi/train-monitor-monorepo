import { A, createAsync, revalidate, useParams, useSearchParams } from "@solidjs/router";
import { clientOnly } from "@solidjs/start";
import type { RouteDefinition } from "@solidjs/router";
import { createMemo, createSignal, ErrorBoundary, For, Show, Suspense } from "solid-js";
import {
  Card,
  Chip,
  DelayBadge,
  EmptyState,
  ErrorBox,
  SectionTitle,
  Shimmer,
  ShimmerList,
  TrainStatus,
} from "~/components/ui";
import { AsciiFx, PixelValue } from "~/components/fx";
import Seo from "~/components/Seo";
import { delayClass, fmtDateEU, fmtTime } from "~/lib/format";
import { getStatsQuery, getTrainQuery } from "~/lib/queries";
import { pageTitle, SITE_NAME } from "~/lib/seo";
import { useLive } from "~/lib/sse";

// Client-only Chart.js chart (canvas needs DOM; see routes/index.tsx).
const TrendChart = clientOnly(() => import("~/components/charts/TrendChart"));

export const route = {
  preload: ({ params }: { params: Record<string, string | undefined> }) => {
    const numero = (params.numero ?? "").trim();
    return Promise.allSettled([
      getTrainQuery(numero),
      getStatsQuery("train", numero, "30d"),
    ]);
  },
} satisfies RouteDefinition;

type Period = "24h" | "7d" | "30d" | "all";

export default function Treno() {
  const params = useParams();
  const [search] = useSearchParams();
  const numero = () => (params.numero ?? "").trim();
  const origine = () => ((search.origine as string | undefined) ?? "").trim().toUpperCase() || undefined;
  const runDate = () => ((search.date as string | undefined) ?? "").trim() || undefined;
  const [period, setPeriod] = createSignal<Period>("30d");
  // "all" goes to the server as-is: train stats read the all-time rollup.
  const statsPeriod = () => period();

  const detail = createAsync(() => getTrainQuery(numero(), origine(), runDate()), {
    deferStream: true,
  });
  const stats = createAsync(
    () => getStatsQuery("train", numero(), statsPeriod()),
    { deferStream: true },
  );

  const periodDays = () =>
    period() === "24h" ? 1 : period() === "7d" ? 7 : period() === "30d" ? 30 : null;

  /** Latest runs filtered by the same time-period selector as the stats. */
  const filteredRuns = createMemo(() => {
    const all = detail()?.runs ?? [];
    const days = periodDays();
    if (days == null) return all;
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    return all.filter((r) => r.dataPartenza >= cutoff);
  });

  useLive({
    url: () => `/api/live?train=${numero()}`,
    onMessage: (msg) => {
      if (msg.heartbeat) return;
      revalidate(getTrainQuery.key);
      revalidate(getStatsQuery.key);
    },
  });

  return (
    <main class="mx-auto max-w-5xl px-4 pb-16">
      <Seo
        title={pageTitle(`Treno ${numero()}`)}
        description={`Treno ${numero()} su ${SITE_NAME}: fermate, ritardo per stazione e storico ritardi. Dati ViaggiaTreno aggiornati dal poller.`}
        path={`/treno/${numero()}`}
      />
      <section class="py-8">
        <p class="text-xs uppercase tracking-[0.25em] text-zinc-500">
          treno · {numero()}
        </p>
        <ErrorBoundary fallback={<h1 class="mt-2 text-3xl font-bold">Treno {numero()}</h1>}>
          <Suspense fallback={<Shimmer class="mt-2 h-10 w-64" />}>
            <Show when={detail()?.live} keyed fallback={
              <>
                <h1 class="mt-2 text-3xl font-bold tracking-tight tabular-nums">
                  {`Treno ${numero()}`}
                </h1>
                <p class="mt-1 text-sm text-zinc-500">
                  nessuna corsa recente trovata
                </p>
              </>
            }>
              {(live) => (
                <>
                  <h1 class="mt-2 text-3xl font-bold tracking-tight tabular-nums">
                    {`${live.categoria} ${live.numero}`}
                  </h1>
                  <p class="mt-1 text-sm text-zinc-500">
                    {`${live.origine} → ${live.destinazione}`}
                  </p>
                </>
              )}
            </Show>
          </Suspense>
        </ErrorBoundary>
      </section>

      {/* live summary */}
      <ErrorBoundary fallback={<></>}>
        <Suspense>
          <Show when={detail()?.live} keyed>
            {(live) => (
            <section class="mb-8 grid gap-4 sm:grid-cols-3">
              <Card>
                <p class="text-[11px] uppercase tracking-widest text-zinc-500">stato</p>
                <p class="mt-1 text-xl font-bold tabular-nums">
                  <TrainStatus
                    temporalStatus={live.temporalStatus ?? "unknown"}
                    delayStato={live.stato}
                  />
                </p>
                <p class="mt-1 text-xs text-zinc-500">
                  partenza prevista {live.orarioPartenza ? fmtTime(live.orarioPartenza) : "—"}
                  {live.orarioArrivo ? ` · arrivo ${fmtTime(live.orarioArrivo)}` : ""}
                </p>
              </Card>
              <Card>
                <p class="text-[11px] uppercase tracking-widest text-zinc-500">ritardo attuale</p>
                <p class="mt-1 text-3xl font-bold tabular-nums">
                  <DelayBadge
                    delay={live.delay}
                    stato={live.stato}
                  />
                </p>
                <p class="mt-1 text-xs text-zinc-500">
                  ultimo rilevamento {live.lastRilevamentoStazione ?? "—"}
                  {live.lastRilevamento
                    ? ` · ${fmtTime(live.lastRilevamento)}`
                    : ""}
                </p>
              </Card>
              <Card>
                <p class="text-[11px] uppercase tracking-widest text-zinc-500">media finale {period()}</p>
                <p class="mt-1 text-3xl font-bold tabular-nums">
                  <PixelValue value={`+${stats()?.avgFinal ?? 0}'`}>
                    +{stats()?.avgFinal ?? 0}'
                  </PixelValue>
                </p>
                <p class="mt-1 text-xs text-zinc-500">
                  su{" "}
                  <PixelValue value={`${stats()?.runs ?? 0}`}>
                    {stats()?.runs ?? 0}
                  </PixelValue>{" "}
                  corse · max{" "}
                  <PixelValue value={`+${stats()?.maxFinal ?? 0}'`}>
                    +{stats()?.maxFinal ?? 0}'
                  </PixelValue>
                </p>
              </Card>
              <Card>
                <p class="text-[11px] uppercase tracking-widest text-zinc-500">recupero medio</p>
                <p class="mt-1 text-3xl font-bold tabular-nums">
                  <PixelValue value={`${stats()?.avgRecupero ?? 0}'`}>
                    {stats()?.avgRecupero ?? 0}'
                  </PixelValue>
                </p>
                <p class="mt-1 text-xs text-zinc-500">
                  p95{" "}
                  <PixelValue value={`+${stats()?.p95Final ?? 0}'`}>
                    +{stats()?.p95Final ?? 0}'
                  </PixelValue>{" "}
                  · canc{" "}
                  <PixelValue value={`${stats()?.cancellRate ?? 0}%`}>
                    {stats()?.cancellRate ?? 0}%
                  </PixelValue>
                </p>
              </Card>
            </section>
            )}
          </Show>
        </Suspense>
      </ErrorBoundary>

      {/* history toggle */}
      <section class="mb-8">
        <div class="mb-3 flex items-center gap-2 text-xs">
          <For each={["24h", "7d", "30d", "all"] as Period[]}>
            {(p) => (
              <Chip
                active={period() === p}
                onClick={() => setPeriod(p)}
                class="uppercase tracking-widest"
              >
                {p}
              </Chip>
            )}
          </For>
          <span class="ml-auto hidden text-zinc-500 sm:inline">
            <ErrorBoundary fallback={<></>}>
              <Suspense>
                <AsciiFx
                  watch={(stats()?.series ?? []).map((s) => s.avgFinal).join(",")}
                >
                  <TrendChart
                    values={(stats()?.series ?? []).map((s) => s.avgFinal)}
                    labels={(stats()?.series ?? []).map((s) => s.date)}
                    height={56}
                    label={`storico ritardi treno ${numero()}`}
                  />
                </AsciiFx>
              </Suspense>
            </ErrorBoundary>
          </span>
        </div>
      </section>

      {/* stops timeline */}
      <section>
        <ErrorBoundary fallback={<></>}>
          <Suspense fallback={<SectionTitle>fermate · ritardo per stazione</SectionTitle>}>
            <SectionTitle
              right={
                <>
                  <PixelValue value={`${detail()?.stops.length ?? 0}`}>
                    {detail()?.stops.length ?? 0}
                  </PixelValue>{" "}
                  fermate
                </>
              }
            >
              fermate · ritardo per stazione
            </SectionTitle>
          </Suspense>
        </ErrorBoundary>
        <ErrorBoundary
          fallback={<ErrorBox message="dettaglio non disponibile" />}
        >
          <Suspense fallback={<ShimmerList rows={12} />}>
            <Show
              when={(detail()?.stops ?? []).length > 0}
              fallback={
                <EmptyState>
                  Nessun dettaglio disponibile — il poller non ha ancora visto
                  questo treno, o la corsa è cancellata (204).
                </EmptyState>
              }
            >
              <div class="flex flex-col">
                <For each={detail()?.stops ?? []}>
                  {(s) => (
                    <div class="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-l border-zinc-200 py-2 pl-4 dark:border-zinc-800">
                      <span class="text-xs tabular-nums text-zinc-500">
                        {fmtTime(s.scheduledArr ?? s.scheduledDep)}
                      </span>
                      <span class="text-sm">
                        <A
                          href={`/stazione/${s.code}`}
                          class="hover:underline"
                        >
                          {s.station}
                        </A>
                        <Show when={s.status === "skipped"}>
                          <span class="ml-2 text-[11px] uppercase text-red-400">
                            soppressa
                          </span>
                        </Show>
                      </span>
                      <span class={`text-sm font-bold tabular-nums ${delayClass(Math.max(s.delayArr, s.delayDep))}`}>
                        <PixelValue
                          value={
                            s.status === "skipped"
                              ? "—"
                              : s.delayArr > 0 || s.delayDep > 0
                                ? `+${Math.max(s.delayArr, s.delayDep)}'`
                                : "ok"
                          }
                        >
                          {s.status === "skipped"
                            ? "—"
                            : s.delayArr > 0 || s.delayDep > 0
                              ? `+${Math.max(s.delayArr, s.delayDep)}'`
                              : "ok"}
                        </PixelValue>
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Suspense>
        </ErrorBoundary>
      </section>

      {/* latest runs — same period filter as stats */}
      <section class="mt-10">
        <ErrorBoundary fallback={<></>}>
          <Suspense fallback={<SectionTitle>ultime corse</SectionTitle>}>
            <SectionTitle
              right={
                <>
                  <PixelValue value={`${filteredRuns().length}`}>
                    {filteredRuns().length}
                  </PixelValue>{" "}
                  corse · {period()}
                </>
              }
            >
              ultime corse · ritardo medio
            </SectionTitle>
          </Suspense>
        </ErrorBoundary>
        <ErrorBoundary fallback={<ErrorBox message="storico corse non disponibile" />}>
          <Suspense fallback={<ShimmerList rows={6} />}>
            <Show
              when={filteredRuns().length > 0}
              fallback={
                <EmptyState>
                  Nessuna corsa nel periodo selezionato.
                </EmptyState>
              }
            >
              <div class="flex flex-col gap-2">
                <For each={filteredRuns()}>
                  {(r) => {
                    // Hot rows match by runId; pruned (rollup-only) rows have
                    // runId null, so match the selected origine/date instead.
                    const selected = () => {
                      const liveId = detail()?.live?.runId;
                      if (liveId != null) return liveId === r.runId;
                      if (r.runId != null) return false;
                      const o = origine(), d = runDate();
                      if (o == null && d == null) return false;
                      return (
                        (o == null || r.origineCode === o) &&
                        (d == null || r.dataPartenza === d)
                      );
                    };
                    return (
                      <A
                        href={`/treno/${numero()}?origine=${encodeURIComponent(r.origineCode)}&date=${encodeURIComponent(r.dataPartenza)}`}
                        class={`grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded border px-3 py-2 transition-colors ${selected() ? "border-zinc-500 dark:border-zinc-400" : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"}`}
                      >
                        <span class="text-xs tabular-nums text-zinc-500">
                          {fmtDateEU(r.dataPartenza)}
                          <span class="ml-2">
                            {fmtTime(r.orarioPartenza)}
                            {r.orarioArrivo ? `–${fmtTime(r.orarioArrivo)}` : ""}
                          </span>
                        </span>
                        <span class="truncate text-sm">
                          {r.origine} → {r.destinazione}
                          <Show when={selected()}>
                            <span class="ml-2 text-[11px] uppercase text-zinc-500">
                              selezionata
                            </span>
                          </Show>
                          <Show when={r.stato === "cancelled"}>
                            <span class="ml-2 text-[11px] uppercase text-red-400">
                              cancellata
                            </span>
                          </Show>
                        </span>
                        <span class="text-right text-sm">
                          <span class={`font-bold tabular-nums ${delayClass(r.avgDelay)}`}>
                            <PixelValue value={r.avgDelay > 0 ? `+${r.avgDelay}'` : "ok"}>
                              {r.avgDelay > 0 ? `+${r.avgDelay}'` : "ok"}
                            </PixelValue>
                          </span>
                          <span class="ml-2 text-[11px] tabular-nums text-zinc-500">
                            media · fin +{r.lastDelay}' · max +{r.maxDelay}'
                          </span>
                        </span>
                      </A>
                    );
                  }}
                </For>
              </div>
            </Show>
          </Suspense>
        </ErrorBoundary>
      </section>
    </main>
  );
}

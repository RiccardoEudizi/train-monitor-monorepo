import { A, createAsync, revalidate, useParams } from "@solidjs/router";
import type { RouteDefinition } from "@solidjs/router";
import { createSignal, ErrorBoundary, For, Show, Suspense } from "solid-js";
import {
  DelayBadge,
  SectionTitle,
  Shimmer,
  ShimmerList,
  Sparkline,
  TrainStatus,
} from "~/components/ui";
import { delayClass, fmtDateEU, fmtTime } from "~/lib/format";
import { displayStatus } from "~/lib/api-types";
import { getStatsQuery, getTrainQuery } from "~/lib/queries";
import { useLive } from "~/lib/sse";

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
  const numero = () => (params.numero ?? "").trim();
  const [period, setPeriod] = createSignal<Period>("30d");
  const statsPeriod = () => (period() === "all" ? "30d" : period());

  const detail = createAsync(() => getTrainQuery(numero()), {
    deferStream: true,
  });
  const stats = createAsync(
    () => getStatsQuery("train", numero(), statsPeriod()),
    { deferStream: true },
  );

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
      <section class="py-8">
        <p class="text-xs uppercase tracking-[0.25em] text-zinc-500">
          treno · {numero()}
        </p>
        <ErrorBoundary fallback={<h1 class="mt-2 text-3xl font-bold">Treno {numero()}</h1>}>
          <Suspense fallback={<Shimmer class="mt-2 h-10 w-64" />}>
            <h1 class="mt-2 text-3xl font-bold tracking-tight tabular-nums">
              {detail()?.live
                ? `${detail()!.live!.categoria} ${detail()!.live!.numero}`
                : `Treno ${numero()}`}
            </h1>
            <p class="mt-1 text-sm text-zinc-500">
              {detail()?.live
                ? `${detail()!.live!.origine} → ${detail()!.live!.destinazione}`
                : "nessuna corsa recente trovata"}
            </p>
            <Show when={(detail()?.candidates ?? []).length > 1}>
              <p class="mt-2 text-xs text-zinc-500">
                {(detail()?.candidates ?? [])
                  .map((c) => `${c.origine} · ${fmtDateEU(c.dataPartenza)}`)
                  .join("  ·  ")}
              </p>
            </Show>
          </Suspense>
        </ErrorBoundary>
      </section>

      {/* live summary */}
      <ErrorBoundary fallback={<></>}>
        <Suspense>
          <Show when={detail()?.live}>
            <section class="mb-8 grid gap-4 sm:grid-cols-3">
              <div class="rounded border border-zinc-200 p-4 dark:border-zinc-800">
                <p class="text-[11px] uppercase tracking-widest text-zinc-500">stato</p>
                <p class="mt-1 text-xl font-bold tabular-nums">
                  <TrainStatus
                    temporalStatus={detail()!.live!.temporalStatus ?? "unknown"}
                    delayStato={detail()!.live!.stato}
                  />
                </p>
                <p class="mt-1 text-xs text-zinc-500">
                  partenza prevista {detail()!.live!.orarioPartenza ? fmtTime(detail()!.live!.orarioPartenza) : "—"}
                  {detail()!.live!.orarioArrivo ? ` · arrivo ${fmtTime(detail()!.live!.orarioArrivo)}` : ""}
                </p>
              </div>
              <div class="rounded border border-zinc-200 p-4 dark:border-zinc-800">
                <p class="text-[11px] uppercase tracking-widest text-zinc-500">ritardo attuale</p>
                <p class="mt-1 text-3xl font-bold tabular-nums">
                  <DelayBadge
                    delay={detail()!.live!.delay}
                    stato={detail()!.live!.stato}
                  />
                </p>
                <p class="mt-1 text-xs text-zinc-500">
                  ultimo rilevamento {detail()!.live!.lastRilevamentoStazione ?? "—"}
                  {detail()!.live!.lastRilevamento
                    ? ` · ${fmtTime(detail()!.live!.lastRilevamento)}`
                    : ""}
                </p>
              </div>
              <div class="rounded border border-zinc-200 p-4 dark:border-zinc-800">
                <p class="text-[11px] uppercase tracking-widest text-zinc-500">media finale {period()}</p>
                <p class="mt-1 text-3xl font-bold tabular-nums">
                  +{stats()?.avgFinal ?? 0}'
                </p>
                <p class="mt-1 text-xs text-zinc-500">
                  su {stats()?.runs ?? 0} corse · max +{stats()?.maxFinal ?? 0}'
                </p>
              </div>
              <div class="rounded border border-zinc-200 p-4 dark:border-zinc-800">
                <p class="text-[11px] uppercase tracking-widest text-zinc-500">recupero medio</p>
                <p class="mt-1 text-3xl font-bold tabular-nums">
                  {stats()?.avgRecupero ?? 0}'
                </p>
                <p class="mt-1 text-xs text-zinc-500">
                  p95 +{stats()?.p95Final ?? 0}' · canc {stats()?.cancellRate ?? 0}%
                </p>
              </div>
            </section>
          </Show>
        </Suspense>
      </ErrorBoundary>

      {/* history toggle */}
      <section class="mb-8">
        <div class="mb-3 flex items-center gap-2 text-xs">
          <For each={["24h", "7d", "30d", "all"] as Period[]}>
            {(p) => (
              <button
                onClick={() => setPeriod(p)}
                class={`rounded border px-2 py-1 uppercase tracking-widest ${period() === p ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 text-zinc-500 dark:border-zinc-700"}`}
              >
                {p}
              </button>
            )}
          </For>
          <span class="ml-auto hidden text-zinc-500 sm:inline">
            <ErrorBoundary fallback={<></>}>
              <Suspense>
                <Sparkline values={(stats()?.series ?? []).map((s) => s.avgFinal)} />
              </Suspense>
            </ErrorBoundary>
          </span>
        </div>
      </section>

      {/* stops timeline */}
      <section>
        <ErrorBoundary fallback={<></>}>
          <Suspense fallback={<SectionTitle>fermate · ritardo per stazione</SectionTitle>}>
            <SectionTitle right={`${detail()?.stops.length ?? 0} fermate`}>
              fermate · ritardo per stazione
            </SectionTitle>
          </Suspense>
        </ErrorBoundary>
        <ErrorBoundary
          fallback={
            <p class="rounded border border-red-900 px-3 py-6 text-center text-xs text-red-400">
              dettaglio non disponibile
            </p>
          }
        >
          <Suspense fallback={<ShimmerList rows={12} />}>
            <Show
              when={(detail()?.stops ?? []).length > 0}
              fallback={
                <p class="rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-xs text-zinc-500 dark:border-zinc-700">
                  Nessun dettaglio disponibile — il poller non ha ancora visto
                  questo treno, o la corsa è cancellata (204).
                </p>
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
                        {s.status === "skipped"
                          ? "—"
                          : s.delayArr > 0 || s.delayDep > 0
                            ? `+${Math.max(s.delayArr, s.delayDep)}'`
                            : "ok"}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Suspense>
        </ErrorBoundary>
      </section>
    </main>
  );
}

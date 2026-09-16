import { A, createAsync, revalidate, useParams } from "@solidjs/router";
import type { RouteDefinition } from "@solidjs/router";
import {
  createMemo,
  createSignal,
  ErrorBoundary,
  For,
  Show,
  Suspense,
} from "solid-js";
import {
  DelayBadge,
  SectionTitle,
  ShimmerList,
  Sparkline,
  TrainStatus,
} from "~/components/ui";
import { fmtDateTime, fmtTime } from "~/lib/format";
import { getBoardQuery, getStatsQuery } from "~/lib/queries";
import { useLive } from "~/lib/sse";

export const route = {
  preload: ({ params }: { params: Record<string, string | undefined> }) => {
    const code = (params.code ?? "").toUpperCase();
    return Promise.allSettled([
      getBoardQuery(code),
      getStatsQuery("station", code, "30d"),
    ]);
  },
} satisfies RouteDefinition;

export default function Stazione() {
  const params = useParams();
  const code = () => (params.code ?? "").toUpperCase();

  const board = createAsync(() => getBoardQuery(code()), {
    deferStream: true,
  });
  const stats = createAsync(() => getStatsQuery("station", code(), "30d"), {
    deferStream: true,
  });

  const live = useLive({
    url: () => `/api/live?station=${code()}`,
    onMessage: (msg) => {
      if (msg.heartbeat) return;
      revalidate(getBoardQuery.keyFor(code()));
    },
  });

  const [filter, setFilter] = createSignal("");
  const filteredTrains = createMemo(() => {
    const q = filter().trim().toLowerCase();
    const all = board()?.trains ?? [];
    if (!q) return all;
    return all.filter(
      (t) =>
        t.numero.includes(q) ||
        `${t.categoria} ${t.numero}`.toLowerCase().includes(q) ||
        (t.destinazione ?? "").toLowerCase().includes(q) ||
        (t.origine ?? "").toLowerCase().includes(q),
    );
  });

  return (
    <main class="mx-auto max-w-5xl px-4 pb-16">
      <section class="py-8">
        <p class="text-xs uppercase tracking-[0.25em] text-zinc-500">
          stazione · {code()}
        </p>
        <ErrorBoundary fallback={<h1 class="mt-2 text-3xl font-bold">{code()}</h1>}>
          <Suspense fallback={<h1 class="mt-2 text-3xl font-bold text-zinc-500">…</h1>}>
            <h1 class="mt-2 text-3xl font-bold tracking-tight">
              {board()?.station.name ?? code()}
            </h1>
          </Suspense>
        </ErrorBoundary>
        <p class="mt-1 flex items-center gap-2 text-xs text-zinc-500">
          <ErrorBoundary fallback={<></>}>
            <Suspense fallback={<>aggiornato …</>}>
              aggiornato {board() ? fmtDateTime(board()!.updatedAt) : "…"}
            </Suspense>
          </ErrorBoundary>{" "}
          <span class="flex items-center gap-1.5">
            <span
              class={`inline-block size-2 rounded-full ${live.connected() ? "bg-emerald-500" : "bg-zinc-500"}`}
            />
            {live.connected() ? "live" : "reconnecting…"}
          </span>
        </p>
      </section>

      <ErrorBoundary fallback={<></>}>
        <Suspense>
          <Show when={stats() && (stats()?.runs ?? 0) > 0}>
            <section class="mb-8 rounded border border-zinc-200 p-4 dark:border-zinc-800">
              <SectionTitle>storico stazione · 30d</SectionTitle>
              <div class="flex items-center gap-6">
                <div>
                  <p class="text-2xl font-bold tabular-nums">
                    +{stats()?.avgFinal ?? 0}'
                  </p>
                  <p class="text-xs text-zinc-500">ritardo medio arrivi</p>
                </div>
                <Sparkline values={(stats()?.series ?? []).map((s) => s.avgFinal)} />
                <p class="ml-auto text-xs tabular-nums text-zinc-500">
                  {stats()?.runs} corse · max +{stats()?.maxFinal}' · canc{" "}
                  {stats()?.cancellRate}%
                </p>
              </div>
            </section>
          </Show>
        </Suspense>
      </ErrorBoundary>

      <section>
        <ErrorBoundary fallback={<></>}>
          <Suspense
            fallback={<SectionTitle>partenze / arrivi live</SectionTitle>}
          >
            <SectionTitle
              right={`${filteredTrains().length} / ${board()?.trains.length ?? 0} treni`}
            >
              partenze / arrivi live
            </SectionTitle>
          </Suspense>
        </ErrorBoundary>
        <div class="mb-3">
          <input
            value={filter()}
            onInput={(e) => setFilter(e.currentTarget.value)}
            placeholder="cerca per numero o destinazione… es. 9583 o Roma"
            class="w-full rounded border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
          />
        </div>
        <ErrorBoundary
          fallback={
            <p class="rounded border border-red-900 px-3 py-6 text-center text-xs text-red-400">
              tabellone non disponibile
            </p>
          }
        >
          <Suspense fallback={<ShimmerList rows={10} />}>
            <Show
              when={(board()?.trains ?? []).length > 0}
              fallback={
                <p class="mt-2 rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-xs text-zinc-500 dark:border-zinc-700">
                  {board()?.dbConfigured
                    ? "Nessun treno rilevato in questa finestra."
                    : "DB non configurato — nessun dato live."}
                </p>
              }
            >
              <Show
                when={filteredTrains().length > 0}
                fallback={
                  <p class="mt-2 rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-xs text-zinc-500 dark:border-zinc-700">
                    Nessun treno corrisponde a “{filter().trim()}”.
                  </p>
                }
              >
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-left text-[11px] uppercase tracking-widest text-zinc-500">
                      <th class="py-2 pr-3">treno</th>
                      <th class="py-2 pr-3">destinazione</th>
                      <th class="py-2 pr-3 tabular-nums">prog</th>
                      <th class="py-2 pr-3 tabular-nums">prev</th>
                      <th class="py-2 pr-3 text-center">bin</th>
                      <th class="py-2 pr-3">stato</th>
                      <th class="py-2 text-right">ritardo</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={filteredTrains()}>
                      {(t) => (
                        <tr class="border-t border-zinc-100 dark:border-zinc-900">
                          <td class="py-2 pr-3 font-bold tabular-nums">
                            <A href={`/treno/${t.numero}`} class="hover:underline">
                              {t.categoria} {t.numero}
                            </A>
                          </td>
                          <td class="max-w-45 truncate py-2 pr-3 text-xs text-zinc-500">
                            {t.destinazione || t.origine}
                          </td>
                          <td class="py-2 pr-3 tabular-nums">{fmtTime(t.scheduled)}</td>
                          <td class="py-2 pr-3 tabular-nums text-zinc-500">
                            {fmtTime(t.expected)}
                          </td>
                          <td class="py-2 pr-3 text-center tabular-nums">
                            {t.binarioReal ?? t.binarioProg ?? "—"}
                          </td>
                          <td class="py-2 pr-3">
                            <TrainStatus temporalStatus={t.temporalStatus ?? "unknown"} delayStato={t.stato} />
                          </td>
                          <td class="py-2 text-right">
                            <DelayBadge delay={t.delay} stato={t.stato} />
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
              </Show>
            </Show>
          </Suspense>
        </ErrorBoundary>
      </section>
    </main>
  );
}

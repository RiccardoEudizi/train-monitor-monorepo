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
  Card,
  DelayBadge,
  EmptyState,
  ErrorBox,
  Field,
  LiveDot,
  SectionTitle,
  ShimmerList,
  Sparkline,
  TrainStatus,
} from "~/components/ui";
import { AsciiFx, PixelValue } from "~/components/fx";
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
              aggiornato {board()?.updatedAt ? fmtDateTime(board()?.updatedAt ?? null) : "…"}
            </Suspense>
          </ErrorBoundary>{" "}
          <LiveDot connected={live.connected()} />
        </p>
      </section>

      <ErrorBoundary fallback={<></>}>
        <Suspense>
          <Show when={stats() && (stats()?.runs ?? 0) > 0}>
            <Card class="mb-8">
              <SectionTitle>storico stazione · 30d</SectionTitle>
              <div class="flex items-center gap-6">
                <div>
                  <p class="text-2xl font-bold tabular-nums">
                    <PixelValue value={`+${stats()?.avgFinal ?? 0}'`}>
                      +{stats()?.avgFinal ?? 0}'
                    </PixelValue>
                  </p>
                  <p class="text-xs text-zinc-500">ritardo medio arrivi</p>
                </div>
                <AsciiFx
                  watch={(stats()?.series ?? []).map((s) => s.avgFinal).join(",")}
                >
                  <Sparkline values={(stats()?.series ?? []).map((s) => s.avgFinal)} />
                </AsciiFx>
                <p class="ml-auto text-xs tabular-nums text-zinc-500">
                  <PixelValue value={`${stats()?.runs}`}>
                    {stats()?.runs}
                  </PixelValue>{" "}
                  corse · max{" "}
                  <PixelValue value={`+${stats()?.maxFinal}'`}>
                    +{stats()?.maxFinal}'
                  </PixelValue>{" "}
                  · canc{" "}
                  <PixelValue value={`${stats()?.cancellRate}%`}>
                    {stats()?.cancellRate}%
                  </PixelValue>
                </p>
              </div>
            </Card>
          </Show>
        </Suspense>
      </ErrorBoundary>

      <section>
        <ErrorBoundary fallback={<></>}>
          <Suspense
            fallback={<SectionTitle>partenze / arrivi live</SectionTitle>}
          >
            <SectionTitle
              right={
                <>
                  <PixelValue value={`${filteredTrains().length}`}>
                    {filteredTrains().length}
                  </PixelValue>{" "}
                  /{" "}
                  <PixelValue value={`${board()?.trains.length ?? 0}`}>
                    {board()?.trains.length ?? 0}
                  </PixelValue>{" "}
                  treni
                </>
              }
            >
              partenze / arrivi live
            </SectionTitle>
          </Suspense>
        </ErrorBoundary>
        <div class="mb-3">
          <Field
            value={filter()}
            onInput={setFilter}
            placeholder="cerca per numero o destinazione… es. 9583 o Roma"
            label="filtra treni in tabellone"
          />
        </div>
        <ErrorBoundary fallback={<ErrorBox message="tabellone non disponibile" />}>
          <Suspense fallback={<ShimmerList rows={10} />}>
            <Show
              when={(board()?.trains ?? []).length > 0}
              fallback={
                <EmptyState>
                  {board()?.dbConfigured
                    ? "Nessun treno rilevato in questa finestra."
                    : "DB non configurato — nessun dato live."}
                </EmptyState>
              }
            >
              <Show
                when={filteredTrains().length > 0}
                fallback={
                  <EmptyState>
                    Nessun treno corrisponde a “{filter().trim()}”.
                  </EmptyState>
                }
              >
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-left text-[11px] uppercase tracking-widest text-zinc-500">
                      <th scope="col" class="py-2 pr-3">treno</th>
                      <th scope="col" class="py-2 pr-3">destinazione</th>
                      <th scope="col" class="py-2 pr-3 tabular-nums">prog</th>
                      <th scope="col" class="py-2 pr-3 tabular-nums">prev</th>
                      <th scope="col" class="py-2 pr-3 text-center">bin</th>
                      <th scope="col" class="py-2 pr-3">stato</th>
                      <th scope="col" class="py-2 text-right">ritardo</th>
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
                          <td class="max-w-44 truncate py-2 pr-3 text-xs text-zinc-500">
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

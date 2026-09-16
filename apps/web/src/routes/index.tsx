import { A, createAsync, revalidate } from "@solidjs/router";
import type { RouteDefinition } from "@solidjs/router";
import {
  createEffect,
  createSignal,
  ErrorBoundary,
  For,
  Show,
  Suspense,
} from "solid-js";
import {
  LiveDot,
  SectionTitle,
  ShimmerList,
  Spinner,
  TrainRow,
} from "~/components/ui";
import type { StationItem } from "~/lib/api-types";
import { getDelaysQuery, getNewsQuery } from "~/lib/queries";
import { useLive } from "~/lib/sse";

export const route = {
  preload: () =>
    Promise.allSettled([getDelaysQuery(1, "", 20), getNewsQuery()]),
} satisfies RouteDefinition;

function ErrorBox(props: { message: string }) {
  return (
    <p class="rounded border border-red-900 px-3 py-2 text-xs text-red-400">
      {props.message}
    </p>
  );
}

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

  // Global live feed → revalidate queries on change.
  const live = useLive({
    url: "/api/live",
    onMessage: (msg) => {
      if (msg.heartbeat) return;
      revalidate(getDelaysQuery.key);
      revalidate(getNewsQuery.key);
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
                    {delays()?.totalCircolanti ?? 0}
                  </span>{" "}
                  <span class="text-zinc-500">treni circolanti</span>
                </span>
                <span>
                  <span class="text-2xl font-bold">
                    {delays()?.items.length ?? 0}
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

      {/* search */}
      <section class="grid gap-4 sm:grid-cols-2">
        <div class="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <SectionTitle>cerca stazione</SectionTitle>
          <input
            value={stationQ()}
            onInput={(e) => setStationQ(e.currentTarget.value)}
            placeholder="es. Milano Centrale"
            class="w-full rounded border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
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
        </div>
        <div class="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <SectionTitle>cerca treno</SectionTitle>
          <form
            class="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = trainN().trim();
              if (n) window.location.href = `/treno/${encodeURIComponent(n)}`;
            }}
          >
            <input
              value={trainN()}
              onInput={(e) => setTrainN(e.currentTarget.value)}
              placeholder="es. 9583"
              inputmode="numeric"
              class="w-full rounded border border-zinc-300 bg-transparent px-3 py-2 text-sm tabular-nums outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
            <button
              type="submit"
              class="rounded bg-zinc-900 px-4 py-2 text-sm font-bold text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              →
            </button>
          </form>
          <p class="mt-3 text-xs leading-relaxed text-zinc-500">
            Inserisci il numero del treno per vedere fermate, ritardo per
            stazione e storico 24h / 30d / all.
          </p>
        </div>
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
                <p class="rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-xs text-zinc-500 dark:border-zinc-700">
                  Nessun ritardo sopra 1 min al momento — o DB non ancora popolato.
                </p>
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

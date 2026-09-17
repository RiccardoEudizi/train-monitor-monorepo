import { createAsync, revalidate } from "@solidjs/router";
import type { RouteDefinition } from "@solidjs/router";
import { createSignal, ErrorBoundary, For, Show, Suspense } from "solid-js";
import {
  Chip,
  SectionTitle,
  ShimmerList,
  Spinner,
  TrainRow,
} from "~/components/ui";
import { getDelaysQuery } from "~/lib/queries";
import { PixelValue } from "~/components/fx";
import { useLive } from "~/lib/sse";

export const route = {
  preload: () => getDelaysQuery(5, "", 100).then(
    () => undefined,
    () => undefined,
  ),
} satisfies RouteDefinition;

const CATS = ["FR", "IC", "REG"];

export default function Ritardi() {
  const [min, setMin] = createSignal(5);
  const [cats, setCats] = createSignal<string[]>([]);

  // Reactive args → automatic refetch when filters change.
  const res = createAsync(() => getDelaysQuery(min(), cats().join(","), 100), {
    deferStream: true,
  });

  useLive({
    url: "/api/live",
    onMessage: (msg) => {
      if (msg.heartbeat) return;
      revalidate(getDelaysQuery.key);
    },
  });

  function toggleCat(c: string) {
    setCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  return (
    <main class="mx-auto max-w-5xl px-4 pb-16">
      <section class="py-8">
        <p class="text-xs uppercase tracking-[0.25em] text-zinc-500">ranking live</p>
        <h1 class="mt-2 text-3xl font-bold tracking-tight">Ritardi</h1>
      </section>

      <div class="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <For each={[0, 5, 10, 15, 30]}>
          {(m) => (
            <Chip active={min() === m} onClick={() => setMin(m)} class="tabular-nums">
              +{m}
            </Chip>
          )}
        </For>
        <span class="mx-1 text-zinc-300 dark:text-zinc-700">|</span>
        <For each={CATS}>
          {(c) => (
            <Chip active={cats().includes(c)} onClick={() => toggleCat(c)}>
              {c}
            </Chip>
          )}
        </For>
        <span class="ml-auto text-zinc-500">
          <ErrorBoundary fallback={<span>—</span>}>
            <Suspense fallback={<Spinner />}>
              <Show when={res()}>
                <PixelValue value={`${res()?.items.length ?? 0}`}>
                  {res()?.items.length ?? 0}
                </PixelValue>{" "}
                treni
              </Show>
            </Suspense>
          </ErrorBoundary>
        </span>
      </div>

      <section>
        <SectionTitle>peggiori per ritardo</SectionTitle>
        <ErrorBoundary
          fallback={
            <p class="rounded border border-red-900 px-3 py-6 text-center text-xs text-red-400">
              ranking non disponibile
            </p>
          }
        >
          <Suspense fallback={<ShimmerList rows={12} />}>
            <Show
              when={(res()?.items ?? []).length > 0}
              fallback={
                <p class="rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-xs text-zinc-500 dark:border-zinc-700">
                  Nessun treno sopra la soglia. Prova ad abbassare il filtro.
                </p>
              }
            >
              <div class="flex flex-col gap-2">
                <For each={res()?.items ?? []}>{(t) => <TrainRow t={t} />}</For>
              </div>
            </Show>
          </Suspense>
        </ErrorBoundary>
      </section>
    </main>
  );
}

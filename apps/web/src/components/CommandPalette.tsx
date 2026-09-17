import { useNavigate } from "@solidjs/router";
import { Dialog } from "@kobalte/core";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type { StationItem } from "~/lib/api-types";

type FlatItem =
  | { kind: "train"; numero: string }
  | { kind: "station"; station: StationItem };

/** Global command palette: Ctrl+K / Cmd+K, search stations + train numbers. */
export default function CommandPalette() {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [stations, setStations] = createSignal<StationItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [active, setActive] = createSignal(0);
  const navigate = useNavigate();
  let inputRef: HTMLInputElement | undefined;

  // Global shortcut: Ctrl+K / Cmd+K toggles, SSR-safe (client only).
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  // Autofocus + reset selection when opened.
  createEffect(() => {
    if (open()) {
      setActive(0);
      // Wait a tick for Dialog.Content to mount.
      requestAnimationFrame(() => inputRef?.focus());
    } else {
      setQuery("");
      setStations([]);
      setLoading(false);
    }
  });

  // Debounced station autocomplete (same /api/stations as homepage).
  createEffect(() => {
    const q = query().trim();
    if (!open() || q.length < 2) {
      setStations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/stations?q=${encodeURIComponent(q)}`);
        if (r.ok) {
          const data = (await r.json()) as { stations: StationItem[] };
          setStations(data.stations.slice(0, 8));
        }
      } catch {
        /* keep previous */
      } finally {
        setLoading(false);
      }
    }, 250);
    onCleanup(() => clearTimeout(t));
  });

  const trainNumero = createMemo(() => {
    const q = query().trim();
    return /^\d{1,6}$/.test(q) ? q : null;
  });

  const items = createMemo<FlatItem[]>(() => {
    const list: FlatItem[] = [];
    const n = trainNumero();
    if (n) list.push({ kind: "train", numero: n });
    for (const s of stations()) list.push({ kind: "station", station: s });
    return list;
  });

  createEffect(() => {
    // Clamp selection when results change.
    if (active() >= items().length && items().length > 0) setActive(0);
  });

  const go = (item: FlatItem) => {
    setOpen(false);
    if (item.kind === "train") navigate(`/treno/${encodeURIComponent(item.numero)}`);
    else navigate(`/stazione/${item.station.code}`);
  };

  const onInputKey = (e: KeyboardEvent) => {
    const list = items();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (list.length ? (a + 1) % list.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (list.length ? (a - 1 + list.length) % list.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = list[active()];
      if (item) go(item);
      else if (trainNumero()) navigate(`/treno/${encodeURIComponent(trainNumero()!)}`);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        class="hidden items-center gap-2 rounded border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-700 sm:flex dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
        title="cerca (Ctrl+K)"
      >
        <span aria-hidden="true">⌕</span>
        <span class="hidden lg:inline">cerca stazione, treno…</span>
        <kbd class="rounded border border-zinc-300 px-1 text-[10px] leading-4 tabular-nums dark:border-zinc-700">
          ctrl K
        </kbd>
      </button>
      {/* Mobile: icon-only trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        class="rounded border border-zinc-300 px-2 py-1.5 text-xs text-zinc-500 sm:hidden dark:border-zinc-700"
        title="cerca (Ctrl+K)"
        aria-label="cerca"
      >
        ⌕
      </button>

      <Dialog.Root open={open()} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay class="palette-overlay fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
          <div class="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
            <Dialog.Content class="palette-content w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-zinc-950">
              <Dialog.Title class="sr-only">cerca stazione o treno</Dialog.Title>
              <div class="border-b border-zinc-200 dark:border-zinc-800">
                <input
                  ref={inputRef}
                  value={query()}
                  onInput={(e) => {
                    setQuery(e.currentTarget.value);
                    setActive(0);
                  }}
                  onKeyDown={onInputKey}
                  placeholder="cerca stazione o numero treno…"
                  aria-label="cerca stazione o treno"
                  class="w-full bg-transparent px-4 py-3 text-sm outline-none placeholder:text-zinc-400"
                />
              </div>

              <div class="max-h-[50vh] overflow-y-auto p-2">
                <Show when={loading()}>
                  <p class="px-3 py-4 text-xs text-zinc-500">ricerca…</p>
                </Show>
                <Show when={!loading() && items().length === 0}>
                  <p class="px-3 py-4 text-xs leading-relaxed text-zinc-500">
                    {query().trim().length < 2
                      ? "Digita almeno 2 caratteri, oppure un numero di treno."
                      : `Nessun risultato per “${query().trim()}”.`}
                  </p>
                </Show>
                <Show when={items().length > 0}>
                  <Show when={trainNumero()}>
                    <p class="px-3 pb-1 pt-2 text-[11px] uppercase tracking-widest text-zinc-500">
                      treno
                    </p>
                  </Show>
                  <For each={items()}>
                    {(item, i) => (
                      <button
                        type="button"
                        onClick={() => go(item)}
                        onMouseMove={() => setActive(i())}
                        class={`flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm ${
                          active() === i()
                            ? "bg-zinc-100 dark:bg-zinc-900"
                            : ""
                        }`}
                      >
                        {item.kind === "train" ? (
                          <>
                            <span class="text-base" aria-hidden="true">
                              🚂
                            </span>
                            <span class="font-bold tabular-nums">
                              Treno {item.numero}
                            </span>
                            <span class="ml-auto text-xs text-zinc-500">
                              vai al dettaglio →
                            </span>
                          </>
                        ) : (
                          <>
                            <span class="truncate font-bold">
                              {item.station.name}
                            </span>
                            <span class="ml-auto shrink-0 text-xs tabular-nums text-zinc-500">
                              {item.station.code}
                            </span>
                          </>
                        )}
                      </button>
                    )}
                  </For>
                </Show>
              </div>

              <div class="flex items-center gap-3 border-t border-zinc-200 px-4 py-2 text-[11px] text-zinc-500 dark:border-zinc-800">
                <span>
                  <kbd class="rounded border border-zinc-300 px-1 dark:border-zinc-700">
                    ↑↓
                  </kbd>{" "}
                  naviga
                </span>
                <span>
                  <kbd class="rounded border border-zinc-300 px-1 dark:border-zinc-700">
                    ↵
                  </kbd>{" "}
                  apri
                </span>
                <span class="ml-auto">
                  <kbd class="rounded border border-zinc-300 px-1 dark:border-zinc-700">
                    esc
                  </kbd>{" "}
                  chiudi
                </span>
              </div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

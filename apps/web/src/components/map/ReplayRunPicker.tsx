import { createMemo, createSignal, For, Show } from "solid-js";
import type { ReplayRun } from "~/lib/map/replay";
import { fmtTime } from "~/lib/format";

/**
 * Searchable picker for a single train run of the day. Filters the day's runs
 * by train number or origin/destination and, on pick, jumps the playback to
 * the run so it can be followed on the map. Custom (no native <select>): the
 * list, highlight and keyboard handling live here.
 */
export default function ReplayRunPicker(props: {
  runs: ReplayRun[];
  selectedRunId: number | null;
  onSelect: (runId: number | null) => void;
}) {
  const [query, setQuery] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [highlight, setHighlight] = createSignal(0);

  const selected = createMemo(() =>
    props.selectedRunId == null
      ? null
      : (props.runs.find((r) => r.runId === props.selectedRunId) ?? null),
  );

  const matches = createMemo(() => {
    const q = query().trim().toLowerCase();
    const base = q
      ? props.runs.filter(
          (r) =>
            r.numero.toLowerCase().includes(q) ||
            r.origine.toLowerCase().includes(q) ||
            r.destinazione.toLowerCase().includes(q),
        )
      : props.runs;
    return base.slice(0, 8);
  });

  const pick = (r: ReplayRun) => {
    props.onSelect(r.runId);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, matches().length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      const r = matches()[highlight()];
      if (r) {
        e.preventDefault();
        pick(r);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  let box: HTMLDivElement | undefined;
  const onFocusOut = (e: FocusEvent) => {
    if (box && !box.contains(e.relatedTarget as Node)) setOpen(false);
  };

  return (
    <div ref={box} onFocusOut={onFocusOut} class="relative px-3 py-2">
      <div class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
        treno
      </div>
      <Show when={selected()}>
        {(r) => (
          <div class="mt-1 flex items-center gap-1.5 rounded border border-zinc-300 px-1.5 py-1 dark:border-zinc-700">
            <span class="font-bold tabular-nums">
              {r().categoria} {r().numero}
            </span>
            <span class="min-w-0 flex-1 truncate text-zinc-500">
              {r().origine} → {r().destinazione}
            </span>
            <button
              type="button"
              aria-label="deseleziona treno"
              onClick={() => props.onSelect(null)}
              class="shrink-0 text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
            >
              ✕
            </button>
          </div>
        )}
      </Show>
      <input
        type="text"
        value={query()}
        placeholder="cerca numero o stazione…"
        aria-label="cerca una corsa del giorno"
        onInput={(e) => {
          setQuery(e.currentTarget.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        class="mt-1 w-full rounded border border-zinc-300 bg-transparent px-1.5 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
      />
      <Show when={open() && matches().length > 0}>
        <ul class="absolute inset-x-3 top-full z-50 mt-0.5 max-h-64 overflow-y-auto rounded border border-zinc-300 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <For each={matches()}>
            {(r, i) => (
              <li>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(i())}
                  onClick={() => pick(r)}
                  class={`flex w-full items-center gap-2 px-2 py-1.5 text-left ${
                    highlight() === i()
                      ? "bg-zinc-100 dark:bg-zinc-800"
                      : ""
                  }`}
                >
                  <span class="w-14 shrink-0 font-bold tabular-nums">
                    {r.categoria} {r.numero}
                  </span>
                  <span class="min-w-0 flex-1 truncate text-zinc-500">
                    {r.origine} → {r.destinazione}
                  </span>
                  <span class="shrink-0 tabular-nums text-zinc-400">
                    {fmtTime(new Date(r.startMs).toISOString())}
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

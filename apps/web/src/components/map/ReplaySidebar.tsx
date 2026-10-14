import { For, Show } from "solid-js";
import type { LiveTrain } from "~/lib/map/interpolate";
import type { ReplayDayInfo, ReplayEvent, ReplayRun } from "~/lib/map/replay";
import { statoColor } from "~/lib/map/colors";
import { fmtDateEU, fmtTime } from "~/lib/format";
import { Spinner } from "~/components/ui";
import ReplayRunPicker from "./ReplayRunPicker";

const STATO_LABEL: Record<string, string> = {
  ok: "in orario",
  delayed: "ritardo",
  "heavily-delayed": "forte ritardo",
  partial: "parziale",
  cancelled: "cancellato",
  nodata: "n/d",
};

function fmtDelayMin(min: number): string {
  return min > 0 ? `+${min}′` : "ok";
}

/**
 * Collapsible left rail for /replay. Two live sections driven by the playback
 * instant: trains currently running, and the arrival/departure event feed.
 * Pure presentation — all time/derivation lives in the page.
 */
export default function ReplaySidebar(props: {
  days: ReplayDayInfo[];
  date: string | null;
  onDate: (date: string) => void;
  runs: ReplayRun[];
  active: LiveTrain[];
  events: ReplayEvent[];
  selectedRunId: number | null;
  onSelect: (runId: number) => void;
  onSelectRun: (runId: number | null) => void;
  open: boolean;
  onToggle: (open: boolean) => void;
  loading: boolean;
}) {
  return (
    <>
      {/* Floating handle shown while the rail is collapsed. */}
      <Show when={!props.open}>
        <button
          type="button"
          onClick={() => props.onToggle(true)}
          class="absolute left-0 top-1/2 z-40 -translate-y-1/2 rounded-r border border-l-0 border-zinc-300 bg-white/85 px-1.5 py-3 text-[10px] uppercase tracking-widest text-zinc-600 shadow-lg backdrop-blur hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/85 dark:text-zinc-300 dark:hover:text-white"
          aria-label="apri pannello aggiornamenti"
        >
          <span style={{ "writing-mode": "vertical-rl" }}>aggiornamenti</span>
        </button>
      </Show>

      <aside
        aria-label="aggiornamenti del giorno"
        class={`absolute left-0 top-0 z-40 flex h-full w-[19rem] max-w-[85vw] flex-col border-r border-zinc-200 bg-white/92 text-xs backdrop-blur-md transition-transform duration-300 dark:border-zinc-800 dark:bg-[#0b0b0e]/92 ${
          props.open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header: day picker + collapse */}
        <div class="flex items-center gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
          <div class="min-w-0 flex-1">
            <div class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              replay · giorno
            </div>
            <select
              value={props.date ?? ""}
              onChange={(e) => props.onDate(e.currentTarget.value)}
              disabled={props.days.length === 0}
              aria-label="scegli il giorno da riprodurre"
              class="mt-1 w-full cursor-pointer rounded border border-zinc-300 bg-transparent px-1.5 py-1 text-sm tabular-nums outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700"
            >
              <For each={props.days}>
                {(d) => (
                  <option value={d.date}>
                    {fmtDateEU(d.date)} · {d.runs.toLocaleString("it-IT")} corse
                  </option>
                )}
              </For>
            </select>
          </div>
          <button
            type="button"
            onClick={() => props.onToggle(false)}
            aria-label="chiudi pannello aggiornamenti"
            class="shrink-0 rounded border border-zinc-300 px-1.5 py-1 text-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:hover:text-white"
          >
            ◀
          </button>
        </div>

        <Show when={props.loading}>
          <div class="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <Spinner label="carico il giorno" slim />
          </div>
        </Show>

        {/* Pick a specific run to follow */}
        <div class="border-b border-zinc-200 dark:border-zinc-800">
          <ReplayRunPicker
            runs={props.runs}
            selectedRunId={props.selectedRunId}
            onSelect={props.onSelectRun}
          />
        </div>

        {/* Body */}
        <div class="min-h-0 flex-1 overflow-y-auto">
          {/* In viaggio */}
          <div class="border-b border-zinc-200 dark:border-zinc-800">
            <div class="sticky top-0 z-10 flex items-baseline justify-between bg-white/92 px-3 py-2 backdrop-blur dark:bg-[#0b0b0e]/92">
              <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                in viaggio
              </span>
              <span class="tabular-nums text-zinc-500">
                {props.active.length}
              </span>
            </div>
            <Show
              when={props.active.length > 0}
              fallback={
                <p class="px-3 pb-3 text-zinc-500">nessun treno in viaggio</p>
              }
            >
              <ul class="flex flex-col">
                <For each={props.active}>
                  {(t) => (
                    <li>
                      <button
                        type="button"
                        onClick={() => props.onSelect(t.runId)}
                        class={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                          props.selectedRunId === t.runId
                            ? "bg-zinc-100 dark:bg-zinc-900"
                            : ""
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          class="inline-block size-2 shrink-0 rounded-full"
                          style={{ background: statoColor(t.stato) }}
                        />
                        <span class="w-14 shrink-0 font-bold tabular-nums">
                          {t.categoria} {t.numero}
                        </span>
                        <span class="min-w-0 flex-1 truncate text-zinc-500">
                          {t.origine}
                          <span aria-hidden="true"> → </span>
                          {t.destinazione}
                        </span>
                        <span
                          class={`shrink-0 tabular-nums ${
                            t.delay > 0
                              ? t.delay >= 15
                                ? "text-red-400"
                                : "text-amber-400"
                              : "text-emerald-400"
                          }`}
                        >
                          {fmtDelayMin(t.delay)}
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>

          {/* Event feed */}
          <div>
            <div class="sticky top-0 z-10 flex items-baseline justify-between bg-white/92 px-3 py-2 backdrop-blur dark:bg-[#0b0b0e]/92">
              <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                aggiornamenti
              </span>
              <span class="text-[10px] text-zinc-500">ultimi 10′</span>
            </div>
            <Show
              when={props.events.length > 0}
              fallback={<p class="px-3 pb-3 text-zinc-500">in attesa…</p>}
            >
              <ul class="flex flex-col">
                <For each={props.events}>
                  {(e) => (
                    <li class="flex items-center gap-2 px-3 py-1">
                      <span class="w-11 shrink-0 tabular-nums text-zinc-500">
                        {fmtTime(new Date(e.tMs).toISOString())}
                      </span>
                      <span
                        aria-hidden="true"
                        class="shrink-0 text-zinc-400"
                        title={e.kind === "dep" ? "partenza" : "arrivo"}
                      >
                        {e.kind === "dep" ? "↑" : "↓"}
                      </span>
                      <span class="w-14 shrink-0 font-bold tabular-nums">
                        {e.numero}
                      </span>
                      <span class="min-w-0 flex-1 truncate text-zinc-500">
                        {e.station}
                      </span>
                      <span
                        class={`shrink-0 tabular-nums ${
                          e.delay > 0
                            ? e.delay >= 15
                              ? "text-red-400"
                              : "text-amber-400"
                            : "text-zinc-400"
                        }`}
                      >
                        {e.delay > 0 ? `+${e.delay}′` : ""}
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </div>

        <p class="border-t border-zinc-200 px-3 py-2 text-[10px] leading-relaxed text-zinc-500 dark:border-zinc-800">
          {STATO_LABEL.ok} · {STATO_LABEL.delayed} ·{" "}
          {STATO_LABEL["heavily-delayed"]} — tempi effettivi registrati
        </p>
      </aside>
    </>
  );
}

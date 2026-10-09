import { Show } from "solid-js";
import type { LiveTrain } from "~/lib/map/interpolate";
import { statoColor } from "~/lib/map/colors";
import DitherTrainIcon from "./DitherTrainIcon";

const STATO_LABEL: Record<string, string> = {
  ok: "in orario",
  delayed: "ritardo",
  "heavily-delayed": "forte ritardo",
  partial: "parziale",
  cancelled: "cancellato",
  nodata: "n/d",
};

function fmtHM(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Detail card shown above a clicked train dot on the 3D map. */
export default function TrainHud(props: {
  train: LiveTrain;
  onClose: () => void;
}) {
  const t = () => props.train;
  return (
    <div class="w-56 rounded border border-zinc-300 bg-white/95 p-2.5 text-xs shadow-xl backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
      <div class="flex items-start gap-2">
        <DitherTrainIcon size={30} class="mt-0.5 shrink-0 text-zinc-800 dark:text-zinc-100" />
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-1.5">
            <span class="font-bold tabular-nums">{t().numero}</span>
            <span class="truncate text-[10px] uppercase tracking-wider text-zinc-500">
              {t().categoria}
            </span>
          </div>
          <div class="truncate text-zinc-500">
            {t().origine || "—"} <span aria-hidden="true">→</span>{" "}
            {t().destinazione || "—"}
          </div>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="chiudi dettagli treno"
          class="-mr-1 -mt-1 rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          ✕
        </button>
      </div>

      <div class="mt-2 flex items-center gap-2">
        <span
          aria-hidden="true"
          class="inline-block size-2 shrink-0 rounded-full"
          style={{ background: statoColor(t().stato) }}
        />
        <span>{STATO_LABEL[t().stato] ?? t().stato}</span>
        <span class="ml-auto tabular-nums text-zinc-500">
          {t().delay > 0 ? `+${t().delay}′` : "in orario"}
        </span>
      </div>

      <Show when={t().nextStation}>
        <div class="mt-1.5 flex items-baseline gap-1 text-zinc-500">
          <span>prossima</span>
          <span class="truncate text-zinc-800 dark:text-zinc-100">
            {t().nextStation}
          </span>
          <span class="ml-auto tabular-nums">
            {fmtHM(t().next.t + Math.max(t().delay, 0) * 60_000)}
          </span>
        </div>
      </Show>
    </div>
  );
}

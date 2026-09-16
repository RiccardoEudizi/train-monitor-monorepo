import { A } from "@solidjs/router";
import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import type { TrainCard } from "~/lib/api-types";
import { delayClass, fmtDelay, fmtTime } from "~/lib/format";
import { displayStatus } from "~/lib/api-types";
import { getInitialDark, setThemeCookie } from "~/lib/theme";

const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Unicode braille spinner. */
export function Spinner(props: { label?: string }) {
  const [i, setI] = createSignal(0);
  onMount(() => {
    const t = setInterval(() => setI((v) => (v + 1) % BRAILLE.length), 80);
    return () => clearInterval(t);
  });
  return (
    <span class="inline-flex items-center gap-2 text-zinc-500">
      <span class="inline-block w-4 text-center">{BRAILLE[i()]}</span>
      <Show when={props.label}>
        <span class="text-xs uppercase tracking-widest">{props.label}</span>
      </Show>
    </span>
  );
}

/** Shimmer skeleton block. */
export function Shimmer(props: { class?: string }) {
  return <div class={`shimmer rounded ${props.class ?? "h-12 w-full"}`} />;
}

export function ShimmerList(props: { rows?: number }) {
  return (
    <div class="flex flex-col gap-2">
      <For each={Array.from({ length: props.rows ?? 6 })}>
        {() => <Shimmer class="h-14 w-full" />}
      </For>
    </div>
  );
}

/** Delay badge with palette color. */
export function DelayBadge(props: { delay: number; stato?: string }) {
  return (
    <span class={`font-bold tabular-nums ${delayClass(props.delay)}`}>
      {props.stato === "cancelled"
        ? "CANC"
        : props.stato === "partial"
          ? `PARZ ${fmtDelay(props.delay)}`
          : fmtDelay(props.delay)}
    </span>
  );
}

/** Temporal status badge for train (waiting/traveling/ended). */
export function TrainStatus(props: { temporalStatus: string; delayStato: string }) {
  const { label, class: cls } = displayStatus(props.temporalStatus as any, props.delayStato as any);
  return <span class={`text-xs font-medium ${cls}`}>{label}</span>;
}

/** Theme toggle (dark default). Preference lives in a `tm-theme` cookie
 * (see ~/lib/theme) so SSR paints the right theme — no flash, no mismatch. */
export function ThemeToggle() {
  const [dark, setDark] = createSignal(getInitialDark());
  createEffect(() => {
    const isDark = dark();
    document.documentElement.classList.toggle("dark", isDark);
    setThemeCookie(isDark);
    try {
      localStorage.removeItem("tm-theme"); // legacy key, superseded by cookie
    } catch {
      /* storage unavailable */
    }
  });
  return (
    <button
      onClick={() => setDark((d) => !d)}
      class="rounded border border-zinc-300 px-2 py-1 text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-100"
      title="toggle theme"
    >
      {dark() ? "light" : "dark"}
    </button>
  );
}

/** Minimal SVG sparkline for stats series. */
export function Sparkline(props: { values: number[]; width?: number; height?: number }) {
  const w = () => props.width ?? 160;
  const h = () => props.height ?? 36;
  const path = () => {
    const v = props.values;
    if (v.length < 2) return "";
    const max = Math.max(...v, 1);
    const min = Math.min(...v, 0);
    const span = max - min || 1;
    const step = w() / (v.length - 1);
    return v
      .map((x, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h() - 4 - ((x - min) / span) * (h() - 8)).toFixed(1)}`)
      .join(" ");
  };
  return (
    <svg width={w()} height={h()} class="overflow-visible">
      <path d={path()} fill="none" stroke="currentColor" stroke-width="1.5" class="text-zinc-400 dark:text-zinc-500" />
    </svg>
  );
}

/** Compact train row used by dashboard, ranking and boards. */
export function TrainRow(props: { t: TrainCard }) {
  const t = () => props.t;
  return (
    <A
      href={`/treno/${t().numero}`}
      class="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded border border-zinc-200 px-3 py-2 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
    >
      <span class="text-sm font-bold tabular-nums">
        {t().categoria} {t().numero}
      </span>
      <span class="truncate text-xs text-zinc-500">
        {t().origine} → {t().destinazione}
        <span class="ml-2 tabular-nums">{fmtTime(t().scheduled)}</span>
      </span>
      <TrainStatus temporalStatus={t().temporalStatus ?? "unknown"} delayStato={t().stato} />
      <DelayBadge delay={t().delay} stato={t().stato} />
    </A>
  );
}

/** Section header, dev-aesthetic uppercase.
 * NOTE: `right` is rendered unconditionally (no <Show> gate). Passing a
 * component vnode (e.g. `<A>`) through `Show when={vnode}` breaks SSR
 * hydration: the server emits one hydration key for the anchor while the
 * client computes another ("Unable to find DOM nodes for hydration key"
 * at `A`). An empty trailing div keeps `justify-between` alignment stable.
 */
export function SectionTitle(props: { children: any; right?: any }) {
  return (
    <div class="mb-3 flex items-baseline justify-between">
      <h2 class="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
        {props.children}
      </h2>
      <div class="text-xs text-zinc-500">{props.right}</div>
    </div>
  );
}

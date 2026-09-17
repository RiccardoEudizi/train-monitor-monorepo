import { A } from "@solidjs/router";
import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import type { TrainCard } from "~/lib/api-types";
import { delayClass, fmtDelay, fmtTime } from "~/lib/format";
import { displayStatus } from "~/lib/api-types";
import { getInitialDark, setThemeCookie } from "~/lib/theme";
import { AsciiFx, PixelValue } from "./fx";

const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Unicode braille spinner. `slim` renders a compact single-glyph version
 * for tight spots (e.g. filter rows). */
export function Spinner(props: { label?: string; slim?: boolean }) {
  const [i, setI] = createSignal(0);
  onMount(() => {
    const t = setInterval(() => setI((v) => (v + 1) % BRAILLE.length), 80);
    return () => clearInterval(t);
  });
  return (
    <span
      class={`inline-flex items-center text-zinc-500 ${props.slim ? "gap-0 text-[11px]" : "gap-2"}`}
    >
      <span
        class={`inline-block text-center ${props.slim ? "w-3" : "w-4"}`}
      >
        {BRAILLE[i()]}
      </span>
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

/** Delay badge with palette color. Number dissolves via `PixelValue`
 * (in-place updates) and pixelates in on insertion (after skeletons). */
export function DelayBadge(props: { delay: number; stato?: string }) {
  const label = () =>
    props.stato === "cancelled"
      ? "CANC"
      : props.stato === "partial"
        ? `PARZ ${fmtDelay(props.delay)}`
        : fmtDelay(props.delay);
  return (
    <span class={`inline-block font-bold tabular-nums ${delayClass(props.delay)}`}>
      <PixelValue value={label()}>{label()}</PixelValue>
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

/** SSE connection indicator. SSR-safe: starts disconnected on both sides. */
export function LiveDot(props: { connected: boolean }) {
  return (
    <span class="flex items-center gap-1.5 text-xs text-zinc-500">
      <span
        class={`inline-block size-2 rounded-full ${props.connected ? "bg-emerald-500" : "bg-zinc-500"}`}
      />
      {props.connected ? "live" : "reconnecting…"}
    </span>
  );
}

/** Small filter toggle button (ranking + detail period selectors). */
export function Chip(props: {
  active: boolean;
  onClick: () => void;
  children: any;
  class?: string;
}) {
  return (
    <button
      onClick={props.onClick}
      class={`rounded border px-2 py-1 ${props.active ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 text-zinc-500 dark:border-zinc-700"} ${props.class ?? ""}`}
    >
      {props.children}
    </button>
  );
}

/** Vertical ASCII bar chart (pure, SSR-safe) for daily delay series.
 * One column per day, `█` blocks scaled to the max. */
export function AsciiTrend(props: {
  values: number[];
  height?: number;
  label?: string;
}) {
  const h = () => props.height ?? 7;
  const vals = () => props.values.slice(-31);
  const max = () => Math.max(0, ...vals());
  const rows = () => {
    const v = vals();
    const m = max();
    const out: string[] = [];
    for (let r = h(); r >= 1; r--) {
      out.push(
        v
          .map((x) => (m <= 0 ? " " : x / m >= r / h() ? "█" : " "))
          .join(""),
      );
    }
    return out;
  };
  return (
    <Show
      when={vals().length > 0 && max() > 0}
      fallback={
        <p class="text-[11px] text-zinc-500">
          — nessun ritardo nel periodo
        </p>
      }
    >
      <pre
        role="img"
        aria-label={props.label ?? `trend ritardi, max +${max()}`}
        class="overflow-x-auto text-[11px] leading-[1.3] tracking-[0.1em] text-zinc-600 tabular-nums dark:text-zinc-400"
      >
        {rows().join("\n")}
      </pre>
    </Show>
  );
}

/** Horizontal ASCII bars (pure, SSR-safe), e.g. top regioni per cumulato. */
export function AsciiHBars(props: {
  rows: Array<{ label: string; value: number; suffix?: string }>;
  width?: number;
}) {
  const w = () => props.width ?? 14;
  const max = () => Math.max(1, ...props.rows.map((r) => r.value));
  return (
    <Show
      when={props.rows.length > 0}
      fallback={
        <p class="text-[11px] text-zinc-500">— nessun dato nel periodo</p>
      }
    >
      <pre
        role="img"
        aria-label="barre orizzontali"
        class="overflow-x-auto text-[11px] leading-[1.6] tabular-nums"
      >
        <For each={props.rows}>
          {(r, i) => {
            const filled = Math.round((r.value / max()) * w());
            const val = ` ${r.value}${r.suffix ?? ""}`;
            return (
              <AsciiFx
                watch={`${r.label}:${r.value}`}
                delayMs={Math.min(i() * 45, 315)}
              >
                <div>
                  <span class="text-zinc-500">
                    {(r.label.length > 14
                      ? r.label.slice(0, 13) + "·"
                      : r.label.padEnd(14, " ")) + " "}
                  </span>
                  <span class="text-amber-500">
                    {"█".repeat(filled)}
                  </span>
                  <span class="text-zinc-300 dark:text-zinc-700">
                    {"░".repeat(Math.max(0, w() - filled))}
                  </span>
                  <span class="text-zinc-600 dark:text-zinc-400">
                    <PixelValue value={val}>{val}</PixelValue>
                  </span>
                </div>
              </AsciiFx>
            );
          }}
        </For>
      </pre>
    </Show>
  );
}

/** ASCII gauge bar for a 0-100 percentage (pure, SSR-safe). */
export function AsciiGauge(props: { pct: number; width?: number }) {
  const w = () => props.width ?? 20;
  const pct = () => Math.max(0, Math.min(100, props.pct));
  const filled = () => Math.round((pct() / 100) * w());
  return (
    <pre
      role="img"
      aria-label={`${pct()} percento`}
      class="overflow-x-auto text-[11px] leading-[1.3] tabular-nums"
    >
      <span class="text-emerald-500">{"█".repeat(filled())}</span>
      <span class="text-zinc-300 dark:text-zinc-700">
        {"░".repeat(Math.max(0, w() - filled()))}
      </span>
      <span class="text-zinc-600 dark:text-zinc-400">{` ${pct()}%`}</span>
    </pre>
  );
}

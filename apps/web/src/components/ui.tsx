import { A } from "@solidjs/router";
import { createEffect, createSignal, For, onMount, Show, type JSX } from "solid-js";
import type { TrainCard, TrainStato, TrainTemporalStatus } from "~/lib/api-types";
import { delayClass, fmtDelay, fmtTime } from "~/lib/format";
import { displayStatus } from "~/lib/api-types";
import { getInitialDark, setThemeCookie } from "~/lib/theme";
import { PixelValue } from "./fx";

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
      role="status"
      class={`inline-flex items-center text-zinc-500 ${props.slim ? "gap-0 text-[11px]" : "gap-2"}`}
    >
      <span
        aria-hidden="true"
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
  return <div aria-hidden="true" class={`shimmer rounded ${props.class ?? "h-12 w-full"}`} />;
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
export function DelayBadge(props: { delay: number; stato?: TrainStato }) {
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
export function TrainStatus(props: { temporalStatus: TrainTemporalStatus; delayStato: TrainStato }) {
  const { label, class: cls } = displayStatus(props.temporalStatus, props.delayStato);
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
      class="grid size-8 place-items-center rounded border border-zinc-300 text-zinc-500 transition-colors hover:text-zinc-900 dark:border-zinc-800 dark:hover:text-zinc-100"
      title={dark() ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={dark() ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={dark()}
    >
      {dark() ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="size-4"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="size-4"
          aria-hidden="true"
        >
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      )}
    </button>
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
        <span class="ml-2 tabular-nums">
          {fmtTime(t().orarioPartenza ?? t().scheduled)} →{" "}
          {fmtTime(t().orarioArrivo ?? t().expected)}
        </span>
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
export function SectionTitle(props: { children: JSX.Element; right?: JSX.Element }) {
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
    <span class="flex items-center gap-1.5 text-xs text-zinc-500" aria-live="polite">
      <span
        aria-hidden="true"
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
  children: JSX.Element;
  class?: string;
}) {
  return (
    <button
      onClick={props.onClick}
      aria-pressed={props.active}
      class={`rounded border px-2 py-1 ${props.active ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 text-zinc-500 dark:border-zinc-700"} ${props.class ?? ""}`}
    >
      {props.children}
    </button>
  );
}

/** Card shell shared by dashboard, ranking and boards. */
export function Card(props: { children: JSX.Element; class?: string }) {
  return (
    <div class={`rounded border border-zinc-200 p-4 dark:border-zinc-800 ${props.class ?? ""}`}>
      {props.children}
    </div>
  );
}

/** Dashed empty state shared by lists and boards. */
export function EmptyState(props: { children: JSX.Element }) {
  return (
    <p class="rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-xs text-zinc-500 dark:border-zinc-700">
      {props.children}
    </p>
  );
}

/** Error box shared by all pages. */
export function ErrorBox(props: { message: string }) {
  return (
    <p class="rounded border border-red-900 px-3 py-2 text-xs text-red-400">
      {props.message}
    </p>
  );
}

/** Search input shared by dashboard + station page. */
export function Field(props: {
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  inputmode?: "numeric" | "text" | "search";
  type?: string;
  label: string;
  class?: string;
}) {
  return (
    <input
      value={props.value}
      onInput={(e) => props.onInput(e.currentTarget.value)}
      placeholder={props.placeholder}
      inputmode={props.inputmode}
      type={props.type ?? "text"}
      aria-label={props.label}
      class={`w-full rounded border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 ${props.inputmode === "numeric" ? "tabular-nums " : ""}${props.class ?? ""}`}
    />
  );
}

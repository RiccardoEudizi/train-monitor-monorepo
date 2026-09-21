import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { RegionStat } from "~/lib/api-types";
import {
  ITALY_REGIONS,
  VIEW_H,
  VIEW_W,
  project,
} from "~/lib/map/italy-regions";
import DitherOverlay from "~/components/map/DitherOverlay";
import ItalyMapSvg from "~/components/map/ItalyMapSvg";

/**
 * Map 1: choropleth with hover/click popup. The popup floats above the
 * region anchor (capital city) with max / media / numero ritardi.
 * Hover previews, click pins (touch-friendly); background click unpins.
 * Popup position is clamped inside the panel and flips below the anchor
 * near the top edge (Lombardia/Veneto anchors sit high).
 */
export default function ChoroplethMap(props: { regions: RegionStat[] }) {
  const [hovered, setHovered] = createSignal<number | null>(null);
  const [pinned, setPinned] = createSignal<number | null>(null);
  const shownId = () => pinned() ?? hovered();

  const stat = createMemo(() =>
    props.regions.find((r) => r.regionId === shownId()),
  );
  const anchor = createMemo(() => {
    const id = shownId();
    if (id == null) return null;
    const poly = ITALY_REGIONS.find((r) => r.id === id);
    if (!poly) return null;
    const [x, y] = project(poly.label[0], poly.label[1]);
    return { fx: x / VIEW_W, fy: y / VIEW_H };
  });

  // Panel size for clamping (client-only; SSR falls back to % + above).
  let box: HTMLDivElement | undefined;
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  onMount(() => {
    const el = box;
    if (!el) return;
    const measure = () =>
      setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  });

  const POP_W = 176; // w-44
  const placement = createMemo(() => {
    const a = anchor();
    if (!a) return null;
    const { w, h } = size();
    if (w === 0 || h === 0) {
      return {
        left: `${a.fx * 100}%`,
        top: `${a.fy * 100}%`,
        transform: "translate(-50%, calc(-100% - 14px))",
        below: false,
      };
    }
    const x = Math.min(Math.max(a.fx * w, POP_W / 2 + 4), w - POP_W / 2 - 4);
    const y = a.fy * h;
    const below = a.fy < 0.32;
    return {
      left: `${x}px`,
      top: `${y}px`,
      transform: below
        ? "translate(-50%, 18px)"
        : "translate(-50%, calc(-100% - 14px))",
      below,
    };
  });

  return (
    <div
      ref={box}
      class="relative overflow-hidden rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#09090b]"
    >
      <ItalyMapSvg
        regions={props.regions}
        activeId={shownId()}
        onHover={setHovered}
        onSelect={(id) => setPinned((p) => (p === id ? null : id))}
        onBackgroundClick={() => setPinned(null)}
      />
      <DitherOverlay animated={false} />
      <Show when={stat() && placement()}>
        <div
          class="pointer-events-none absolute z-10 w-44 rounded border border-zinc-200 bg-white/95 px-3 py-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-950/95"
          style={{
            left: placement()!.left,
            top: placement()!.top,
            transform: placement()!.transform,
          }}
        >
          <p class="truncate text-xs font-bold">{stat()!.name}</p>
          <dl class="mt-1 space-y-0.5 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
            <div class="flex justify-between gap-2">
              <dt>media</dt>
              <dd class="font-bold text-zinc-900 dark:text-zinc-100">+{stat()!.avgDelay}'</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt>max</dt>
              <dd class="font-bold text-zinc-900 dark:text-zinc-100">+{stat()!.maxDelay}'</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt>ritardi</dt>
              <dd class="font-bold text-zinc-900 dark:text-zinc-100">
                {stat()!.delayedCount}
                <span class="font-normal text-zinc-400 dark:text-zinc-500">
                  {" "}
                  / {stat()!.runs} corse
                </span>
              </dd>
            </div>
          </dl>
          {/* stem: below the box by default, above it when flipped */}
          <span
            aria-hidden="true"
            class={
              placement()!.below
                ? "absolute bottom-full left-1/2 block size-2 -translate-x-1/2 translate-y-1 rotate-45 border-l border-t border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950"
                : "absolute left-1/2 top-full block size-2 -translate-x-1/2 -translate-y-1 rotate-45 border-b border-r border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950"
            }
          />
        </div>
      </Show>
    </div>
  );
}

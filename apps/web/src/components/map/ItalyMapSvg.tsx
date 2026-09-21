import { For } from "solid-js";
import type { RegionStat } from "~/lib/api-types";
import {
  ITALY_REGIONS,
  VIEW_H,
  VIEW_W,
  multiToPath,
} from "~/lib/map/italy-regions";
import { dissolvedRegion } from "~/lib/map/dissolve";
import { byRegionId, regionFill } from "~/lib/map/colors";
import { useDark } from "~/lib/theme";

/**
 * Region borders only: no grid, no labels, no streets. Real ISTAT
 * boundaries dissolved per region (internal province borders removed,
 * islands kept), pastel choropleth fills. Hover/click is wired through
 * props — the parent (ChoroplethMap) owns the popup state.
 */
export default function ItalyMapSvg(props: {
  regions?: RegionStat[];
  activeId?: number | null;
  onHover?: (id: number | null) => void;
  onSelect?: (id: number) => void;
  onBackgroundClick?: () => void;
}) {
  const byId = () => byRegionId(props.regions ?? []);
  const dark = useDark();
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      class="block h-auto w-full"
      role="img"
      aria-label="mappa stilizzata dell'Italia"
      preserveAspectRatio="xMidYMid meet"
      onClick={() => props.onBackgroundClick?.()}
    >
      <g stroke-linejoin="round" stroke-linecap="round">
        <For each={ITALY_REGIONS}>
          {(r) => {
            const stat = () => byId().get(r.id);
            const active = () => props.activeId === r.id;
            const style = () => {
              const s = stat();
              if (!s) return { fill: dark() ? "#131316" : "#e4e4e7", opacity: 1 };
              return regionFill(s.avgDelay);
            };
            return (
              <path
                d={multiToPath(dissolvedRegion(r.id))}
                fill={style().fill}
                fill-opacity={style().opacity}
                fill-rule="evenodd"
                stroke={
                  active()
                    ? dark()
                      ? "#ffffff"
                      : "#09090b"
                    : dark()
                      ? "rgba(255,255,255,0.9)"
                      : "rgba(39,39,42,0.55)"
                }
                stroke-width={active() ? 2.5 : 1.5}
                class="cursor-pointer transition-[fill-opacity] duration-300"
                onMouseEnter={(e) => {
                  e.stopPropagation();
                  props.onHover?.(r.id);
                }}
                onMouseLeave={() => props.onHover?.(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onSelect?.(r.id);
                }}
              >
                <title>{stat()?.name ?? r.short}</title>
              </path>
            );
          }}
        </For>
      </g>
    </svg>
  );
}

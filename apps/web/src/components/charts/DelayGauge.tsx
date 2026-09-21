import { createEffect, onCleanup, onMount } from "solid-js";
import { animationFor, Chart, GRID, TICKS, tooltipBase } from "./chartjs";
import { TM } from "./tm-theme";

/** Single emerald bar on a fixed 0–100 scale (Chart.js). */
export default function DelayGauge(props: { pct: number; height?: number }) {
  let canvas!: HTMLCanvasElement;
  let chart: Chart<"bar"> | undefined;

  const pct = () => Math.max(0, Math.min(100, Math.round(props.pct)));

  onMount(() => {
    chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: ["ritardi"],
        datasets: [
          {
            data: [pct()],
            backgroundColor: TM.emerald,
            hoverBackgroundColor: "#34d399",
            borderRadius: 2,
            borderSkipped: false,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: animationFor(600),
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: tooltipBase({
            callbacks: {
              title: () => "in ritardo (>0')",
              label: () => ` ${pct()}%`,
            },
          }),
        },
        scales: {
          x: {
            min: 0,
            max: 100,
            grid: { color: GRID },
            ticks: {
              ...TICKS,
              stepSize: 50,
              callback: (v) => `${v}%`,
            },
          },
          y: { grid: { color: "transparent" }, ticks: TICKS },
        },
      },
    });
    onCleanup(() => chart?.destroy());
  });

  createEffect(() => {
    const c = chart;
    if (!c) return;
    c.data.datasets[0].data = [pct()];
    c.update();
  });

  return (
    <div class="flex items-center gap-2">
      <div
        class="min-w-0 flex-1"
        role="img"
        aria-label={`${pct()} percento treni in ritardo`}
        style={{ position: "relative", height: `${props.height ?? 56}px` }}
      >
        <canvas ref={canvas} aria-label={`${pct()} percento treni in ritardo`} />
      </div>
      <span class="shrink-0 text-[11px] tabular-nums text-zinc-600 dark:text-zinc-400">
        {pct()}%
      </span>
    </div>
  );
}

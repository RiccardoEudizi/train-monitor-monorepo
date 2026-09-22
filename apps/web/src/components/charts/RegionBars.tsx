import { createEffect, onCleanup, onMount } from "solid-js";
import { animationFor, Chart, GRID, TICKS, tooltipBase } from "./chartjs";
import { TM } from "./tm-theme";

export interface RegionBarRow {
  label: string;
  value: number;
  suffix?: string;
}

/** Horizontal amber bars (Chart.js). Same props as before. */
export default function RegionBars(props: { rows: RegionBarRow[]; height?: number }) {
  let canvas!: HTMLCanvasElement;
  let chart: Chart<"bar"> | undefined;

  const data = () => [...props.rows].sort((a, b) => b.value - a.value).slice(0, 8);

  onMount(() => {
    chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: data().map((r) => r.label),
        datasets: [
          {
            data: data().map((r) => r.value),
            backgroundColor: TM.amber,
            hoverBackgroundColor: "#fbbf24",
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
              title: (items) => data()[items[0]?.dataIndex ?? 0]?.label ?? "",
              label: (item) => {
                const r = data()[item.dataIndex];
                return ` +${r?.value ?? 0}${r?.suffix ?? "'"}`;
              },
            },
          }),
        },
        scales: {
          x: { grid: { color: GRID }, ticks: { ...TICKS, maxRotation: 0 } },
          y: {
            grid: { color: "transparent" },
            ticks: {
              ...TICKS,
              maxRotation: 0,
              callback: function (this: any, v: string | number) {
                const label = String(this.getLabelForValue(Number(v)));
                return label.length > 16 ? `${label.slice(0, 15)}…` : label;
              },
            } as unknown as typeof TICKS,
          },
        },
      },
    });
    onCleanup(() => chart?.destroy());
  });

  createEffect(() => {
    const c = chart;
    if (!c) return;
    c.data.labels = data().map((r) => r.label);
    c.data.datasets[0].data = data().map((r) => r.value);
    c.update();
  });

  return (
    <div
      role="img"
      aria-label="top regioni per ritardo cumulato"
      class="w-full max-w-full min-w-0 overflow-hidden"
      style={{
        position: "relative",
        height: `${props.height ?? Math.max(120, data().length * 28 + 32)}px`,
        width: "100%",
        "max-width": "100%",
      }}
    >
      <canvas ref={canvas} aria-label="top regioni per ritardo cumulato" class="max-w-full" />
    </div>
  );
}

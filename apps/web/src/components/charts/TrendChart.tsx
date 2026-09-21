import { createEffect, onCleanup, onMount } from "solid-js";
import { animationFor, Chart, GRID, TICKS, tooltipBase } from "./chartjs";
import { TM } from "./tm-theme";

/**
 * Line + area trend (Chart.js). Same props as the old AsciiTrend
 * version so callers don't change. Client-only via `clientOnly` in routes.
 */
export default function TrendChart(props: {
  values: number[];
  labels?: string[];
  height?: number;
  label?: string;
}) {
  let canvas!: HTMLCanvasElement;
  let chart: Chart<"line"> | undefined;

  const sliced = () => props.values.slice(-31);
  const shortLabels = () => {
    const n = sliced().length;
    const dates = props.labels ?? [];
    const tail = dates.slice(dates.length - n);
    return sliced().map((_, i) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(tail[i] ?? "");
      return m ? `${m[3]}/${m[2]}` : `#${i + 1}`;
    });
  };
  const fullLabel = (i: number) => {
    const n = sliced().length;
    const dates = props.labels ?? [];
    return dates[dates.length - n + i] ?? shortLabels()[i] ?? "";
  };

  onMount(() => {
    chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: shortLabels(),
        datasets: [
          {
            data: sliced(),
            borderColor: TM.amber,
            backgroundColor: TM.amberSoft,
            fill: true,
            tension: 0,
            borderWidth: 1.75,
            pointRadius: 2.5,
            pointBackgroundColor: TM.amber,
            pointBorderColor: TM.amber,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: TM.amber,
            pointHoverBorderColor: "#09090b",
            pointHoverBorderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animationFor(600),
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: tooltipBase({
            callbacks: {
              title: (items) => fullLabel(items[0]?.dataIndex ?? 0),
              label: (item) => ` +${Math.round(Number(item.parsed.y))}'`,
            },
          }),
        },
        scales: {
          x: { grid: { color: "transparent" }, ticks: { ...TICKS, maxTicksLimit: 4 } },
          y: { grid: { color: GRID }, ticks: TICKS, beginAtZero: true },
        },
      },
    });
    onCleanup(() => chart?.destroy());
  });

  createEffect(() => {
    const c = chart;
    if (!c) return;
    c.data.labels = shortLabels();
    c.data.datasets[0].data = sliced();
    c.update();
  });

  return (
    <div
      role="img"
      aria-label={props.label ?? "trend ritardi"}
      style={{ position: "relative", height: `${props.height ?? 96}px` }}
    >
      <canvas ref={canvas} aria-label={props.label ?? "trend ritardi"} />
    </div>
  );
}

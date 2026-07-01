<script lang="ts">
  // Tiny model-split growth sparkline. Each state is normalized to its own max,
  // so the chart shows the shape of growth (are we going up?) rather than
  // magnitude — the point being: scan the column and see whether they all climb.
  export let series: { jail: number[]; taskforce: number[]; wso: number[] };
  export let label = "";

  const LINES = [
    { key: "jail", color: "var(--color-model-jail)" },
    { key: "taskforce", color: "var(--color-model-taskforce)" },
    { key: "wso", color: "var(--color-model-wso)" },
  ] as const;

  const W = 120;
  const H = 34;
  const PAD = { t: 3, r: 3, b: 3, l: 2 };

  const xAt = (i: number, n: number) =>
    PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const yAt = (v: number, max: number) =>
    PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);

  $: n = Math.max(series.jail.length, series.taskforce.length, series.wso.length, 1);
  $: max = Math.max(1, ...series.jail, ...series.taskforce, ...series.wso);
  $: paths = LINES.map((l) => ({
    color: l.color,
    d: series[l.key].some((v) => v > 0)
      ? series[l.key].map((v, i) => `${i ? "L" : "M"}${xAt(i, n).toFixed(1)},${yAt(v, max).toFixed(1)}`).join(" ")
      : null,
  }));
</script>

<svg
  viewBox="0 0 {W} {H}"
  class="block h-full w-full"
  role="img"
  aria-label={label}
  preserveAspectRatio="none"
>
  <!-- Zero baseline -->
  <line
    x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b}
    stroke="#e2e8f0" stroke-width="1" vector-effect="non-scaling-stroke"
  />
  {#each paths as p}
    {#if p.d}
      <path
        d={p.d}
        fill="none"
        stroke={p.color}
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
    {/if}
  {/each}
</svg>

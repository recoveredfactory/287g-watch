<script lang="ts">
  // Small labeled multi-line growth chart: the three model trajectories on one
  // per-state-normalized axis, with a y-peak label, the month range, and colored
  // end-values that tie each line back to its model (and to the topline counts).
  // The comparison of the lines is the point — this is not a bare sparkline.
  export let series: { jail: number[]; taskforce: number[]; wso: number[] };
  export let startLabel = "";
  export let endLabel = "";
  export let label = "";

  // Bright stroke + dark text tint per model (matches $lib/colors).
  const LINES = [
    { key: "wso", stroke: "#5E9148", text: "#2F4A22" },
    { key: "taskforce", stroke: "#3C97E2", text: "#1A4A7A" },
    { key: "jail", stroke: "#BE6079", text: "#6B1F33" },
  ] as const;

  const W = 140;
  const H = 70;
  const PAD = { t: 9, r: 24, b: 12, l: 8 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const xAt = (i: number, n: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const yAt = (v: number, max: number) => PAD.t + (1 - v / max) * plotH;

  $: n = Math.max(series.jail.length, series.taskforce.length, series.wso.length, 1);
  $: max = Math.max(1, ...series.jail, ...series.taskforce, ...series.wso);

  $: lines = LINES.map((l) => {
    const vals = series[l.key];
    const final = vals[vals.length - 1] ?? 0;
    return {
      ...l,
      has: vals.some((v) => v > 0),
      d: vals.map((v, i) => `${i ? "L" : "M"}${xAt(i, n).toFixed(1)},${yAt(v, max).toFixed(1)}`).join(" "),
      final,
      fy: yAt(final, max),
    };
  });

  // Nudge end-value labels apart (keeping vertical order) so close finals don't
  // collide.
  $: endLabels = (() => {
    const items = lines.filter((l) => l.has).map((l) => ({ text: l.text, final: l.final, y: l.fy }));
    items.sort((a, b) => a.y - b.y);
    const GAP = 7;
    for (let i = 1; i < items.length; i++)
      if (items[i].y - items[i - 1].y < GAP) items[i].y = items[i - 1].y + GAP;
    return items;
  })();
</script>

<svg viewBox="0 0 {W} {H}" class="block h-full w-full" role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
  <!-- axes: zero baseline + faint peak gridline -->
  <line x1={PAD.l} y1={PAD.t + plotH} x2={PAD.l + plotW} y2={PAD.t + plotH} stroke="#cbd5e1" stroke-width="0.6" />
  <line x1={PAD.l} y1={PAD.t} x2={PAD.l + plotW} y2={PAD.t} stroke="#eef2f6" stroke-width="0.6" />

  <!-- labels: y peak + month range -->
  <text x={PAD.l} y={PAD.t - 2.5} fill="#94a3b8" style="font-size:5px; font-weight:600;">{max}</text>
  <text x={PAD.l} y={H - 3.5} fill="#94a3b8" style="font-size:5px;">{startLabel}</text>
  <text x={PAD.l + plotW} y={H - 3.5} text-anchor="end" fill="#94a3b8" style="font-size:5px;">{endLabel}</text>

  <!-- model trajectories -->
  {#each lines as l}
    {#if l.has}
      <path d={l.d} fill="none" stroke={l.stroke} stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
    {/if}
  {/each}

  <!-- end-of-line values -->
  {#each endLabels as e}
    <text x={PAD.l + plotW + 2.5} y={e.y + 1.8} fill={e.text} style="font-size:5.5px; font-weight:700;">{e.final}</text>
  {/each}
</svg>

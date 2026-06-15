<script lang="ts">
  // ── National trend chart, video variant (#167) ──────────────────────────────
  // A dark, tall, bright-on-dark cut of the home trend chart, tailored for the
  // /video/national social composite. Differences from TrendCharts.svelte:
  //   • dark theme (transparent bg, light axis, map model colors for the lines)
  //   • lines GROW to the cursor (not drawn full), with a playhead dot at the end
  //   • no legend/chrome — instead each line carries a BIG end label:
  //         <Model name>
  //         <X,XXX> agreements      (the count AT the cursor, dynamic)
  // Shares the precomputed national series + the Jan-2025 month-index epoch with
  // TrendCharts, so the playhead lines up with the map cursor.
  import { MODEL_ORDER, MODEL_COLORS, MODEL_SLUG } from "$lib/colors";
  import { interpAt } from "$lib/trendSample";

  type TrendSeries = { jail: number[]; taskforce: number[]; wso: number[] };
  export let trendMonths: string[] = [];
  export let trend: Record<string, TrendSeries> = {};
  // Fractional-month cursor (same epoch as the map). Lines grow to here.
  export let cursorIdx: number | null = null;
  // Drawing height in px (viewBox units render 1:1 against the container width).
  export let height = 560;

  const nf = new Intl.NumberFormat();
  const EPOCH_YEAR = 2025;
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabelShort = (idx: number) =>
    `${MONTH_NAMES[((idx % 12) + 12) % 12]} ’${String(EPOCH_YEAR + Math.floor(idx / 12)).slice(2)}`;

  $: months = trendMonths.map(
    (ym) => (Number(ym.slice(0, 4)) - EPOCH_YEAR) * 12 + (Number(ym.slice(5, 7)) - 1),
  );
  $: START_IDX = months[0] ?? -1;
  $: endIdx = months[months.length - 1] ?? START_IDX;

  // National series only.
  $: nat = trend[""] ?? { jail: [], taskforce: [], wso: [] };
  $: series = MODEL_ORDER.map((model) => ({
    model,
    values: nat[MODEL_SLUG[model] as keyof TrendSeries] ?? [],
  }));
  $: maxModel = Math.max(1, ...series.flatMap((s) => s.values));

  // Geometry. Wide right margin for the big end labels; the plot itself is
  // "a smidge narrower" than the homepage chart as a result.
  let measuredW = 0;
  $: W = Math.max(640, Math.round(measuredW) || 980);
  $: H = height;
  const PAD = { t: 34, r: 360, b: 46, l: 30 };
  $: innerW = W - PAD.l - PAD.r;
  $: innerH = H - PAD.t - PAD.b;
  $: baselineY = PAD.t + innerH;
  $: xAt = (m: number) =>
    PAD.l + (endIdx === START_IDX ? innerW : ((m - START_IDX) / (endIdx - START_IDX)) * innerW);
  $: yAt = (v: number) => PAD.t + innerH - (v / maxModel) * innerH;

  // Cursor clamped into the plotted range (it can run just past endIdx during
  // the "today" hold). null cursor → treat as fully drawn (endIdx).
  $: cur = cursorIdx == null ? endIdx : Math.min(Math.max(cursorIdx, START_IDX), endIdx);

  // Value of a series at the (fractional) cursor — linearly interpolated so the
  // dot, the line's leading edge, and the big labels all glide instead of
  // snapping at month boundaries. Deterministic in cursor → bake-exact (shared
  // with the video counter's "agreements" figure via $lib/trendSample).
  $: valAt = (values: number[]) => interpAt(values, months, cur);

  // Smooth line GROWN to the cursor: a polyline through the monthly points up to
  // the cursor, ending at the interpolated cursor value.
  $: growPath = (values: number[]): string => {
    if (!values.length) return "";
    let d = `M${xAt(months[0]).toFixed(1)} ${yAt(values[0]).toFixed(1)}`;
    for (let i = 1; i < months.length; i++) {
      if (months[i] > cur) break;
      d += ` L${xAt(months[i]).toFixed(1)} ${yAt(values[i]).toFixed(1)}`;
    }
    d += ` L${xAt(cur).toFixed(1)} ${yAt(valAt(values)).toFixed(1)}`;
    return d;
  };

  // Big end labels, anchored near each line's current value-y, spread so the
  // two-line blocks don't collide; clamped within the plot.
  // Two-pass clamp-and-cascade: place each label near its line's value-y without
  // overlap. Top-down enforces the min gap from the top bound; bottom-up from the
  // bottom bound. A label only moves when it actually collides with a neighbour
  // or an edge — unlike a global shift, which shoved *every* label whenever the
  // top line spiked, making the mid-rank label visibly bob up then settle even
  // though its own value rose monotonically.
  function spreadY(ys: number[], gap: number): number[] {
    const top = PAD.t + 18;
    const bottom = baselineY + 6;
    const order = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b]);
    const placed = order.map((i) => ys[i]);
    placed[0] = Math.max(placed[0], top);
    for (let i = 1; i < placed.length; i++)
      placed[i] = Math.max(placed[i], placed[i - 1] + gap);
    placed[placed.length - 1] = Math.min(placed[placed.length - 1], bottom);
    for (let i = placed.length - 2; i >= 0; i--)
      placed[i] = Math.min(placed[i], placed[i + 1] - gap);
    const out = new Array(ys.length);
    order.forEach((orig, k) => (out[orig] = placed[k]));
    return out;
  }
  $: endLabels = (() => {
    const vals = series.map((s) => valAt(s.values));
    const ys = spreadY(vals.map((v) => yAt(v)), 96);
    return series.map((s, i) => ({ model: s.model, value: Math.round(vals[i]), y: ys[i] }));
  })();
  $: labelX = W - PAD.r + 22; // left edge of the big-label column
  $: dotX = xAt(cur);

  // x-axis: 4 evenly spaced month ticks incl. first + last.
  $: ticks = (() => {
    const n = months.length;
    if (n <= 1) return months;
    const count = Math.min(n, 4);
    const set = new Set<number>();
    for (let i = 0; i < count; i++) set.add(months[Math.round((i * (n - 1)) / (count - 1))]);
    return [...set];
  })();
  // A few faint horizontal gridlines for depth (no numbers — the big labels carry values).
  $: gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => PAD.t + innerH * f);
</script>

<div class="vtc" bind:clientWidth={measuredW}>
  {#if months.length > 1}
    <svg viewBox="0 0 {W} {H}" class="block w-full" role="img" aria-label="Active 287(g) agreements by model since December 2024">
      {#each gridYs as gy}
        <line x1={PAD.l} y1={gy} x2={W - PAD.r} y2={gy} stroke="rgba(255,255,255,0.16)" />
      {/each}
      {#each ticks as t, i}
        <text x={xAt(t)} y={H - 12} text-anchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"} fill="#94a3b8" style="font-size: 22px;">{monthLabelShort(t)}</text>
      {/each}

      {#each series as s}
        <path d={growPath(s.values)} fill="none" stroke={MODEL_COLORS[s.model]} stroke-width="4" stroke-linejoin="round" stroke-linecap="round" />
      {/each}

      <!-- Playhead: vertical guide + a dot riding each growing line -->
      <line x1={dotX} y1={PAD.t} x2={dotX} y2={baselineY} stroke="rgba(255,255,255,0.28)" stroke-width="1.5" stroke-dasharray="5 4" />
      {#each series as s}
        <circle cx={dotX} cy={yAt(valAt(s.values))} r="6" fill={MODEL_COLORS[s.model]} stroke="#0c1117" stroke-width="2" />
      {/each}

      <!-- Big end labels: model name + live count -->
      {#each endLabels as l}
        <text x={labelX} y={l.y - 6} fill={MODEL_COLORS[l.model]} style="font-size: 24px; font-weight: 600;">{l.model}</text>
        <text x={labelX} y={l.y + 34} fill="#ffffff" style="font-weight: 800;">
          <tspan style="font-size: 46px;" fill={MODEL_COLORS[l.model]}>{nf.format(l.value)}</tspan><tspan dx="10" style="font-size: 24px; font-weight: 600;" fill="#cbd5e1">agreements</tspan>
        </text>
      {/each}
    </svg>
  {/if}
</div>

<style>
  .vtc {
    width: 100%;
  }
</style>

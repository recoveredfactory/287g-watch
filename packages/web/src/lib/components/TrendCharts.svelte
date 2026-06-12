<script lang="ts">
  // ── Trend chart (#162) ─────────────────────────────────────────────────────
  // Stepped multi-series line of *active* agency–model agreements over time,
  // since Dec 2024. Each model an agency holds is one agreement, so an agency
  // with two models contributes to two series — the lines multi-count and their
  // right edges match the model cards' `modelCounts`. Unlike a cumulative curve,
  // lines dip when agreements terminate or an agency drops a model.
  //
  // Series arrive precomputed from the server — history events (live +
  // terminated agencies) replayed through buildTimeline, sampled monthly — so
  // the client never ships per-agency history. The timeline begins Dec 2024
  // (the last pre-2025 archived snapshot, a pre-Trump baseline); earlier history
  // folds into the Dec 2024 level.
  import { MODEL_COLORS, MODEL_ORDER, MODEL_MINI, MODEL_SLUG } from "$lib/colors";
  import ModelLink from "$lib/components/ModelLink.svelte";

  type TrendSeries = { jail: number[]; taskforce: number[]; wso: number[] };
  // "YYYY-MM" sample labels and per-scope series ("" = national or state scope),
  // index-aligned.
  export let trendMonths: string[] = [];
  export let trend: Record<string, TrendSeries> = {};

  const nf = new Intl.NumberFormat();

  // ── Time axis ───────────────────────────────────────────────────────────────
  // Months are integer indices relative to a Jan 2025 epoch (Dec 2024 = -1),
  // derived from the server's "YYYY-MM" sample labels.
  const EPOCH_YEAR = 2025;
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabelShort = (idx: number) =>
    `${MONTH_NAMES[((idx % 12) + 12) % 12]} '${String(EPOCH_YEAR + Math.floor(idx / 12)).slice(2)}`;

  $: months = trendMonths.map(
    (ym) => (Number(ym.slice(0, 4)) - EPOCH_YEAR) * 12 + (Number(ym.slice(5, 7)) - 1),
  );
  $: START_IDX = months[0] ?? -1;
  $: endIdx = months[months.length - 1] ?? START_IDX;

  // ── Series: active agreements per model, over months ────────────────────────
  // Always uses the "" scope (national, or state-scoped data from state pages).
  $: scopedTrend = trend[""] ?? { jail: [], taskforce: [], wso: [] };
  $: series = MODEL_ORDER.map((model) => {
    const values = scopedTrend[MODEL_SLUG[model] as keyof TrendSeries] ?? [];
    return { model, values, first: values[0] ?? 0, final: values[values.length - 1] ?? 0 };
  });
  $: maxModel = Math.max(1, ...series.flatMap((s) => s.values));
  $: totalAgreements = series.reduce((n, s) => n + s.final, 0);

  // ── Geometry / scales ───────────────────────────────────────────────────────
  // The viewBox width tracks the rendered width 1:1 (via bind:clientWidth), so
  // the chart fills whatever the container gives it and type renders at its
  // true pixel size on every viewport. Height stays fixed.
  let measuredW = 0;
  $: W = Math.max(360, Math.round(measuredW) || 520);
  const H = 370;
  const PAD = { t: 14, r: 104, b: 26, l: 40 };
  $: innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const baselineY = PAD.t + innerH;
  $: xAt = (m: number) =>
    PAD.l + (endIdx === START_IDX ? innerW : ((m - START_IDX) / (endIdx - START_IDX)) * innerW);
  $: yAt = (v: number) => PAD.t + innerH - (v / maxModel) * innerH;

  // Stepped path: hold the previous value across the month, then jump.
  $: stepPath = (values: number[]): string => {
    if (!values.length) return "";
    let d = `M${xAt(months[0]).toFixed(1)} ${yAt(values[0]).toFixed(1)}`;
    for (let i = 1; i < values.length; i++) {
      d += ` L${xAt(months[i]).toFixed(1)} ${yAt(values[i - 1]).toFixed(1)} L${xAt(months[i]).toFixed(1)} ${yAt(values[i]).toFixed(1)}`;
    }
    return d;
  };

  // Nudge label anchor-ys apart so direct labels don't collide vertically.
  function spreadY(ys: number[], gap = 14): number[] {
    if (ys.length < 2) return [...ys];
    const order = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b]);
    const placed = order.map((i) => ys[i]);
    for (let i = 1; i < placed.length; i++) {
      if (placed[i] - placed[i - 1] < gap) placed[i] = placed[i - 1] + gap;
    }
    const overflow = placed[placed.length - 1] - baselineY;
    if (overflow > 0) for (let i = 0; i < placed.length; i++) placed[i] -= overflow;
    if (placed[0] < PAD.t) {
      const under = PAD.t - placed[0];
      for (let i = 0; i < placed.length; i++) placed[i] += under;
    }
    const out = new Array(ys.length);
    order.forEach((orig, k) => (out[orig] = placed[k]));
    return out;
  }

  // Y axis: a few round, integer ticks.
  $: yTicks = (() => {
    const raw = Math.max(1, maxModel / 3);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = Math.max(1, Math.round((norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag));
    const out: number[] = [];
    for (let v = 0; v <= maxModel; v += step) out.push(v);
    return out;
  })();
  $: gridYs = yTicks.map((t) => yAt(t));

  // X axis: evenly spaced months including first and last.
  $: ticks = (() => {
    const n = months.length;
    if (n <= 1) return months;
    const count = Math.min(n, 5, Math.max(3, Math.floor(innerW / 90) + 1));
    const set = new Set<number>();
    for (let i = 0; i < count; i++) set.add(months[Math.round((i * (n - 1)) / (count - 1))]);
    return [...set];
  })();

  $: endLabelY = spreadY(series.map((s) => yAt(s.final)));
  $: startLabels = (() => {
    const picked = series.filter(
      (s) => s.first > 0 && !gridYs.some((gy) => Math.abs(yAt(s.first) - gy) < 9),
    );
    const ys = spreadY(picked.map((s) => yAt(s.first)));
    return picked.map((s, i) => ({ model: s.model, value: s.first, y: ys[i] }));
  })();
</script>

<section class="border-b border-slate-200 bg-white px-4 py-10 sm:px-6 sm:py-12">
  <div class="mx-auto max-w-[720px]">
    <h2 class="font-serif text-xl font-bold text-slate-900 sm:text-2xl">
      How participation has grown
    </h2>
    <p class="mt-1 text-sm text-slate-600">
      Active 287(g) agreements by model since Dec&nbsp;2024.
    </p>
    <p class="mt-2 text-sm text-slate-500">
      <span class="font-semibold text-slate-900">{nf.format(totalAgreements)}</span>
      {totalAgreements === 1 ? "agreement" : "agreements"} active.
    </p>

    <!-- Legend -->
    <div class="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {#each series as s}
        <span class="inline-flex items-center gap-1.5 text-slate-700">
          <span class="inline-block h-2.5 w-2.5 rounded-sm" style="background: {MODEL_COLORS[s.model]};"></span>
          <ModelLink model={s.model} />
          <span class="text-slate-400">{MODEL_MINI[s.model] ?? ""}</span>
          <span class="font-semibold text-slate-900">{nf.format(s.final)}</span>
        </span>
      {/each}
    </div>

    {#if months.length > 1}
    <div class="mt-4" bind:clientWidth={measuredW}>
      <svg viewBox="0 0 {W} {H}" class="block w-full" role="img" aria-label="Active 287(g) agreements by model since December 2024">
        <!-- Y gridlines + labels -->
        {#each yTicks as t}
          <line x1={PAD.l} y1={yAt(t)} x2={W - PAD.r} y2={yAt(t)} stroke="#eef2f6" />
          <text x={PAD.l - 6} y={yAt(t) + 3} text-anchor="end" class="fill-slate-400" style="font-size: 11px;">{nf.format(t)}</text>
        {/each}
        <!-- X labels -->
        {#each ticks as t, i}
          <text x={xAt(t)} y={H - 8} text-anchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"} class="fill-slate-400" style="font-size: 11px;">{monthLabelShort(t)}</text>
        {/each}

        <!-- Stepped lines -->
        {#each series as s}
          <path d={stepPath(s.values)} fill="none" stroke="{MODEL_COLORS[s.model]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
        {/each}

        <!-- Direct start labels -->
        {#each startLabels as l}
          <text x={xAt(START_IDX) - 5} y={l.y + 4} text-anchor="end"
            style="font-size: 11px; font-weight: 600;" fill={MODEL_COLORS[l.model]}>{nf.format(l.value)}</text>
        {/each}

        <!-- Direct end labels: mini code + current count -->
        {#each series as s, i}
          <text x={xAt(endIdx) + 6} y={endLabelY[i] + 4} text-anchor="start"
            style="font-size: 11px; font-weight: 600;" fill={MODEL_COLORS[s.model]}>{MODEL_MINI[s.model] ?? ""} {nf.format(s.final)}</text>
        {/each}
      </svg>
    </div>
    {/if}

    <p class="mt-3 text-xs italic text-slate-400">
      Experimental (#162). Each line counts active agency–model agreements, so an agency with two models counts once per model. Changes are dated by when they appear in ICE's published list; the Dec&nbsp;2024 level carries everything signed before then, and the archive has no snapshots between mid-Dec 2024 and early Mar 2025, so the lines run flat there.
    </p>
  </div>
</section>

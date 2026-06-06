<script lang="ts">
  // ── National trend charts (experimental, #162) ─────────────────────────────
  // Low-key growth charts for the home page. Three variations behind a selector
  // so we can play with which reads best before committing to placement. Series
  // are cumulative agency counts by *primary model* — primary_model is exclusive
  // (one per agency, same field the map colours its dots by), so the three
  // series sum to the total and the stacked area is honest. Counting every model
  // an agency holds would double-count and break the stack.
  //
  // The timeline begins May 2025 (the first month with a complete dataset, same
  // TIMELINE_START as the map). Every signing on or before May 2025 is folded
  // into the May baseline; later signings step the line up in their month.
  import { MODEL_COLORS, MODEL_ORDER, MODEL_SHORT } from "$lib/colors";

  type Agency = {
    primary_model?: string;
    signed_date?: string | null;
  };
  export let agencies: Agency[] = [];

  type Variation = "lines" | "small" | "area";
  let variation: Variation = "lines";
  const VARIATIONS: { id: Variation; label: string }[] = [
    { id: "lines", label: "Multi-series" },
    { id: "small", label: "Small multiples" },
    { id: "area", label: "Stacked area" },
  ];

  const EPOCH_YEAR = 2025;
  const START_IDX = 4; // May 2025, relative to the Jan 2025 epoch
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabel = (idx: number) => `${MONTH_NAMES[((idx % 12) + 12) % 12]} ${EPOCH_YEAR + Math.floor(idx / 12)}`;
  const monthLabelShort = (idx: number) => `${MONTH_NAMES[((idx % 12) + 12) % 12]} ’${String(EPOCH_YEAR + Math.floor(idx / 12)).slice(2)}`;

  // Signing date → integer month index. Anything before May 2025 (or undated)
  // folds into the May baseline so the line starts from the standing total.
  const effectiveMonth = (d: string | null | undefined): number => {
    if (!d || d.length < 7) return START_IDX;
    const y = Number(d.slice(0, 4));
    const mo = Number(d.slice(5, 7));
    if (!y || !mo) return START_IDX;
    return Math.max(START_IDX, (y - EPOCH_YEAR) * 12 + (mo - 1));
  };

  const today = new Date();
  const endIdx = Math.max(START_IDX, (today.getUTCFullYear() - EPOCH_YEAR) * 12 + today.getUTCMonth());

  // months: every integer month index from May 2025 through the current month.
  $: months = Array.from({ length: endIdx - START_IDX + 1 }, (_, i) => START_IDX + i);

  // For each model, the cumulative count of agencies signed by each month.
  $: series = MODEL_ORDER.map((model) => {
    const signedMonths = agencies
      .filter((a) => a.primary_model === model)
      .map((a) => effectiveMonth(a.signed_date));
    const values = months.map((m) => signedMonths.filter((sm) => sm <= m).length);
    return { model, values, final: values[values.length - 1] ?? 0 };
  });
  $: totals = months.map((_, i) => series.reduce((sum, s) => sum + s.values[i], 0));
  $: maxTotal = Math.max(1, ...totals);
  $: maxModel = Math.max(1, ...series.flatMap((s) => s.values));

  // ── Geometry / scales (manual; keeps us off a charting dep) ─────────────────
  const W = 640;
  const H = 230;
  const PAD = { t: 14, r: 14, b: 24, l: 34 };
  $: innerW = W - PAD.l - PAD.r;
  $: innerH = H - PAD.t - PAD.b;
  $: xAt = (m: number) =>
    PAD.l + (months.length <= 1 ? innerW : ((m - START_IDX) / (endIdx - START_IDX)) * innerW);
  const yAtFor = (yMax: number) => (v: number) => PAD.t + innerH - (v / yMax) * innerH;

  // "M x y L x y …" path through a values array, at a given y-scale.
  const linePath = (values: number[], yMax: number) =>
    values.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(months[i]).toFixed(1)} ${yAtFor(yMax)(v).toFixed(1)}`).join(" ");

  // Stacked-area bands: each model sits on the running total beneath it.
  $: stacked = (() => {
    const below = months.map(() => 0);
    return series.map((s) => {
      const top = s.values.map((v, i) => below[i] + v);
      const band = {
        model: s.model,
        // top edge left→right, then bottom edge right→left
        path:
          top.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(months[i]).toFixed(1)} ${yAtFor(maxTotal)(v).toFixed(1)}`).join(" ") +
          " " +
          below
            .map((v, i) => `L${xAt(months[months.length - 1 - i]).toFixed(1)} ${yAtFor(maxTotal)(below[months.length - 1 - i]).toFixed(1)}`)
            .slice()
            .join(" ") +
          " Z",
      };
      for (let i = 0; i < below.length; i++) below[i] = top[i];
      return band;
    });
  })();

  // x-axis ticks: first, last, and a couple between — keep it sparse.
  $: ticks = (() => {
    if (months.length <= 1) return months;
    const step = Math.max(1, Math.ceil(months.length / 4));
    const out: number[] = [];
    for (let i = 0; i < months.length; i += step) out.push(months[i]);
    if (out[out.length - 1] !== months[months.length - 1]) out.push(months[months.length - 1]);
    return out;
  })();
  // y-axis ticks for the active scale.
  const yTicks = (yMax: number) => {
    const step = Math.max(1, Math.round(yMax / 3 / 50) * 50) || Math.ceil(yMax / 3);
    const out: number[] = [];
    for (let v = 0; v <= yMax; v += step) out.push(v);
    if (out[out.length - 1] !== yMax) out.push(yMax);
    return out;
  };
</script>

<section class="border-b border-slate-200 bg-white px-4 py-10 sm:px-6 sm:py-12">
  <div class="mx-auto max-w-6xl">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 class="font-serif text-xl font-bold text-slate-900 sm:text-2xl">How participation has grown</h2>
        <p class="mt-1 text-sm text-slate-600">Cumulative agencies by primary model, since May&nbsp;2025.</p>
      </div>
      <!-- Variation selector — scaffolding for #162; we’re picking a direction. -->
      <div class="inline-flex shrink-0 rounded border border-slate-300 bg-stone-50 p-0.5 text-sm" role="tablist" aria-label="Chart style">
        {#each VARIATIONS as v}
          <button
            type="button"
            role="tab"
            aria-selected={variation === v.id}
            class="rounded px-3 py-1 font-medium transition {variation === v.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}"
            on:click={() => (variation = v.id)}
          >{v.label}</button>
        {/each}
      </div>
    </div>

    <!-- Legend (shared across variations) -->
    <div class="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {#each series as s}
        <span class="inline-flex items-center gap-1.5">
          <span class="inline-block h-2.5 w-2.5 rounded-sm" style="background: {MODEL_COLORS[s.model]};"></span>
          <span class="text-slate-700">{MODEL_SHORT[s.model] ?? s.model}</span>
          <span class="font-semibold text-slate-900">{s.final}</span>
        </span>
      {/each}
    </div>

    <div class="mt-4">
      {#if variation === "small"}
        <!-- ── Small multiples: one mini panel per model, shared y-scale ──────── -->
        <div class="grid gap-4 sm:grid-cols-3">
          {#each series as s}
            <figure class="rounded border border-slate-200 bg-stone-50/60 p-3">
              <figcaption class="mb-1 flex items-baseline justify-between">
                <span class="text-sm font-semibold text-slate-800">{MODEL_SHORT[s.model] ?? s.model}</span>
                <span class="text-xs text-slate-500">{s.final} agencies</span>
              </figcaption>
              <svg viewBox="0 0 {W} {H}" class="block w-full" role="img" aria-label="{MODEL_SHORT[s.model]} cumulative trend">
                <line x1={PAD.l} y1={PAD.t + innerH} x2={W - PAD.r} y2={PAD.t + innerH} stroke="#e2e8f0" />
                <path d="{linePath(s.values, maxModel)} L{xAt(endIdx).toFixed(1)} {(PAD.t + innerH).toFixed(1)} L{xAt(START_IDX).toFixed(1)} {(PAD.t + innerH).toFixed(1)} Z" fill="{MODEL_COLORS[s.model]}" fill-opacity="0.12" />
                <path d={linePath(s.values, maxModel)} fill="none" stroke="{MODEL_COLORS[s.model]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
                <text x={PAD.l} y={PAD.t + innerH + 16} class="fill-slate-400" style="font-size: 11px;">{monthLabelShort(START_IDX)}</text>
                <text x={W - PAD.r} y={PAD.t + innerH + 16} text-anchor="end" class="fill-slate-400" style="font-size: 11px;">{monthLabelShort(endIdx)}</text>
              </svg>
            </figure>
          {/each}
        </div>
      {:else}
        <!-- ── Multi-series line  /  Stacked area ─────────────────────────────── -->
        <svg viewBox="0 0 {W} {H}" class="block w-full" role="img" aria-label="Cumulative 287(g) agencies by model since May 2025">
          <!-- y gridlines + labels -->
          {#each yTicks(variation === "area" ? maxTotal : maxModel) as t}
            {@const y = yAtFor(variation === "area" ? maxTotal : maxModel)(t)}
            <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="#eef2f6" />
            <text x={PAD.l - 6} y={y + 3} text-anchor="end" class="fill-slate-400" style="font-size: 11px;">{t}</text>
          {/each}
          <!-- x labels -->
          {#each ticks as t}
            <text x={xAt(t)} y={H - 6} text-anchor="middle" class="fill-slate-400" style="font-size: 11px;">{monthLabelShort(t)}</text>
          {/each}

          {#if variation === "area"}
            {#each stacked as band}
              <path d={band.path} fill="{MODEL_COLORS[band.model]}" fill-opacity="0.82" />
            {/each}
          {:else}
            {#each series as s}
              <path d={linePath(s.values, maxModel)} fill="none" stroke="{MODEL_COLORS[s.model]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
            {/each}
          {/if}
        </svg>
      {/if}
    </div>

    <p class="mt-3 text-xs italic text-slate-400">
      Experimental (#162). Series count agencies by primary model and fold all pre-May-2025 signings into the May baseline.
    </p>
  </div>
</section>

<script lang="ts">
  // ── National trend charts (experimental, #162) ─────────────────────────────
  // Low-key growth charts for the home page. Everything here is behind selectors
  // so we can play with what reads best before committing to placement:
  //   • variation — multi-series line · small multiples · stacked area
  //   • curve     — stepped · linear · smooth (cumulative counts → stepped reads
  //                 most honestly; the others are here to compare)
  //   • state     — National, or a single state in isolation
  //
  // Series are cumulative agency counts by *primary model* — primary_model is
  // exclusive (one per agency, same field the map colours its dots by), so the
  // three series sum to the total and the stacked area is honest. Counting every
  // model an agency holds would double-count and break the stack.
  //
  // The timeline begins May 2025 (first month with a complete dataset, same
  // TIMELINE_START as the map). Pre-May-2025 signings fold into the May baseline.
  import { MODEL_COLORS, MODEL_ORDER, MODEL_SHORT } from "$lib/colors";
  import { STATE_NAMES } from "$lib/states";

  type Agency = {
    primary_model?: string;
    signed_date?: string | null;
    state?: string;
  };
  export let agencies: Agency[] = [];

  // ── Selectors ───────────────────────────────────────────────────────────────
  type Variation = "lines" | "small" | "area";
  let variation: Variation = "lines";
  const VARIATIONS: { id: Variation; label: string }[] = [
    { id: "lines", label: "Multi-series" },
    { id: "small", label: "Small multiples" },
    { id: "area", label: "Stacked area" },
  ];

  type Curve = "step" | "linear" | "smooth";
  let curve: Curve = "step";
  const CURVES: { id: Curve; label: string }[] = [
    { id: "step", label: "Stepped" },
    { id: "linear", label: "Linear" },
    { id: "smooth", label: "Smooth" },
  ];

  let selectedState = ""; // "" = National
  $: stateOptions = [...new Set(agencies.map((a) => a.state).filter(Boolean) as string[])].sort(
    (a, b) => (STATE_NAMES[a] ?? a).localeCompare(STATE_NAMES[b] ?? b),
  );
  $: scoped = selectedState ? agencies.filter((a) => a.state === selectedState) : agencies;

  // ── Time axis ───────────────────────────────────────────────────────────────
  const EPOCH_YEAR = 2025;
  const START_IDX = 4; // May 2025, relative to the Jan 2025 epoch
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabelShort = (idx: number) =>
    `${MONTH_NAMES[((idx % 12) + 12) % 12]} ’${String(EPOCH_YEAR + Math.floor(idx / 12)).slice(2)}`;

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
  $: months = Array.from({ length: endIdx - START_IDX + 1 }, (_, i) => START_IDX + i);

  // ── Series: cumulative count per model, over months ─────────────────────────
  $: series = MODEL_ORDER.map((model) => {
    const signedMonths = scoped
      .filter((a) => a.primary_model === model)
      .map((a) => effectiveMonth(a.signed_date));
    const values = months.map((m) => signedMonths.filter((sm) => sm <= m).length);
    return { model, values, final: values[values.length - 1] ?? 0 };
  });
  $: totals = months.map((_, i) => series.reduce((sum, s) => sum + s.values[i], 0));
  $: maxTotal = Math.max(1, ...totals);
  $: maxModel = Math.max(1, ...series.flatMap((s) => s.values));

  // ── Geometry / scales (manual; keeps us off a charting dep) ─────────────────
  // Taller-than-wide on purpose: the wide aspect flattened everything once the
  // Task Force series dwarfed the others (#162 feedback).
  const W = 460;
  const H = 380;
  const PAD = { t: 14, r: 14, b: 26, l: 36 };
  $: innerW = W - PAD.l - PAD.r;
  $: innerH = H - PAD.t - PAD.b;
  $: xAt = (m: number) =>
    PAD.l + (endIdx === START_IDX ? innerW : ((m - START_IDX) / (endIdx - START_IDX)) * innerW);
  const yAtFor = (yMax: number) => (v: number) => PAD.t + innerH - (v / yMax) * innerH;

  type Pt = [number, number];
  const catmullRom = (pts: Pt[]): string => {
    if (pts.length < 3) return "M" + pts.map((p) => `${p[0]} ${p[1]}`).join(" L");
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] ?? p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  };
  // One path generator for all three curve modes — reused by lines and by both
  // edges of the stacked bands, so a curve change stays consistent everywhere.
  const buildPath = (pts: Pt[], c: Curve): string => {
    if (!pts.length) return "";
    if (c === "step") {
      let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) {
        d += ` L${pts[i][0].toFixed(1)} ${pts[i - 1][1].toFixed(1)} L${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`;
      }
      return d;
    }
    if (c === "smooth") return catmullRom(pts);
    return "M" + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L");
  };
  // Same shape, but as a continuation (swap leading M→L) so an area can run its
  // top edge then trace the bottom edge back without lifting the pen.
  const continuePath = (pts: Pt[], c: Curve): string => "L" + buildPath(pts, c).slice(1);

  const ptsFor = (values: number[], yMax: number): Pt[] =>
    values.map((v, i) => [xAt(months[i]), yAtFor(yMax)(v)]);

  // Stacked bands: each model rides on the running total beneath it.
  $: stacked = (() => {
    const below = months.map(() => 0);
    const yS = yAtFor(maxTotal);
    return series.map((s) => {
      const topVals = s.values.map((v, i) => below[i] + v);
      const top: Pt[] = topVals.map((v, i) => [xAt(months[i]), yS(v)]);
      const bottom: Pt[] = below.map((v, i) => [xAt(months[i]), yS(v)]);
      const band = { model: s.model, top, bottom };
      for (let i = 0; i < below.length; i++) below[i] = topVals[i];
      return band;
    });
  })();

  // Sparse axis ticks.
  $: ticks = (() => {
    if (months.length <= 1) return months;
    const step = Math.max(1, Math.ceil(months.length / 4));
    const out: number[] = [];
    for (let i = 0; i < months.length; i += step) out.push(months[i]);
    if (out[out.length - 1] !== months[months.length - 1]) out.push(months[months.length - 1]);
    return out;
  })();
  const yTicks = (yMax: number) => {
    const step = Math.max(1, Math.round(yMax / 3 / 50) * 50) || Math.ceil(yMax / 3);
    const out: number[] = [];
    for (let v = 0; v <= yMax; v += step) out.push(v);
    if (out[out.length - 1] !== yMax) out.push(yMax);
    return out;
  };

  $: scopeLabel = selectedState ? (STATE_NAMES[selectedState] ?? selectedState) : "National";
</script>

<section class="border-b border-slate-200 bg-white px-4 py-10 sm:px-6 sm:py-12">
  <div class="mx-auto max-w-6xl">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 class="font-serif text-xl font-bold text-slate-900 sm:text-2xl">How participation has grown</h2>
        <p class="mt-1 text-sm text-slate-600">
          Cumulative agencies by primary model, since May&nbsp;2025{selectedState ? ` — ${scopeLabel}` : ""}.
        </p>
      </div>
      <!-- State scope -->
      <label class="flex shrink-0 items-center gap-2 text-sm text-slate-600">
        <span class="sr-only sm:not-sr-only">State</span>
        <select bind:value={selectedState} class="rounded border border-slate-300 bg-white px-2 py-1 text-slate-800">
          <option value="">National</option>
          {#each stateOptions as st}
            <option value={st}>{STATE_NAMES[st] ?? st}</option>
          {/each}
        </select>
      </label>
    </div>

    <!-- Variation + curve selectors — scaffolding for #162; we’re picking a direction. -->
    <div class="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
      <div class="inline-flex rounded border border-slate-300 bg-stone-50 p-0.5" role="tablist" aria-label="Chart style">
        {#each VARIATIONS as v}
          <button type="button" role="tab" aria-selected={variation === v.id}
            class="rounded px-3 py-1 font-medium transition {variation === v.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}"
            on:click={() => (variation = v.id)}>{v.label}</button>
        {/each}
      </div>
      <div class="inline-flex items-center gap-2">
        <span class="text-slate-500">Curve</span>
        <div class="inline-flex rounded border border-slate-300 bg-stone-50 p-0.5" role="tablist" aria-label="Curve style">
          {#each CURVES as c}
            <button type="button" role="tab" aria-selected={curve === c.id}
              class="rounded px-3 py-1 font-medium transition {curve === c.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}"
              on:click={() => (curve = c.id)}>{c.label}</button>
          {/each}
        </div>
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
            {@const pts = ptsFor(s.values, maxModel)}
            <figure class="rounded border border-slate-200 bg-stone-50/60 p-3">
              <figcaption class="mb-1 flex items-baseline justify-between">
                <span class="text-sm font-semibold text-slate-800">{MODEL_SHORT[s.model] ?? s.model}</span>
                <span class="text-xs text-slate-500">{s.final}</span>
              </figcaption>
              <svg viewBox="0 0 {W} {H}" class="block w-full" role="img" aria-label="{MODEL_SHORT[s.model]} cumulative trend">
                <line x1={PAD.l} y1={PAD.t + innerH} x2={W - PAD.r} y2={PAD.t + innerH} stroke="#e2e8f0" />
                <path d="{buildPath(pts, curve)} L{xAt(endIdx).toFixed(1)} {(PAD.t + innerH).toFixed(1)} L{xAt(START_IDX).toFixed(1)} {(PAD.t + innerH).toFixed(1)} Z" fill="{MODEL_COLORS[s.model]}" fill-opacity="0.12" />
                <path d={buildPath(pts, curve)} fill="none" stroke="{MODEL_COLORS[s.model]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
                <text x={PAD.l} y={H - 8} class="fill-slate-400" style="font-size: 12px;">{monthLabelShort(START_IDX)}</text>
                <text x={W - PAD.r} y={H - 8} text-anchor="end" class="fill-slate-400" style="font-size: 12px;">{monthLabelShort(endIdx)}</text>
              </svg>
            </figure>
          {/each}
        </div>
      {:else}
        <!-- ── Multi-series line  /  Stacked area ─────────────────────────────── -->
        <div class="mx-auto max-w-lg">
          <svg viewBox="0 0 {W} {H}" class="block w-full" role="img" aria-label="Cumulative 287(g) agencies by model since May 2025">
            {#each yTicks(variation === "area" ? maxTotal : maxModel) as t}
              {@const y = yAtFor(variation === "area" ? maxTotal : maxModel)(t)}
              <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="#eef2f6" />
              <text x={PAD.l - 6} y={y + 3} text-anchor="end" class="fill-slate-400" style="font-size: 12px;">{t}</text>
            {/each}
            {#each ticks as t}
              <text x={xAt(t)} y={H - 8} text-anchor="middle" class="fill-slate-400" style="font-size: 12px;">{monthLabelShort(t)}</text>
            {/each}

            {#if variation === "area"}
              {#each stacked as band}
                <path d="{buildPath(band.top, curve)} {continuePath([...band.bottom].reverse(), curve)} Z" fill="{MODEL_COLORS[band.model]}" fill-opacity="0.82" />
              {/each}
            {:else}
              {#each series as s}
                <path d={buildPath(ptsFor(s.values, maxModel), curve)} fill="none" stroke="{MODEL_COLORS[s.model]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
              {/each}
            {/if}
          </svg>
        </div>
      {/if}
    </div>

    <p class="mt-3 text-xs italic text-slate-400">
      Experimental (#162). Series count agencies by primary model; pre-May-2025 signings fold into the May baseline.
    </p>
  </div>
</section>

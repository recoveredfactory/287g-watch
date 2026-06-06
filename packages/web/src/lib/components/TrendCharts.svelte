<script lang="ts">
  // ── National trend chart (#162) ────────────────────────────────────────────
  // Low-key growth chart for the home page: a stepped multi-series line of
  // cumulative agencies by *primary model*, since May 2025. primary_model is
  // exclusive (one per agency, same field the map colours its dots by), so the
  // three series are non-overlapping. Cumulative counts are a step function by
  // nature — the line only moves on the dates agencies actually signed — so the
  // curve is stepped rather than interpolated.
  //
  // The timeline begins May 2025 (first month with a complete dataset, same
  // TIMELINE_START as the map). Pre-May-2025 signings fold into the May baseline.
  // A state selector scopes the chart to one state in isolation.
  import { MODEL_COLORS, MODEL_ORDER, MODEL_MINI } from "$lib/colors";
  import { STATE_NAMES } from "$lib/states";
  import ModelLink from "$lib/components/ModelLink.svelte";

  type Agency = {
    primary_model?: string;
    signed_date?: string | null;
    state?: string;
  };
  export let agencies: Agency[] = [];

  // ── State scope ─────────────────────────────────────────────────────────────
  let selectedState = ""; // "" = National
  $: stateCounts = agencies.reduce<Record<string, number>>((acc, a) => {
    if (a.state) acc[a.state] = (acc[a.state] ?? 0) + 1;
    return acc;
  }, {});
  $: stateOptions = Object.keys(stateCounts).sort((a, b) =>
    (STATE_NAMES[a] ?? a).localeCompare(STATE_NAMES[b] ?? b),
  );
  $: scoped = selectedState ? agencies.filter((a) => a.state === selectedState) : agencies;
  $: scopeLabel = selectedState ? (STATE_NAMES[selectedState] ?? selectedState) : "National";

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
    return { model, values, first: values[0] ?? 0, final: values[values.length - 1] ?? 0 };
  });
  $: maxModel = Math.max(1, ...series.flatMap((s) => s.values));

  // ── Geometry / scales (manual; keeps us off a charting dep) ─────────────────
  // Taller-than-wide on purpose; wide margins hold the direct start/end labels.
  const W = 460;
  const H = 370;
  const PAD = { t: 14, r: 58, b: 26, l: 40 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const baselineY = PAD.t + innerH;
  const xAt = (m: number) =>
    PAD.l + (endIdx === START_IDX ? innerW : ((m - START_IDX) / (endIdx - START_IDX)) * innerW);
  $: yAt = (v: number) => PAD.t + innerH - (v / maxModel) * innerH;

  // Stepped path: hold the previous value across the month, then jump.
  const stepPath = (values: number[]): string => {
    if (!values.length) return "";
    let d = `M${xAt(months[0]).toFixed(1)} ${yAt(values[0]).toFixed(1)}`;
    for (let i = 1; i < values.length; i++) {
      d += ` L${xAt(months[i]).toFixed(1)} ${yAt(values[i - 1]).toFixed(1)} L${xAt(months[i]).toFixed(1)} ${yAt(values[i]).toFixed(1)}`;
    }
    return d;
  };

  // Nudge label anchor-ys apart so direct labels don't collide. Pushes downward
  // from the topmost; preserves original order. (3 labels, so cheap.)
  function spreadY(ys: number[], gap = 13): number[] {
    const order = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b]);
    const placed = order.map((i) => ys[i]);
    for (let i = 1; i < placed.length; i++) {
      if (placed[i] - placed[i - 1] < gap) placed[i] = placed[i - 1] + gap;
    }
    const out = new Array(ys.length);
    order.forEach((orig, k) => (out[orig] = placed[k]));
    return out;
  }
  // y-axis: a few round, integer ticks (a simple numeric axis, not a dense grid).
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

  // x-axis: ~5 evenly spaced months including first and last, so a forced last
  // tick never crowds its neighbour.
  $: ticks = (() => {
    const n = months.length;
    if (n <= 1) return months;
    const count = Math.min(n, 5);
    const set = new Set<number>();
    for (let i = 0; i < count; i++) set.add(months[Math.round((i * (n - 1)) / (count - 1))]);
    return [...set];
  })();

  $: endLabelY = spreadY(series.map((s) => yAt(s.final)));
  // Start labels only where a line begins above 0, and not where it would land
  // on a y-axis number (the axis already carries that value).
  $: startLabels = (() => {
    const picked = series.filter(
      (s) => s.first > 0 && !gridYs.some((gy) => Math.abs(yAt(s.first) - gy) < 9),
    );
    const ys = spreadY(picked.map((s) => yAt(s.first)));
    return picked.map((s, i) => ({ model: s.model, value: s.first, y: ys[i] }));
  })();
</script>

<section class="border-b border-slate-200 bg-white px-4 py-10 sm:px-6 sm:py-12">
  <div class="mx-auto max-w-[480px]">
    <div class="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
      <h2 class="font-serif text-xl font-bold text-slate-900 sm:text-2xl">How participation has grown</h2>
      <!-- State scope; count in parens is the state’s total agreements -->
      <label class="flex shrink-0 items-center gap-2 text-sm text-slate-600">
        <span class="sr-only">State</span>
        <select bind:value={selectedState} class="rounded border border-slate-300 bg-white px-2 py-1 text-slate-800">
          <option value="">National ({agencies.length})</option>
          {#each stateOptions as st}
            <option value={st}>{STATE_NAMES[st] ?? st} ({stateCounts[st]})</option>
          {/each}
        </select>
      </label>
    </div>
    <p class="mt-1 text-sm text-slate-600">
      Cumulative agencies by primary model, since May&nbsp;2025{selectedState ? ` — ${scopeLabel}` : ""}.
    </p>

    <!-- Legend (full names; mini codes match the in-chart labels) -->
    <div class="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {#each series as s}
        <span class="inline-flex items-center gap-1.5 text-slate-700">
          <span class="inline-block h-2.5 w-2.5 rounded-sm" style="background: {MODEL_COLORS[s.model]};"></span>
          <ModelLink model={s.model} />
          <span class="text-slate-400">{MODEL_MINI[s.model] ?? ""}</span>
          <span class="font-semibold text-slate-900">{s.final}</span>
        </span>
      {/each}
    </div>

    <div class="mt-4">
      <svg viewBox="0 0 {W} {H}" class="block w-full" role="img" aria-label="Cumulative 287(g) agencies by model since May 2025">
        <!-- simple numeric y-axis: a few round ticks + faint gridlines -->
        {#each yTicks as t}
          <line x1={PAD.l} y1={yAt(t)} x2={W - PAD.r} y2={yAt(t)} stroke="#eef2f6" />
          <text x={PAD.l - 6} y={yAt(t) + 3} text-anchor="end" class="fill-slate-400" style="font-size: 11px;">{t}</text>
        {/each}
        {#each ticks as t, i}
          <text x={xAt(t)} y={H - 8} text-anchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"} class="fill-slate-400" style="font-size: 11px;">{monthLabelShort(t)}</text>
        {/each}

        {#each series as s}
          <path d={stepPath(s.values)} fill="none" stroke="{MODEL_COLORS[s.model]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
        {/each}
        <!-- Direct labels: starting value (when above 0) at the left, mini code + total at the right -->
        {#each startLabels as l}
          <text x={xAt(START_IDX) - 5} y={l.y + 4} text-anchor="end"
            style="font-size: 11px; font-weight: 600;" fill={MODEL_COLORS[l.model]}>{l.value}</text>
        {/each}
        {#each series as s, i}
          <text x={xAt(endIdx) + 5} y={endLabelY[i] + 4} text-anchor="start"
            style="font-size: 11px; font-weight: 600;" fill={MODEL_COLORS[s.model]}>{MODEL_MINI[s.model] ?? ""} {s.final}</text>
        {/each}
      </svg>
    </div>

    <p class="mt-3 text-xs italic text-slate-400">
      Experimental (#162). Series count agencies by primary model; pre-May-2025 signings fold into the May baseline.
    </p>
  </div>
</section>

<script lang="ts">
  // ── National trend chart (#162) ────────────────────────────────────────────
  // Low-key trend chart for the home page: a stepped multi-series line of
  // *active* agency–model agreements over time, since Dec 2024. Each model an
  // agency holds is one agreement, so an agency with two models contributes to
  // two series — the lines multi-count and their right edges match the model
  // cards' `modelCounts`. Unlike a cumulative curve, lines dip when agreements
  // terminate or an agency drops a model.
  //
  // The series arrive precomputed from +page.server.ts — history events (live
  // + terminated agencies) replayed through the same buildTimeline as the
  // state pages, sampled monthly — so the client never ships per-agency
  // history (#135). The timeline begins Dec 2024 (the last pre-2025 archived
  // snapshot, #169 — a pre-Trump baseline, same TIMELINE_START as the map);
  // earlier history folds into the Dec 2024 level. A state selector in the
  // header scopes the chart.
  import { MODEL_COLORS, MODEL_ORDER, MODEL_MINI, MODEL_SLUG } from "$lib/colors";
  import { STATE_NAMES } from "$lib/states";
  import ModelLink from "$lib/components/ModelLink.svelte";
  import { getLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";

  type Agency = {
    models?: string[];
    state?: string;
  };
  type TrendSeries = { jail: number[]; taskforce: number[]; wso: number[] };
  export let agencies: Agency[] = [];
  // "YYYY-MM" sample labels and per-scope series ("" = national), index-aligned.
  export let trendMonths: string[] = [];
  export let trend: Record<string, TrendSeries> = {};
  // When true (e.g. state pages), hides the state selector and agency count.
  export let hideSelector = false;

  // Locale-aware formatting (thousands separators + month labels) for the active site language.
  const localeTag = getLocale() === "es" ? "es-MX" : "en-US";
  const nf = new Intl.NumberFormat(localeTag);

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
  $: scopeLabel = selectedState ? (STATE_NAMES[selectedState] ?? selectedState) : m.trend_scope_us();

  // ── Time axis ───────────────────────────────────────────────────────────────
  // Months are integer indices relative to a Jan 2025 epoch (Dec 2024 = -1),
  // derived from the server's "YYYY-MM" sample labels.
  const EPOCH_YEAR = 2025;
  const monthFmt = new Intl.DateTimeFormat(localeTag, { month: "short", timeZone: "UTC" });
  const monthLabelShort = (idx: number) => {
    const year = EPOCH_YEAR + Math.floor(idx / 12);
    const month = ((idx % 12) + 12) % 12;
    return `${monthFmt.format(new Date(Date.UTC(year, month, 1)))} ’${String(year).slice(2)}`;
  };

  $: months = trendMonths.map(
    (ym) => (Number(ym.slice(0, 4)) - EPOCH_YEAR) * 12 + (Number(ym.slice(5, 7)) - 1),
  );
  $: START_IDX = months[0] ?? -1;
  $: endIdx = months[months.length - 1] ?? START_IDX;

  // ── Series: active agreements per model, over months ────────────────────────
  // An agency counts toward every model it holds, so series multi-count.
  $: scopedTrend = trend[selectedState] ?? { jail: [], taskforce: [], wso: [] };
  $: series = MODEL_ORDER.map((model) => {
    const values = scopedTrend[MODEL_SLUG[model] as keyof TrendSeries] ?? [];
    return { model, values, first: values[0] ?? 0, final: values[values.length - 1] ?? 0 };
  });
  $: maxModel = Math.max(1, ...series.flatMap((s) => s.values));
  // Distinct figures: total agreements (sum of the lines) vs. agencies (scope
  // size). Agreements ≥ agencies because agencies can hold more than one model.
  $: totalAgreements = series.reduce((n, s) => n + s.final, 0);
  $: totalAgencies = scoped.length;
  // Bold figures composed into the translated summary line (rendered via {@html}).
  $: agreementsPhrase = (totalAgreements === 1 ? m.trend_count_agreements_one : m.trend_count_agreements_other)({
    count: `<span class="font-semibold text-slate-900">${nf.format(totalAgreements)}</span>`,
  });
  $: agenciesPhrase = (totalAgencies === 1 ? m.trend_count_agencies_one : m.trend_count_agencies_other)({
    count: `<span class="font-semibold text-slate-900">${nf.format(totalAgencies)}</span>`,
  });
  $: summaryHtml = hideSelector
    ? m.trend_summary_plain({ agreements: agreementsPhrase })
    : m.trend_summary_scoped({ agreements: agreementsPhrase, agencies: agenciesPhrase });

  // ── Geometry / scales (manual; keeps us off a charting dep) ─────────────────
  // Generous right margin: the direct end labels are the cramped spot, and we
  // have room to spare there on every viewport, so give them width to breathe.
  //
  // The viewBox width tracks the rendered width 1:1 (via bind:clientWidth), so
  // the chart fills whatever the container gives it and type renders at its
  // true pixel size on every viewport — wide on desktop instead of square,
  // no shrunken labels on mobile. Height stays fixed.
  let measuredW = 0; // 0 until mounted; fall back to the old fixed width for SSR
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
  // Reactive so paths rebuild when the measured width changes.
  $: stepPath = (values: number[]): string => {
    if (!values.length) return "";
    let d = `M${xAt(months[0]).toFixed(1)} ${yAt(values[0]).toFixed(1)}`;
    for (let i = 1; i < values.length; i++) {
      d += ` L${xAt(months[i]).toFixed(1)} ${yAt(values[i - 1]).toFixed(1)} L${xAt(months[i]).toFixed(1)} ${yAt(values[i]).toFixed(1)}`;
    }
    return d;
  };

  // Nudge label anchor-ys apart so direct labels don't collide vertically.
  // Resolve overlaps top-down, then if the cluster has spilled past the plot
  // bottom, slide the whole run back up so it stays anchored to the data and
  // never overflows. Preserves original order. (3 labels, so cheap.)
  function spreadY(ys: number[], gap = 14): number[] {
    if (ys.length < 2) return [...ys];
    const order = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b]);
    const placed = order.map((i) => ys[i]);
    for (let i = 1; i < placed.length; i++) {
      if (placed[i] - placed[i - 1] < gap) placed[i] = placed[i - 1] + gap;
    }
    // Clamp the run within [PAD.t, baselineY]; shift up if it overran the bottom.
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

  // x-axis: evenly spaced months including first and last, so a forced last
  // tick never crowds its neighbour. Tick count scales with the measured plot
  // width (~"Sep '25" needs ~55px each): 5 on desktop, 3 on narrow phones.
  $: ticks = (() => {
    const n = months.length;
    if (n <= 1) return months;
    const count = Math.min(n, 5, Math.max(3, Math.floor(innerW / 90) + 1));
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
  <div class="mx-auto max-w-[720px]">
    <!-- Headline stays plain text; the scope control is an ordinary select on the header row -->
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
      <h2 class="font-serif text-xl font-bold text-slate-900 sm:text-2xl">
        {m.trend_heading()}
      </h2>
      {#if !hideSelector}
      <label class="flex items-center gap-2 text-sm text-slate-600">
        <span>{m.trend_scope_label()}</span>
        <select
          bind:value={selectedState}
          class="cursor-pointer rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
        >
          <option value="">{m.trend_scope_national({ count: nf.format(agencies.length) })}</option>
          {#each stateOptions as st}
            <option value={st}>{STATE_NAMES[st] ?? st} ({nf.format(stateCounts[st])})</option>
          {/each}
        </select>
      </label>
      {/if}
    </div>
    <p class="mt-1 text-sm text-slate-600">
      {hideSelector ? m.trend_subtitle_plain() : m.trend_subtitle_scoped({ scope: scopeLabel })}
    </p>
    <!-- Distinct figures: an agency can hold more than one model -->
    <p class="mt-2 text-sm text-slate-500">{@html summaryHtml}</p>

    <!-- Legend (full names; mini codes match the in-chart labels) -->
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
      <svg viewBox="0 0 {W} {H}" class="block w-full" role="img" aria-label={m.trend_aria_label()}>
        <!-- simple numeric y-axis: a few round ticks + faint gridlines -->
        {#each yTicks as t}
          <line x1={PAD.l} y1={yAt(t)} x2={W - PAD.r} y2={yAt(t)} stroke="#eef2f6" />
          <text x={PAD.l - 6} y={yAt(t) + 3} text-anchor="end" class="fill-slate-400" style="font-size: 11px;">{nf.format(t)}</text>
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
            style="font-size: 11px; font-weight: 600;" fill={MODEL_COLORS[l.model]}>{nf.format(l.value)}</text>
        {/each}
        {#each series as s, i}
          <text x={xAt(endIdx) + 6} y={endLabelY[i] + 4} text-anchor="start"
            style="font-size: 11px; font-weight: 600;" fill={MODEL_COLORS[s.model]}>{MODEL_MINI[s.model] ?? ""} {nf.format(s.final)}</text>
        {/each}
      </svg>
    </div>
    {/if}

    <p class="mt-3 text-xs italic text-slate-400">
      {m.trend_experimental_note()}
    </p>
  </div>
</section>

<script lang="ts">
  import type { PageData } from "./$types";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_DARK_COLORS, MODEL_SHORT, MODEL_SLUG, MODEL_ORDER } from "$lib/colors";
  import { STATE_NAMES } from "$lib/states";
  import NationalMap from "$lib/components/NationalMap.svelte";
  import MapTimelineScrubber from "$lib/components/MapTimelineScrubber.svelte";
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
  import { tweened } from "svelte/motion";
  import { cubicOut } from "svelte/easing";
  import { localizeHref } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import Gloss from "$lib/components/Gloss.svelte";

  export let data: PageData;

  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? "https://tracking287g.com";
  const title = m.home_meta_title();
  $: description = data.agencyCount > 0
    ? m.home_meta_description_with_count({ count: intFmt.format(data.agencyCount) })
    : m.home_meta_description_no_data();

  const intFmt = new Intl.NumberFormat();
  const popFmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  // Overlay-only: round to the nearest million. The tweened value updates
  // many times per second; one-decimal precision makes the trailing digit
  // flicker. Whole-million steps still feel like a counter ticking up.
  const popFmtOverlay = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 0 });

  // ── Map palette (user-toggleable, persisted across pages) ──────────────────
  import { mapPalette } from "$lib/map/paletteStore";
  import MapPaletteSelector from "$lib/components/MapPaletteSelector.svelte";

  // ── Timeline cursor (experimental, #76) ────────────────────────────────────
  // Continuous fractional-month index relative to Jan 2025. The map fades and
  // pops each dot in as the cursor passes its signing date; pre-2025 signings
  // are pinned as a baseline. See caveat in MapTimelineScrubber.svelte.
  const TIMELINE_EPOCH_YEAR = 2025;
  const BASELINE_IDX = -10000;
  const signedIdx = (d: string | null | undefined): number => {
    if (!d || d.length < 10) return BASELINE_IDX;
    const y = Number(d.slice(0, 4));
    const m = Number(d.slice(5, 7));
    const day = Number(d.slice(8, 10));
    if (y < TIMELINE_EPOCH_YEAR) return BASELINE_IDX;
    return (y - TIMELINE_EPOCH_YEAR) * 12 + (m - 1) + (day - 1) / 31;
  };
  $: signedIndices = data.agencies.map((a) => signedIdx(a.signed_date));
  $: agencyPops = data.agencies.map((a) => a.population ?? 0);
  const today = new Date();
  const todayIdx =
    (today.getUTCFullYear() - TIMELINE_EPOCH_YEAR) * 12 +
    today.getUTCMonth() +
    (today.getUTCDate() - 1) / 31;
  const minIdx = 0;
  $: maxIdx = Math.max(
    todayIdx,
    ...signedIndices.filter((i) => i > BASELINE_IDX),
  ) + 0.5;
  let cursorIdx = NaN;
  $: if (Number.isNaN(cursorIdx) && Number.isFinite(maxIdx)) cursorIdx = maxIdx;
  $: countAtCursor = signedIndices.filter((i) => i <= cursorIdx).length;
  $: popAtCursor = signedIndices.reduce(
    (sum, idx, i) => (idx <= cursorIdx ? sum + agencyPops[i] : sum),
    0,
  );

  // Big number overlay on the map. Visible while the scrubber is playing or
  // while the cursor is held away from "today" so the user always sees the
  // live count change. Smooth tween catches up with easing — gives the digits
  // that "ticking up" feel without per-keystroke jank.
  let timelinePlaying = false;
  const displayedCount = tweened(0, { duration: 280, easing: cubicOut });
  const displayedPop = tweened(0, { duration: 280, easing: cubicOut });
  $: displayedCount.set(countAtCursor);
  $: displayedPop.set(popAtCursor);

  // Linger logic: when playback ends (or the user releases at the end), keep
  // the overlay visible for 2s so the final tally has presence before it fades.
  const LINGER_MS = 2000;
  let lingerActive = false;
  let lingerTimer: ReturnType<typeof setTimeout> | null = null;
  let wasTimelinePlaying = false;
  $: if (wasTimelinePlaying !== timelinePlaying) {
    if (wasTimelinePlaying && !timelinePlaying) {
      lingerActive = true;
      if (lingerTimer) clearTimeout(lingerTimer);
      lingerTimer = setTimeout(() => { lingerActive = false; }, LINGER_MS);
    }
    wasTimelinePlaying = timelinePlaying;
  }
  $: showCountOverlay =
    timelinePlaying ||
    lingerActive ||
    (Number.isFinite(maxIdx) && cursorIdx < maxIdx - 0.05);

  // ── Search + filter ────────────────────────────────────────────────────────
  let searchQuery = "";
  let activeModels: Set<string> = new Set();
  let selectedStates: Set<string> = new Set();
  let selectedYear = "";
  let currentPage = 1;
  const PAGE_SIZE = 25;

  const ALL_MODELS = MODEL_ORDER;

  // ── URL state persistence ──────────────────────────────────────────────────
  const SLUG_TO_MODEL = Object.fromEntries(
    Object.entries(MODEL_SLUG).map(([full, slug]) => [slug, full])
  );

  let urlSyncTimer: ReturnType<typeof setTimeout>;
  let mounted = false;
  let detectedState: string | null = null;

  // Geo-aware participation callout. Renders once client-side geo resolves.
  // FL gets softened phrasing because participation is mandated by SB 168 (2019)
  // and FBI LEE jurisdiction overlap pushes raw pop coverage above 100%.
  $: userStateCallout = (() => {
    if (!detectedState) return null;
    const stateName = STATE_NAMES[detectedState];
    const meta = data.stateMeta[detectedState];
    if (!stateName || !meta || !meta.local_le_agencies) return null;
    const boldState = `<b>${stateName}</b>`;
    if (meta.participating === 0) {
      return m.home_hero_state_callout_none({ state: boldState });
    }
    const agencyPct = Math.round((meta.participating / meta.local_le_agencies) * 100);
    if (detectedState === "FL") {
      return m.home_hero_state_callout_fl({ state: boldState, agency_pct: agencyPct });
    }
    const popPct = meta.state_local_population > 0
      ? Math.round((meta.population_served / meta.state_local_population) * 100)
      : 0;
    return m.home_hero_state_callout_standard({
      state: boldState,
      agency_pct: agencyPct,
      pop_pct: popPct,
    });
  })();

  // localStorage-cached geo detection — avoids hitting /api/geo on every page load
  const GEO_KEY = "rf-geo-v1";
  const GEO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  async function getCachedGeo(): Promise<{ country: string | null; state: string | null }> {
    try {
      const raw = localStorage.getItem(GEO_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (typeof cached.t === "number" && Date.now() - cached.t < GEO_TTL_MS) {
          return { country: cached.c ?? null, state: cached.s ?? null };
        }
      }
    } catch {}
    try {
      const res = await fetch("/api/geo", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        try {
          localStorage.setItem(
            GEO_KEY,
            JSON.stringify({ c: data.country, s: data.state, t: Date.now() })
          );
        } catch {}
        return data;
      }
    } catch {}
    return { country: null, state: null };
  }

  function scheduleUrlSync() {
    if (!browser) return;
    clearTimeout(urlSyncTimer);
    urlSyncTimer = setTimeout(() => {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (selectedStates.size > 0) params.set("states", [...selectedStates].join(","));
      if (selectedYear) params.set("year", selectedYear);
      if (activeModels.size > 0)
        params.set("models", [...activeModels].map((m) => MODEL_SLUG[m]).filter(Boolean).join(","));
      if (currentPage > 1) params.set("page", String(currentPage));
      const qs = params.toString();
      history.replaceState(history.state, "", qs ? `?${qs}` : location.pathname);
    }, 300);
  }

  // Only sync URL for user-initiated changes after mount. Initial-state setup
  // (URL params, geo default) runs inside onMount and intentionally skips sync.
  $: { searchQuery; selectedStates; selectedYear; activeModels; currentPage;
    if (mounted) scheduleUrlSync();
  }

  onMount(async () => {
    const params = new URLSearchParams(location.search);
    const q = params.get("q");
    const models = params.get("models");
    const page = params.get("page");
    if (q) searchQuery = q;
    // Support both ?states=TX,FL (new) and legacy ?state=TX
    const statesParam = params.get("states") ?? params.get("state");
    if (statesParam) selectedStates = new Set(statesParam.split(",").filter(Boolean));
    const year = params.get("year");
    if (year) selectedYear = year;
    if (models)
      activeModels = new Set(models.split(",").map((s) => SLUG_TO_MODEL[s]).filter(Boolean));

    // Geo: detect user's state for the toggle button but do NOT auto-filter.
    const geo = await getCachedGeo();
    if (geo.state && allStates.includes(geo.state)) {
      detectedState = geo.state;
    }

    // Set page last — filter changes above will reset currentPage to 1 reactively,
    // so this must come after all other assignments to stick.
    if (page) {
      const n = parseInt(page, 10);
      if (!isNaN(n) && n > 1) currentPage = n;
    }

    mounted = true;
  });

  $: allStates = [...new Set(data.agencies.map((a) => a.state).filter(Boolean))].sort();
  $: allYears = [...new Set(data.agencies.map((a) => a.signed_date?.slice(0, 4)).filter(Boolean))].sort();

  $: filteredAgencies = data.agencies.filter((a) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      a.name.toLowerCase().includes(q) ||
      a.state.toLowerCase().includes(q) ||
      (a.city ?? "").toLowerCase().includes(q) ||
      (a.county ?? "").toLowerCase().includes(q);
    const matchesModel =
      activeModels.size === 0 || a.models.some((m) => activeModels.has(m));
    const matchesState = selectedStates.size === 0 || selectedStates.has(a.state);
    const matchesYear = !selectedYear || a.signed_date?.startsWith(selectedYear);
    return matchesSearch && matchesModel && matchesState && matchesYear;
  });

  // Reset to page 1 whenever filters change
  $: if (filteredAgencies) currentPage = 1;

  $: totalPages = Math.max(1, Math.ceil(filteredAgencies.length / PAGE_SIZE));
  $: pageStart = (currentPage - 1) * PAGE_SIZE;
  $: pageEnd = Math.min(pageStart + PAGE_SIZE, filteredAgencies.length);
  $: pageAgencies = filteredAgencies.slice(pageStart, pageEnd);

  const toggleState = (state: string) => {
    const next = new Set(selectedStates);
    if (next.has(state)) next.delete(state);
    else next.add(state);
    selectedStates = next;
  };

  const toggleModel = (model: string) => {
    const next = new Set(activeModels);
    if (next.has(model)) next.delete(model);
    else next.add(model);
    activeModels = next;
  };

  const clearFilters = () => {
    searchQuery = "";
    activeModels = new Set();
    selectedStates = new Set();
    selectedYear = "";
  };

  $: hasActiveFilters = searchQuery.trim() !== "" || activeModels.size > 0 || selectedStates.size > 0 || selectedYear !== "";

  function modelDesc(model: string): { short: string; detail: string } {
    switch (model) {
      case "Jail Enforcement Model":
        return { short: m.model_jem_short(), detail: m.model_jem_detail() };
      case "Task Force Model":
        return { short: m.model_tfm_short(), detail: m.model_tfm_detail() };
      case "Warrant Service Officer":
        return { short: m.model_wso_short(), detail: m.model_wso_detail() };
      default:
        return { short: "", detail: "" };
    }
  }
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta property="og:type" content="website" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={siteUrl} />
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:title" content={title} />
  <meta property="twitter:description" content={description} />
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "287(g) Agency Participation Database",
    description,
    url: siteUrl,
    license: "https://creativecommons.org/licenses/by/4.0/",
    creator: { "@type": "Organization", name: "287(g) Explorer" },
  })}</` + `script>`}
</svelte:head>

<main id="main-content">

  <!-- ── Hero ─────────────────────────────────────────────────────────────── -->
  <section class="border-b border-slate-200 bg-white px-4 py-10 sm:px-6 sm:py-20">
    <div class="mx-auto max-w-3xl">
      <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 sm:text-sm">
        {m.home_hero_eyebrow()}
      </p>
      <h1 class="mt-2 text-2xl font-black leading-tight text-slate-900 sm:mt-3 sm:text-4xl lg:text-5xl">
        {m.home_hero_headline_line1()}<br class="hidden sm:block" /> {m.home_hero_headline_line2()}
      </h1>
      <p class="prose-editorial mt-4 text-base sm:mt-6 sm:text-lg">
        <Gloss text={m.home_hero_lead()} />
      </p>

      {#if userStateCallout}
        <p class="mt-4 border-l-4 border-[#ce1483] bg-pink-50/40 px-4 py-3 text-base text-slate-700 sm:text-lg">
          {@html userStateCallout}
        </p>
      {/if}

      {#if data.agencyCount > 0}
        <div class="mt-6 flex flex-wrap gap-6 sm:mt-8 sm:gap-8">
          <div>
            <p class="font-mono text-2xl font-semibold tabular-nums text-slate-900 sm:text-3xl">
              {intFmt.format(data.agencyCount)}
            </p>
            <p class="mt-0.5 text-xs text-slate-500 sm:text-sm">{m.home_stat_agencies()}</p>
          </div>
          <div>
            <p class="font-mono text-2xl font-semibold tabular-nums text-slate-900 sm:text-3xl">
              {data.stateCount}
            </p>
            <p class="mt-0.5 text-xs text-slate-500 sm:text-sm">{m.home_stat_states()}</p>
          </div>
          {#if data.populationCovered > 0}
            <div>
              <p class="font-mono text-2xl font-semibold tabular-nums text-slate-900 sm:text-3xl">
                {popFmt.format(data.populationCovered)}
              </p>
              <p class="mt-0.5 text-xs text-slate-500 sm:text-sm">{m.home_stat_population()}</p>
            </div>
          {/if}
        </div>

        {#if data.snapshotDate}
          <p class="mt-4 text-xs italic text-slate-400">
            As of {new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(data.snapshotDate))}
          </p>
        {/if}
      {/if}
    </div>
  </section>

  <!-- ── What each model authorizes ───────────────────────────────────────── -->
  <section class="border-b border-slate-200 bg-white px-4 py-10 sm:px-6 sm:py-12">
    <div class="mx-auto max-w-6xl">
      <h2 class="font-serif text-xl font-bold text-slate-900 sm:text-2xl">
        {m.home_models_heading()}
      </h2>
      <div class="mt-5 grid items-stretch gap-4 sm:grid-cols-3">
        {#each ALL_MODELS as model}
          {@const desc = modelDesc(model)}
          <div
            class="flex flex-col overflow-hidden rounded border shadow-sm"
            style="border-color: {MODEL_COLORS[model]};"
          >
            <div class="px-4 py-3" style="background: {MODEL_COLORS[model]};">
              <h3
                class="font-sans text-sm font-bold uppercase tracking-widest"
                style="color: {MODEL_TEXT_COLORS[model] ?? '#ffffff'};"
              >{model.replace(/ Model$/, '')}</h3>
            </div>
            <div class="flex flex-1 flex-col gap-3 px-4 py-4" style="background: {MODEL_COLORS[model]}28;">
              <p class="text-sm leading-relaxed text-slate-700">{@html desc.short}</p>
              <div class="flex items-end justify-between gap-2">
                <a
                  href={localizeHref(`/model/${MODEL_SLUG[model]}`)}
                  class="text-sm font-semibold no-underline hover:underline"
                  style="color: {MODEL_DARK_COLORS[model] ?? '#334155'};"
                >Learn more →</a>
                {#if data.modelCounts[model]}
                  <p
                    class="text-right text-xs italic text-slate-500"
                    title={data.snapshotDate ? `As of ${data.snapshotDate}` : undefined}
                  >{intFmt.format(data.modelCounts[model])} agencies</p>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ── Map ──────────────────────────────────────────────────────────────── -->
  <section class="border-b border-slate-200 bg-stone-50 pt-8 sm:pt-10">
    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h2 class="font-serif text-xl font-bold text-slate-900 sm:text-2xl">
            {m.home_map_heading()}
          </h2>
          <p class="mt-1 text-xs text-slate-500 sm:text-sm">
            {m.home_map_subhead()}
          </p>
        </div>
        <!-- Legend -->
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-6">
          {#each MODEL_ORDER as full}
            {@const short = MODEL_SHORT[full]}
            <span class="flex items-center gap-1.5 text-xs text-slate-600 sm:text-sm">
              <span
                class="inline-block h-2.5 w-2.5 rounded-full border border-white shadow-sm sm:h-3 sm:w-3"
                style="background: {MODEL_COLORS[full]};"
              ></span>
              {short}
            </span>
          {/each}
        </div>
      </div>

      <!-- Palette selector + zoom-to-detected-state shortcut -->
      <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
        <MapPaletteSelector />
        {#if detectedState && STATE_NAMES[detectedState] && data.stateMeta[detectedState]?.participating > 0 && !(selectedStates.size === 1 && selectedStates.has(detectedState))}
          <button
            type="button"
            on:click={() => (selectedStates = new Set([detectedState]))}
            class="text-xs text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
          >Zoom to {STATE_NAMES[detectedState]} →</button>
        {/if}
      </div>
    </div>

    <!-- Map: full-bleed so the country breaks the column and reads at scale -->
    <div class="relative mt-4 h-[360px] overflow-hidden border-y border-slate-200 shadow-sm sm:h-[560px] lg:h-[680px]">
      {#if data.agencies.length === 0}
        <div class="flex h-full items-center justify-center bg-slate-100 text-slate-500">
          <div class="px-6 text-center">
            <p class="font-medium text-slate-700">{m.home_map_empty_title()}</p>
            <p class="mt-1 text-sm">{m.home_map_empty_subtitle()}</p>
          </div>
        </div>
      {:else}
        <NationalMap
          agencies={data.agencies}
          {selectedStates}
          palette={$mapPalette}
          {cursorIdx}
        />
        <div
          class="count-overlay pointer-events-none absolute inset-x-0 top-2 flex justify-center sm:top-4"
          class:visible={showCountOverlay}
          class:playing={timelinePlaying}
          aria-hidden="true"
        >
          <div class="count-card">
            <div class="count-stat">
              <div class="count-number">{intFmt.format(Math.round($displayedCount))}</div>
              <div class="count-label">agencies</div>
            </div>
            <div class="count-divider" aria-hidden="true"></div>
            <div class="count-stat">
              <div class="count-number">{popFmtOverlay.format(Math.max(0, $displayedPop))}</div>
              <div class="count-label">Pop. covered</div>
            </div>
          </div>
        </div>
      {/if}
    </div>
    {#if data.agencies.length > 0 && signedIndices.length > 0 && Number.isFinite(maxIdx)}
      <div class="bg-white">
        <div class="mx-auto max-w-6xl">
          <MapTimelineScrubber {minIdx} {maxIdx} labelMaxIdx={todayIdx} bind:cursorIdx bind:playing={timelinePlaying} {countAtCursor} />
        </div>
      </div>
    {/if}
  </section>

  <!-- ── Support callout ──────────────────────────────────────────────────── -->
  <section class="border-b border-slate-200 bg-gray-100 px-4 py-5 sm:px-6">
    <div class="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <p class="text-sm text-slate-700">
        {m.home_support_prefix()} <a href="https://vsr.recoveredfactory.net/en" target="_blank" rel="noreferrer" class="font-semibold text-slate-900">Recovered Factory</a>{m.home_support_suffix()}
      </p>
      <a
        href="https://vsr.recoveredfactory.net/en"
        target="_blank"
        rel="noreferrer"
        class="self-start rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 no-underline hover:border-slate-400 hover:text-slate-900 hover:no-underline sm:shrink-0 sm:self-auto"
      >
        {m.home_support_hire_us()}
      </a>
    </div>
  </section>

  <!-- ── Search + filter + browse ──────────────────────────────────────────── -->
  <section class="px-4 py-10 sm:px-6 sm:py-12">
    <div class="mx-auto max-w-6xl">

      <h2 class="font-serif text-xl font-bold text-slate-900 sm:text-2xl">{m.home_search_heading()}</h2>

      <!-- Filter controls — sticky once scrolled into view -->
      <div
        class="sticky z-40 -mx-4 border-b border-slate-200 bg-stone-50/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
        style="top: calc(var(--site-header-height) + var(--staging-banner-height));"
      >
        <div class="space-y-3">
          <!-- Search input — full width on mobile -->
          <div class="relative">
            <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="search"
              bind:value={searchQuery}
              placeholder={m.home_search_placeholder()}
              class="w-full rounded-md border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm"
            />
          </div>

          <!-- State + model row — wraps cleanly on mobile -->
          <div class="flex flex-wrap items-center gap-2">
            <select
              class="max-w-[11rem] rounded-md border border-slate-300 bg-white py-2 pl-3 pr-7 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:max-w-none"
              on:change={(e) => { if (e.currentTarget.value) { toggleState(e.currentTarget.value); e.currentTarget.value = ""; } }}
            >
              <option value="">{selectedStates.size === 0 ? m.home_search_all_states() : "Add state…"}</option>
              {#each allStates.filter(s => !selectedStates.has(s)) as state}
                <option value={state}>{STATE_NAMES[state] ?? state}</option>
              {/each}
            </select>

            {#each [...selectedStates].sort() as state}
              <button
                type="button"
                on:click={() => toggleState(state)}
                class="flex items-center gap-1 rounded border px-3 py-1.5 text-xs font-semibold text-white"
                style="background-color: #2c2c2c; border-color: #2c2c2c;"
              >
                {STATE_NAMES[state] ?? state}
                <span aria-hidden="true" class="opacity-70">×</span>
              </button>
            {/each}

            {#if detectedState && !selectedStates.has(detectedState)}
              <button
                type="button"
                on:click={() => toggleState(detectedState!)}
                class="text-xs underline underline-offset-2" style="color: #23272b;"
              >
                {m.home_search_use_detected_state({ state: STATE_NAMES[detectedState] ?? detectedState })}
              </button>
            {/if}

            <select
              bind:value={selectedYear}
              class="rounded-md border border-slate-300 bg-white py-2 pl-3 pr-7 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All years</option>
              {#each allYears as year}
                <option value={year}>{year}</option>
              {/each}
            </select>

            {#each ALL_MODELS as model}
              {@const active = activeModels.has(model)}
              <button
                type="button"
                on:click={() => toggleModel(model)}
                class="flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-semibold transition-colors"
                style={active
                  ? `background: ${MODEL_COLORS[model]}; border-color: ${MODEL_COLORS[model]}; color: ${MODEL_TEXT_COLORS[model] ?? '#fff'};`
                  : "background: white; border-color: #cbd5e1; color: #475569;"}
              >
                <span
                  class="inline-block h-2 w-2 rounded-full"
                  style="background: {active ? 'rgba(255,255,255,0.45)' : MODEL_COLORS[model]};"
                ></span>
                {MODEL_SHORT[model]}
              </button>
            {/each}
          </div>
        </div>
      </div>

      <!-- Result count -->
      <p class="mt-4 text-sm text-slate-500">
        {#if hasActiveFilters}
          {m.home_search_match_count({
            matched: intFmt.format(filteredAgencies.length),
            total: intFmt.format(data.agencies.length),
          })} —
          <button
            type="button"
            on:click={clearFilters}
            class="underline underline-offset-2" style="color: #23272b;"
          >{m.home_search_clear_filters()}</button>
        {:else}
          {m.home_search_baseline({
            count: intFmt.format(data.agencies.length),
            states: String(data.stateCount),
          })}
        {/if}
      </p>

      <!-- Agency grid -->
      {#if filteredAgencies.length === 0}
        <div class="mt-5 rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
          <p class="font-medium text-slate-700">{m.home_search_no_match()}</p>
          <button
            type="button"
            on:click={clearFilters}
            class="mt-2 text-sm underline underline-offset-2" style="color: #23272b;"
          >
            {m.home_search_clear_filters()}
          </button>
        </div>
      {:else}
        <div class="mt-4 overflow-x-auto rounded-lg border border-slate-200">
          <table class="w-full min-w-[600px] text-sm">
            <thead>
              <tr class="border-b border-slate-200 bg-slate-50 text-left">
                <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Agency</th>
                <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Agreement</th>
                <th class="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Signed</th>
                <th class="hidden px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Population</th>
                <th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Links</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              {#each pageAgencies as agency (agency.slug)}
                <tr class="group hover:bg-slate-50">
                  <td class="px-4 py-3">
                    <a
                      href={localizeHref(`/agency/${agency.slug}`)}
                      class="font-semibold leading-snug text-slate-900 no-underline hover:underline"
                    >{agency.name}</a>
                    <p class="mt-0.5 text-xs text-slate-400">
                      {[agency.city, agency.state].filter(Boolean).join(", ")}
                    </p>
                  </td>
                  <td class="px-3 py-3">
                    <div class="flex flex-wrap gap-1">
                      {#each agency.models as model}
                        <span
                          class="model-badge"
                          class:model-badge--jail={model.includes("Jail")}
                          class:model-badge--taskforce={model.includes("Task")}
                          class:model-badge--wso={model.includes("Warrant")}
                        >{MODEL_SHORT[model] ?? model}</span>
                      {/each}
                    </div>
                  </td>
                  <td class="px-3 py-3 tabular-nums text-slate-500">
                    {agency.signed_date ? agency.signed_date.slice(0, 4) : "—"}
                  </td>
                  <td class="hidden px-3 py-3 tabular-nums text-slate-500">
                    {agency.population ? popFmt.format(agency.population) : "—"}
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold">
                      {#if agency.moa_url}
                        <a href={agency.moa_url} target="_blank" rel="noreferrer" class="no-underline hover:underline">MOA ↗</a>
                      {/if}
                      {#if agency.contact_website}
                        <a href={agency.contact_website} target="_blank" rel="noreferrer" class="no-underline hover:underline">Web ↗</a>
                      {/if}
                      <a href="https://www.muckrock.com/foi/create/" target="_blank" rel="noreferrer" class="no-underline hover:underline">FOIA ↗</a>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        {#if totalPages > 1}
          <div class="mt-6 flex items-center justify-between gap-4">
            <button
              type="button"
              on:click={() => (currentPage = Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              class="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
              <span class="hidden sm:inline">{m.home_pagination_previous()}</span>
            </button>

            <p class="text-sm text-slate-500">
              {m.home_pagination_range({
                start: String(pageStart + 1),
                end: String(pageEnd),
                total: intFmt.format(filteredAgencies.length),
              })}
            </p>

            <button
              type="button"
              on:click={() => (currentPage = Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              class="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span class="hidden sm:inline">{m.home_pagination_next()}</span>
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        {/if}
      {/if}

    </div>
  </section>

</main>

<style>
  /* Big-number overlay on the map during timeline playback. Sits over the
     empty space below the inset territories. Fades in/out gently; the inner
     card gets a soft scale-pop while the timeline is actively playing. */
  .count-overlay {
    opacity: 0;
    transition: opacity 380ms ease-out;
    transform: translateZ(0);
  }
  .count-overlay.visible {
    opacity: 1;
  }
  .count-card {
    display: inline-flex;
    align-items: stretch;
    gap: 0.9rem;
    padding: 0.45rem 1rem;
    border-radius: 0.55rem;
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    box-shadow:
      0 1px 3px rgba(15, 23, 42, 0.08),
      0 8px 22px rgba(15, 23, 42, 0.06);
    transition: transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
    will-change: transform;
  }
  @media (min-width: 640px) {
    .count-card { padding: 0.55rem 1.4rem; gap: 1.25rem; }
  }
  .count-overlay.playing .count-card {
    animation: count-breathe 1.6s ease-in-out infinite;
  }
  @keyframes count-breathe {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.025); }
  }
  .count-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .count-divider {
    width: 1px;
    background: rgba(15, 23, 42, 0.12);
    align-self: stretch;
  }
  .count-number {
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-weight: 800;
    font-size: 1.4rem;
    line-height: 1;
    color: #0f172a;
    letter-spacing: -0.02em;
  }
  @media (min-width: 640px) {
    .count-number { font-size: 2rem; }
  }
  .count-label {
    margin-top: 0.25rem;
    font-size: 0.58rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: #64748b;
  }
  @media (min-width: 640px) {
    .count-label { font-size: 0.66rem; }
  }
</style>

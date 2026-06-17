<script lang="ts">
  import type { PageData } from "./$types";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_DARK_COLORS, MODEL_SHORT, MODEL_MINI, MODEL_SLUG, MODEL_ORDER } from "$lib/colors";
  import { STATE_NAMES } from "$lib/states";
  import NationalMap from "$lib/components/NationalMap.svelte";
  import MapTimelineScrubber from "$lib/components/MapTimelineScrubber.svelte";
  import TrendCharts from "$lib/components/TrendCharts.svelte";
  import ModelLink from "$lib/components/ModelLink.svelte";
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
  import { tweened } from "svelte/motion";
  import { cubicOut } from "svelte/easing";
  import { localizeHref, getLocale } from "$lib/paraglide/runtime";
  import { buildTimelineModel, activeCountAt, coveredPopAt, overlayMonthLabel, TIMELINE_START_IDX } from "$lib/timelineCursor";
  import { m } from "$lib/paraglide/messages.js";
  import Gloss from "$lib/components/Gloss.svelte";
  import { ogImage } from "$lib/ogImage";
  import { VirtualList } from "svelte-virtuallists";

  export let data: PageData;

  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? "https://287g.recoveredfactory.net";
  const title = m.home_meta_title();
  $: description = data.agencyCountUnique > 0
    ? m.home_meta_description_with_count({ count: intFmt.format(data.agencyCountUnique) })
    : m.home_meta_description_no_data();

  const intFmt = new Intl.NumberFormat();
  const popFmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  // Overlay-only: round to the nearest million. The tweened value updates
  // many times per second; one-decimal precision makes the trailing digit
  // flicker. Whole-million steps still feel like a counter ticking up.
  const popFmtOverlay = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 0 });

  // ── Timeline cursor (experimental, #76) ────────────────────────────────────
  // Continuous fractional-month index relative to Jan 2025 (idx 0). The map
  // fades and pops each dot in as the cursor passes its signing date. The
  // animation begins Dec 18 2024 (TIMELINE_START_IDX) — the most recent pre-2025
  // archived snapshot (#169), a clean pre-Trump baseline. The ORI-deduped
  // derivations and the at-cursor counts live in $lib/timelineCursor so the
  // /video/national route shares them verbatim and the numbers can't diverge.
  $: model = buildTimelineModel(data.agencies, data.terminatedAgencies);
  $: todayIdx = model.todayIdx;
  $: maxIdx = model.maxIdx;
  // Statewide agencies (state police, corrections, etc.) are intentionally not
  // plotted — a single dot would misrepresent a whole-state jurisdiction. We
  // surface the count below the scrubber instead.
  $: statewideCount = model.statewideCount;
  const minIdx = TIMELINE_START_IDX;
  let cursorIdx = NaN;
  $: if (Number.isNaN(cursorIdx) && Number.isFinite(maxIdx)) cursorIdx = maxIdx;
  // Net active at the cursor (dips as departures cross), and local pop covered.
  $: countAtCursor = activeCountAt(model, cursorIdx);
  $: popAtCursor = coveredPopAt(model, cursorIdx);

  // Big number overlay on the map. Always visible — readers always see the
  // live count. Smooth tween catches up with easing so the digits feel like
  // they're ticking up rather than slamming on each keystroke.
  let timelinePlaying = false;
  // The video bake (scripts/bake-map-video.mjs) frame-steps the cursor and
  // screenshots each frame after a tiny delay. The 280ms count tween never
  // settles in that window, so the baked counter lags the map (it visibly
  // winds up from a low number). When the bake hook drives the cursor it sets
  // this flag so each frame's count snaps to the true value for its cursor.
  let bakeInstant = false;
  const displayedCount = tweened(0, { duration: 280, easing: cubicOut });
  const displayedPop = tweened(0, { duration: 280, easing: cubicOut });
  $: displayedCount.set(countAtCursor, bakeInstant ? { duration: 0 } : undefined);
  $: displayedPop.set(popAtCursor, bakeInstant ? { duration: 0 } : undefined);

  // Card is a tap target: clicking it restarts the timeline animation from
  // May 2025 so readers can replay the sweep without scrolling to the
  // scrubber.
  let scrubberRef: { restart: () => void } | null = null;
  const restartTimeline = () => scrubberRef?.restart();

  // Month label for the overlay's date ticker.
  $: overlayDateLabel = overlayMonthLabel(
    cursorIdx,
    todayIdx,
    getLocale() === "es" ? "es-MX" : "en-US",
  );

  // ── Search + filter ────────────────────────────────────────────────────────
  let searchQuery = "";
  let activeModels: Set<string> = new Set();
  let selectedStates: Set<string> = new Set();
  let selectedYear = "";
  let filterBarHeight = 0;
  $: thTop = `calc(var(--site-header-height) + var(--staging-banner-height) + ${filterBarHeight}px)`;

  const ALL_MODELS = MODEL_ORDER;

  // ── URL state persistence ──────────────────────────────────────────────────
  const SLUG_TO_MODEL = Object.fromEntries(
    Object.entries(MODEL_SLUG).map(([full, slug]) => [slug, full])
  );

  let urlSyncTimer: ReturnType<typeof setTimeout>;
  let mounted = false;
  let detectedState: string | null = null;

  // States with at least one agreement of ANY kind (local or state-level).
  // The "no 287(g)" callout keys off this, NOT stateMeta.participating —
  // that field counts only local (County/Municipality) agencies, so a state
  // like MA whose only agreement is state-level (Dept. of Corrections) has
  // participating===0 yet is very much not 287(g)-free. See #138.
  $: statesWithAnyAgreement = new Set(data.agencies.map((a) => a.state));

  // Geo-aware participation callout. Renders once client-side geo resolves.
  // FL gets a distinct message because SB 168 (2019) mandates 287(g)
  // cooperation — its high coverage isn't comparable to voluntary states.
  $: userStateCallout = (() => {
    if (!detectedState) return null;
    const stateName = STATE_NAMES[detectedState];
    const meta = data.stateMeta[detectedState];
    if (!stateName || !meta || !meta.local_le_agencies) return null;
    const boldState = `<b>${stateName}</b>`;
    if (!statesWithAnyAgreement.has(detectedState)) {
      // No participating agencies → no /state/<abbr> page (it 404s), so leave
      // the name as plain bold rather than linking into a dead route.
      return m.home_hero_state_callout_none({ state: boldState });
    }
    // Participating states have a /state/<abbr> page — link the name to it.
    const stateHref = localizeHref(`/state/${detectedState.toLowerCase()}`);
    const linkedState = `<a href="${stateHref}" class="font-bold underline underline-offset-2 decoration-[#BE6079] hover:text-slate-900">${stateName}</a>`;
    const agencyPct = Math.round((meta.participating / meta.local_le_agencies) * 100);
    const popPct = meta.state_local_population > 0
      ? Math.round((meta.population_served / meta.state_local_population) * 100)
      : 0;
    if (detectedState === "FL") {
      return m.home_hero_state_callout_fl({
        state: linkedState,
        agency_pct: agencyPct,
        pop_pct: popPct,
      });
    }
    return m.home_hero_state_callout_standard({
      state: linkedState,
      agency_pct: agencyPct,
      pop_pct: popPct,
    });
  })();

  // Per-session geo cache — dedupes /api/geo across a browsing session but
  // re-checks on the next visit, so a wrong/stale geo lookup self-heals
  // instead of being pinned for days. sessionStorage clears when the tab
  // closes (also makes VPN/location testing trivial: new tab = fresh lookup).
  const GEO_KEY = "rf-geo-v1";

  async function getCachedGeo(): Promise<{ country: string | null; state: string | null }> {
    try {
      const raw = sessionStorage.getItem(GEO_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        return { country: cached.c ?? null, state: cached.s ?? null };
      }
    } catch {}
    try {
      const res = await fetch("/api/geo", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        // Only cache a definitive answer; don't pin a transient null for the
        // whole session.
        if (data.country) {
          try {
            sessionStorage.setItem(GEO_KEY, JSON.stringify({ c: data.country, s: data.state }));
          } catch {}
        }
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
      const qs = params.toString();
      history.replaceState(history.state, "", qs ? `?${qs}` : location.pathname);
    }, 300);
  }

  // Only sync URL for user-initiated changes after mount. Initial-state setup
  // (URL params, geo default) runs inside onMount and intentionally skips sync.
  $: { searchQuery; selectedStates; selectedYear; activeModels;
    if (mounted) scheduleUrlSync();
  }

  onMount(async () => {
    const params = new URLSearchParams(location.search);
    const q = params.get("q");
    const models = params.get("models");
    if (q) searchQuery = q;
    // Support both ?states=TX,FL (new) and legacy ?state=TX
    const statesParam = params.get("states") ?? params.get("state");
    if (statesParam) selectedStates = new Set(statesParam.split(",").filter(Boolean));
    const year = params.get("year");
    if (year) selectedYear = year;
    if (models)
      activeModels = new Set(models.split(",").map((s) => SLUG_TO_MODEL[s]).filter(Boolean));

    // Geo: detect the user's state for the hero callout (incl. the "no 287(g)
    // here" message for states with zero agreements) and the filter button.
    // Gate on a valid state code, NOT on allStates — allStates only contains
    // states that *have* agencies, so gating on it suppressed the no-287(g)
    // callout for the very states it's meant for (e.g. IL). See #138.
    const geo = await getCachedGeo();
    if (geo.state && STATE_NAMES[geo.state]) {
      detectedState = geo.state;
    }

    mounted = true;

    // Hook for scripts/bake-map-video.mjs to drive cursorIdx deterministically
    // without racing the scrubber's rAF loop.
    (window as any).__setCursor = (idx: number) => { bakeInstant = true; cursorIdx = idx; };
    (window as any).__getTimelineBounds = () => ({ minIdx, maxIdx, todayIdx });
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

  // Signature of the active filter set. The virtual list keeps its scroll
  // position when `items` changes, so narrowing a filter would otherwise
  // strand the reader mid-list. Keying the list on this string remounts it —
  // and a fresh viewport renders from the top — whenever any filter changes.
  $: filterKey = JSON.stringify([
    searchQuery.trim().toLowerCase(),
    [...selectedStates].sort(),
    selectedYear,
    [...activeModels].sort(),
  ]);

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
  <meta property="og:image" content={ogImage('home.png')} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:title" content={title} />
  <meta property="twitter:description" content={description} />
  <meta property="twitter:image" content={ogImage('home.png')} />
  {@html `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "287(g) Agency Participation Database",
    description,
    url: siteUrl,
    license: "https://creativecommons.org/licenses/by/4.0/",
    creator: { "@type": "Organization", name: "287(g) Watch" },
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
        <p class="mt-4 border-l-4 border-[#BE6079] bg-rose-50/40 px-4 py-3 text-base text-slate-700 sm:text-lg">
          {@html userStateCallout}
        </p>
      {/if}

      <!-- Big-number stats removed (#163): agencies + population are already
           shown on the map overlay, and the block read as plain/redundant.
           The snapshot date survives as the page's data-freshness signal. -->
      {#if data.snapshotDate}
        <p class="mt-4 text-xs italic text-slate-400 sm:mt-6">
          As of {new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(data.snapshotDate))}
        </p>
      {/if}
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
          <p class="mt-1 text-xs text-slate-500 sm:text-sm">
            {m.home_map_size_note()}
          </p>
        </div>
        <!-- Legend -->
        <div class="flex flex-col items-start gap-2 sm:items-end">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-6">
            {#each MODEL_ORDER as full}
              <span class="flex items-center gap-1.5 text-xs text-slate-600 sm:text-sm">
                <span
                  class="inline-block h-2.5 w-2.5 rounded-full border border-white shadow-sm sm:h-3 sm:w-3"
                  style="background: {MODEL_COLORS[full]};"
                ></span>
                <ModelLink model={full} />
              </span>
            {/each}
          </div>
          <div class="flex items-center gap-3 text-xs text-slate-600 sm:text-sm">
            <span class="flex items-center gap-1.5">
              <span
                class="inline-block h-[6px] w-[6px] rounded-full border border-white bg-slate-400 shadow-sm"
                aria-hidden="true"
              ></span>
              10
            </span>
            <span class="flex items-center gap-1.5">
              <span
                class="inline-block h-[20px] w-[20px] rounded-full border border-white bg-slate-400 shadow-sm"
                aria-hidden="true"
              ></span>
              1,000+ {m.home_map_size_legend_label()}
            </span>
          </div>
        </div>
      </div>

      {#if detectedState && STATE_NAMES[detectedState] && data.stateMeta[detectedState]?.participating > 0 && !(selectedStates.size === 1 && selectedStates.has(detectedState))}
        <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
          <button
            type="button"
            on:click={() => (selectedStates = new Set([detectedState!]))}
            class="text-xs text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
          >Zoom to {STATE_NAMES[detectedState]} →</button>
        </div>
      {/if}
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
          terminatedAgencies={data.terminatedAgencies}
          {selectedStates}
          {cursorIdx}
        />
        <div
          class="count-overlay pointer-events-none absolute inset-x-0 top-2 flex flex-col items-center sm:top-auto sm:bottom-4"
        >
          <button
            type="button"
            on:click={restartTimeline}
            class="count-card pointer-events-auto"
            aria-label="Replay the 287(g) growth animation from January 2025"
            title="Replay from January 2025"
          >
            <div class="count-stats">
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
          </button>
          <div class="count-date">{overlayDateLabel}</div>
        </div>
      {/if}
    </div>
    {#if data.agencies.length > 0 && Number.isFinite(maxIdx)}
      <div class="bg-white">
        <div class="mx-auto max-w-6xl">
          <MapTimelineScrubber bind:this={scrubberRef} {minIdx} {maxIdx} labelMaxIdx={todayIdx} bind:cursorIdx bind:playing={timelinePlaying} {countAtCursor} />
          <div class="px-4 pb-4 text-[11px] italic leading-snug text-slate-500 sm:px-6 sm:text-xs">
            {#if statewideCount > 0}
              <p>{m.home_map_statewide_note({ count: statewideCount })}</p>
            {/if}
            <p class="mt-1">{m.home_map_boundaries_note()}</p>
            <p class="mt-1">
              <a
                href="https://github.com/appelson/Tracking_287g"
                target="_blank"
                rel="noreferrer"
                class="underline hover:text-slate-900"
              >{m.home_map_download()} ↗</a>
            </p>
          </div>
        </div>
      </div>
    {/if}
    <!-- Below the map: free download / licensing page (not in nav) -->
    <div class="border-t border-slate-200 bg-stone-50 px-4 py-3 text-center sm:px-6">
      <a
        href={localizeHref("/use-the-map")}
        class="text-sm font-semibold text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline"
      >{m.home_map_use_cta()}</a>
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
          <a
            href={localizeHref(`/model/${MODEL_SLUG[model]}`)}
            class="group flex flex-col overflow-hidden rounded border no-underline shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
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
                <span
                  class="text-sm font-semibold group-hover:underline"
                  style="color: {MODEL_DARK_COLORS[model] ?? '#334155'};"
                >Learn more →</span>
                {#if data.modelCounts[model]}
                  <p
                    class="text-right text-xs italic text-slate-500"
                    title={data.snapshotDate ? `As of ${data.snapshotDate}` : undefined}
                  >{intFmt.format(data.modelCounts[model])} agencies</p>
                {/if}
              </div>
            </div>
          </a>
        {/each}
      </div>
    </div>
  </section>

  <!-- ── National trend charts (experimental, #162) ───────────────────────── -->
  <TrendCharts agencies={data.agencies} trendMonths={data.trendMonths} trend={data.trend} />


  <!-- ── Search + filter + browse ──────────────────────────────────────────── -->
  <section class="px-4 py-10 sm:px-6 sm:py-12">
    <div class="mx-auto max-w-6xl">

      <h2 class="font-serif text-xl font-bold text-slate-900 sm:text-2xl">{m.home_search_heading()}</h2>

      <!-- Filter controls — sticky once scrolled into view -->
      <div
        bind:clientHeight={filterBarHeight}
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

            {#if detectedState && statesWithAnyAgreement.has(detectedState) && !selectedStates.has(detectedState)}
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
              <option value="">{m.home_search_year_signed()}</option>
              {#each allYears as year}
                <option value={year}>{year}</option>
              {/each}
            </select>

            {#each ALL_MODELS as model}
              {@const active = activeModels.has(model)}
              <button
                type="button"
                on:click={() => toggleModel(model)}
                class="rounded border px-3 py-1.5 text-xs font-semibold transition-colors"
                style={active
                  ? `background: ${MODEL_COLORS[model]}; border-color: ${MODEL_COLORS[model]}; color: ${MODEL_TEXT_COLORS[model] ?? '#fff'};`
                  : `background: ${MODEL_COLORS[model]}22; border-color: ${MODEL_COLORS[model]}88; color: ${MODEL_DARK_COLORS[model] ?? '#334155'};`}
              >
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
            rows: intFmt.format(data.agencies.length),
            agencies: intFmt.format(data.agencyCountUnique),
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
        <div class="agency-list mt-4 rounded-lg border border-slate-200 overflow-hidden text-sm">
          <!-- Column headers -->
          <div class="agency-row agency-row--header border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-700">
            <div class="px-3 py-2 sm:px-4 sm:py-3">Agency</div>
            <div class="px-2 py-2 sm:px-3 sm:py-3">Type</div>
            <div class="px-2 py-2 sm:px-3 sm:py-3">Signed</div>
            <div class="agency-col-pop px-2 py-2 sm:px-3 sm:py-3">Population</div>
            <div class="px-2 py-2 sm:px-3 sm:py-3">MOA</div>
            <div class="agency-col-foia px-2 py-2 sm:px-3 sm:py-3">FOIA</div>
          </div>
          <!-- Virtualized rows. Keyed on the filter signature so the list
               remounts and scrolls back to the top whenever a filter changes. -->
          {#key filterKey}
          <VirtualList items={filteredAgencies} style="height: calc(100vh - 400px); scrollbar-gutter: stable;">
            {#snippet vl_slot({ item: agency })}
            <div class="agency-row border-b border-slate-100 hover:bg-slate-50">
              <div class="px-3 py-2 sm:px-4 sm:py-3">
                <a
                  href={localizeHref(`/agency/${agency.slug}`)}
                  class="font-semibold leading-snug text-slate-900 no-underline hover:underline"
                >{agency.name}</a>
                <p class="text-xs text-slate-600">
                  {#if agency.city}{agency.city}{/if}{#if agency.city && agency.state}, {/if}{#if agency.state}<a
                    href={localizeHref(`/state/${agency.state.toLowerCase()}`)}
                    class="no-underline hover:underline"
                  >{agency.state}</a>{/if}
                </p>
              </div>
              <div class="px-2 py-2 sm:px-3 sm:py-3">
                <div class="flex flex-wrap gap-1">
                  {#each agency.models as model}
                    <span
                      class="model-badge"
                      class:model-badge--jail={model.includes("Jail")}
                      class:model-badge--taskforce={model.includes("Task")}
                      class:model-badge--wso={model.includes("Warrant")}
                      title={model}
                    >{MODEL_MINI[model] ?? model}</span>
                  {/each}
                </div>
              </div>
              <div class="px-2 py-2 tabular-nums text-slate-600 sm:px-3 sm:py-3">
                {agency.signed_date ? agency.signed_date.slice(0, 4) : "—"}
              </div>
              <div class="agency-col-pop px-2 py-2 tabular-nums text-slate-600 sm:px-3 sm:py-3">
                {agency.population ? popFmt.format(agency.population) : "—"}
              </div>
              <div class="px-2 py-2 text-xs font-semibold sm:px-3 sm:py-3">
                {#if agency.moa_url}
                  <a href={agency.moa_url} target="_blank" rel="noreferrer" class="no-underline hover:underline">↗</a>
                {:else}
                  <span class="text-slate-300">—</span>
                {/if}
              </div>
              <div class="agency-col-foia px-2 py-2 text-xs font-semibold sm:px-3 sm:py-3">
                <a href="https://www.muckrock.com/foi/create/" target="_blank" rel="noreferrer" class="no-underline hover:underline">→</a>
              </div>
            </div>
            {/snippet}
          </VirtualList>
          {/key}
        </div>
      {/if}

    </div>
  </section>

</main>

<style>
  /* Big-number overlay on the map. Always visible. The card itself is a
     button — tapping it replays the growth animation from Jan 2025. */
  .count-overlay {
    transform: translateZ(0);
  }
  button.count-card {
    /* Reset native button chrome so the card looks like a card. */
    border: 0;
    font: inherit;
    color: inherit;
    text-align: inherit;
    cursor: pointer;
    display: inline-flex;
    flex-direction: column;
    align-items: stretch;
    /* Fixed width so the box doesn't widen as the count crosses
       thousands or the population step-jumps to a wider compact label. */
    width: 13rem;
    padding: 0.5rem 0.75rem 0.55rem;
    border-radius: 0.55rem;
    background: rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    box-shadow:
      0 1px 3px rgba(15, 23, 42, 0.08),
      0 8px 22px rgba(15, 23, 42, 0.10);
    transition: background-color 180ms ease-out, transform 180ms ease-out;
  }
  @media (min-width: 640px) {
    button.count-card { width: 15rem; padding: 0.6rem 1rem 0.65rem; }
  }
  button.count-card:hover {
    background: #ffffff;
  }
  button.count-card:active {
    transform: scale(0.98);
  }
  button.count-card:focus-visible {
    outline: 2px solid rgba(15, 23, 42, 0.4);
    outline-offset: 2px;
  }
  .count-date {
    margin-top: 0.4rem;
    text-align: center;
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: #ffffff;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
  }
  @media (min-width: 640px) {
    .count-date { font-size: 0.72rem; }
  }
  .count-stats {
    display: flex;
    gap: 0.75rem;
    align-items: stretch;
  }
  @media (min-width: 640px) {
    .count-stats { gap: 1rem; }
  }
  .count-stat {
    flex: 1 1 0;
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
    font-size: 1.35rem;
    line-height: 1;
    color: #0f172a;
    letter-spacing: -0.02em;
  }
  @media (min-width: 640px) {
    .count-number { font-size: 1.7rem; }
  }
  .count-label {
    margin-top: 0.25rem;
    font-size: 0.55rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: #64748b;
    text-align: center;
    white-space: nowrap;
  }
  @media (min-width: 640px) {
    .count-label { font-size: 0.62rem; }
  }

  /* Agency virtual list grid. Fixed column tracks (not `auto`) so every row —
     header included — sizes its columns identically and they line up into a
     real table. `auto` tracks size to each row's own content, which is what
     broke the tabular alignment. minmax(0, …) lets the name column shrink and
     wrap instead of forcing the grid wider than its container. */
  .agency-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 7rem 3.25rem 2.5rem;
    align-items: center;
  }
  /* The virtualized rows live inside a scrolling viewport; on classic
     (space-consuming) scrollbars that viewport is ~15px narrower than the
     header, which would shift every column. Reserve the same gutter on the
     header so the two grids share an identical content width and the columns
     line up. `scrollbar-gutter` is a no-op with overlay scrollbars, so this
     doesn't disturb platforms where they already align. */
  .agency-row--header {
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
  .agency-col-pop,
  .agency-col-foia {
    display: none;
  }
  @media (min-width: 640px) {
    .agency-row {
      grid-template-columns: minmax(0, 1fr) 8.5rem 4rem 5.5rem 3.5rem 3.5rem;
    }
    .agency-col-pop,
    .agency-col-foia {
      display: block;
    }
  }
  /* svelte-virtuallists' inner track. Full width so each grid row spans the
     viewport and its columns line up with the header. (The viewport — .vtlist —
     already gets overflow:auto from the lib; we add `scrollbar-gutter: stable`
     via the component's style prop so its reserved gutter matches the header's
     above and the columns don't shift.) */
  :global(.vtlist-inner) {
    width: 100%;
  }
</style>

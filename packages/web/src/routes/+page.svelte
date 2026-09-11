<script lang="ts">
  import type { PageData } from "./$types";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_DARK_COLORS, MODEL_MINI, MODEL_SLUG, MODEL_ORDER } from "$lib/colors";
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
  import { getCachedGeo } from "$lib/geo";

  export let data: PageData;

  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? "https://287g.recoveredfactory.net";
  const homeUrl = siteUrl + localizeHref("/").replace(/\/$/, "");
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

  // Highlighted/zoomed state on the map — set by the geo "Zoom to my state"
  // button or a shared ?states= link. No longer paired with a browse/filter
  // UI (that's /states now); this is purely the map's own state.
  let selectedStates: Set<string> = new Set();

  const ALL_MODELS = MODEL_ORDER;

  // ── URL state persistence ──────────────────────────────────────────────────
  let urlSyncTimer: ReturnType<typeof setTimeout>;
  let mounted = false;
  let detectedState: string | null = null;

  // States with at least one agreement of ANY kind (local or state-level).
  // The "no 287(g)" callout keys off this, NOT stateMeta.participating —
  // that field counts only local (County/Municipality) agencies, so a state
  // like MA whose only agreement is state-level (Dept. of Corrections) has
  // participating===0 yet is very much not 287(g)-free. See #138.
  $: statesWithAnyAgreement = new Set(data.agencies.map((a) => a.state));

  // "Most active this month" — real computed net signed-vs-terminated
  // agreements per state, for the most recent month actually present in the
  // data (not wall-clock "now", since a snapshot can lag). Data-driven, no
  // editorial narrative, per AGENTS.md.
  $: latestActivityYm = (() => {
    const dates = [
      ...data.agencies.map((a) => a.signed_date).filter((d): d is string => !!d),
      ...data.terminatedAgencies.map((a) => a.terminated_date).filter((d): d is string => !!d),
    ];
    return dates.length ? (dates.map((d) => d.slice(0, 7)).sort().at(-1) ?? null) : null;
  })();

  $: monthLabel = latestActivityYm
    ? new Intl.DateTimeFormat(getLocale() === "es" ? "es-MX" : "en-US", { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${latestActivityYm}-01T00:00:00Z`))
    : "";

  type StateActivity = { abbr: string; net: number };
  $: mostActiveStates = ((): StateActivity[] => {
    if (!latestActivityYm) return [];
    const byState = new Map<string, { signed: number; terminated: number }>();
    const bump = (state: string, key: "signed" | "terminated") => {
      const cur = byState.get(state) ?? { signed: 0, terminated: 0 };
      cur[key]++;
      byState.set(state, cur);
    };
    for (const a of data.agencies) {
      if (a.signed_date?.slice(0, 7) === latestActivityYm) bump(a.state, "signed");
    }
    for (const a of data.terminatedAgencies) {
      if (a.terminated_date?.slice(0, 7) === latestActivityYm) bump(a.state, "terminated");
    }
    return [...byState.entries()]
      .map(([abbr, { signed, terminated }]) => ({ abbr, net: signed - terminated }))
      .filter((s) => s.net > 0)
      .sort((a, b) => b.net - a.net)
      .slice(0, 3);
  })();

  // Geo-aware participation callout. Renders once client-side geo resolves.
  // FL gets a distinct message because SB 168 (2019) mandates 287(g)
  // cooperation — its high coverage isn't comparable to voluntary states.
  $: userStateCallout = (() => {
    if (!detectedState) return null;
    const stateName = STATE_NAMES[detectedState];
    const meta = data.stateMeta[detectedState];
    if (!stateName || !meta || !meta.local_le_agencies) return null;
    // Every navigable state now has a /state/<abbr> page — participating or not —
    // so link the name in both the "has agreements" and the "none" callout. (meta
    // exists only for the 50 states + DC, so detectedState here is always navigable.)
    const stateHref = localizeHref(`/state/${detectedState.toLowerCase()}`);
    const linkedState = `<a href="${stateHref}" class="font-bold underline underline-offset-2 decoration-[#BE6079] hover:text-ink-900">${stateName}</a>`;
    if (!statesWithAnyAgreement.has(detectedState)) {
      return m.home_hero_state_callout_none({ state: linkedState });
    }
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

  function scheduleUrlSync() {
    if (!browser) return;
    clearTimeout(urlSyncTimer);
    urlSyncTimer = setTimeout(() => {
      const params = new URLSearchParams();
      if (selectedStates.size > 0) params.set("states", [...selectedStates].join(","));
      const qs = params.toString();
      history.replaceState(history.state, "", qs ? `?${qs}` : location.pathname);
    }, 300);
  }

  // Only sync URL for user-initiated changes after mount. Initial-state setup
  // (URL params, geo default) runs inside onMount and intentionally skips sync.
  $: { selectedStates;
    if (mounted) scheduleUrlSync();
  }

  onMount(async () => {
    const params = new URLSearchParams(location.search);
    // Support both ?states=TX,FL (new) and legacy ?state=TX
    const statesParam = params.get("states") ?? params.get("state");
    if (statesParam) selectedStates = new Set(statesParam.split(",").filter(Boolean));

    // Geo: detect the user's state for the hero callout (incl. the "no 287(g)
    // here" message for states with zero agreements) and the map's zoom
    // button. Gate on a valid state code, not on which states have agencies —
    // that would suppress the no-287(g) callout for the very states it's
    // meant for (e.g. IL). See #138.
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

  // "Recently signed" preview — the most recently signed agreements, newest
  // first, complementary to /states' rank-by-size lists (this one's ordered
  // by time, not size). Links to /states for the full browse+compare tool
  // instead of duplicating a full filterable grid here.
  const RECENT_N = 8;
  $: recentAgencies = [...data.agencies]
    .filter((a) => a.signed_date)
    .sort((a, b) => (b.signed_date ?? "").localeCompare(a.signed_date ?? ""))
    .slice(0, RECENT_N);

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
  <meta property="og:url" content={homeUrl} />
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
  <section class="border-b px-4 py-14 sm:px-6 sm:py-24" style="border-color: var(--color-paper-200); background: var(--color-paper-50);">
    <div class="mx-auto max-w-3xl">
      <p class="mb-4 flex items-center gap-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] sm:mb-5" style="color: var(--color-ink-500);">
        {m.home_hero_eyebrow()}
        <span aria-hidden="true" class="h-px flex-1" style="background: var(--color-paper-200);"></span>
      </p>
      <h1
        class="text-[length:var(--text-display)] font-black leading-[1.05] tracking-[-0.01em]"
        style="color: var(--color-ink-900); text-wrap: balance; max-width: 16ch;"
      >
        {m.home_hero_headline_line1()} {m.home_hero_headline_line2()}
      </h1>
      <p class="prose-editorial mt-5 max-w-2xl text-[length:var(--text-body-lg)] sm:mt-6">
        <Gloss text={m.home_hero_lead()} />
      </p>

      {#if userStateCallout}
        <p class="mt-5 max-w-2xl border-l-4 border-[#BE6079] bg-rose-50/40 px-4 py-3 text-base sm:mt-6 sm:text-lg" style="color: var(--color-ink-700);">
          {@html userStateCallout}
        </p>
      {/if}

      <!-- Big-number stats removed (#163): agencies + population are already
           shown on the map overlay, and the block read as plain/redundant.
           The snapshot date survives as the page's data-freshness signal. -->
      {#if data.snapshotDate}
        <p class="mt-8 max-w-2xl border-t pt-4 font-mono text-xs sm:mt-10" style="border-color: var(--color-paper-200); color: var(--color-ink-500);">
          As of {new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(data.snapshotDate))}
        </p>
      {/if}
    </div>
  </section>

  <!-- ── Map ──────────────────────────────────────────────────────────────── -->
  <section class="border-b pt-12 sm:pt-16" style="border-color: var(--color-paper-200); background: var(--color-paper-100);">
    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h2 class="font-serif text-[length:var(--text-h2)] font-bold" style="color: var(--color-ink-900);">
            {m.home_map_heading()}
          </h2>
          <p class="mt-1 text-xs sm:text-sm" style="color: var(--color-ink-500);">
            {m.home_map_subhead()}
          </p>
          <p class="mt-1 text-xs sm:text-sm" style="color: var(--color-ink-500);">
            {m.home_map_size_note()}
          </p>
        </div>
        <!-- Legend -->
        <div class="flex flex-col items-start gap-2 sm:items-end">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-6">
            {#each MODEL_ORDER as full}
              <span class="flex items-center gap-1.5 text-xs sm:text-sm" style="color: var(--color-ink-700);">
                <span
                  class="inline-block h-2.5 w-2.5 rounded-full border border-white shadow-sm sm:h-3 sm:w-3"
                  style="background: {MODEL_COLORS[full]};"
                ></span>
                <ModelLink model={full} />
              </span>
            {/each}
          </div>
          <div class="flex items-center gap-3 text-xs sm:text-sm" style="color: var(--color-ink-700);">
            <span class="flex items-center gap-1.5">
              <span
                class="inline-block h-[6px] w-[6px] rounded-full border border-white shadow-sm"
                style="background: var(--color-ink-500);"
                aria-hidden="true"
              ></span>
              10
            </span>
            <span class="flex items-center gap-1.5">
              <span
                class="inline-block h-[20px] w-[20px] rounded-full border border-white shadow-sm"
                style="background: var(--color-ink-500);"
                aria-hidden="true"
              ></span>
              1,000+ {m.home_map_size_legend_label()}
            </span>
          </div>
        </div>
      </div>

      {#if detectedState && STATE_NAMES[detectedState] && data.stateMeta[detectedState]?.participating > 0 && !(selectedStates.size === 1 && selectedStates.has(detectedState))}
        <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs" style="color: var(--color-ink-500);">
          <button
            type="button"
            on:click={() => (selectedStates = new Set([detectedState!]))}
            class="text-xs underline-offset-2 hover:underline"
            style="color: var(--color-ink-500);"
          >Zoom to {STATE_NAMES[detectedState]} →</button>
        </div>
      {/if}
    </div>

    <!-- Map: full-bleed so the country breaks the column and reads at scale -->
    <div class="relative mt-4 h-[360px] overflow-hidden border-y shadow-sm sm:h-[560px] lg:h-[680px]" style="border-color: var(--color-paper-200);">
      {#if data.agencies.length === 0}
        <div class="flex h-full items-center justify-center" style="background: var(--color-paper-200); color: var(--color-ink-500);">
          <div class="px-6 text-center">
            <p class="font-medium" style="color: var(--color-ink-700);">{m.home_map_empty_title()}</p>
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
      <div style="background: var(--color-paper-50);">
        <div class="mx-auto max-w-6xl">
          <MapTimelineScrubber bind:this={scrubberRef} {minIdx} {maxIdx} labelMaxIdx={todayIdx} bind:cursorIdx bind:playing={timelinePlaying} {countAtCursor} />
          <div class="px-4 pb-4 text-[11px] italic leading-snug sm:px-6 sm:text-xs" style="color: var(--color-ink-500);">
            {#if statewideCount > 0}
              <p>{m.home_map_statewide_note({ count: statewideCount })}</p>
            {/if}
            <p class="mt-1">{m.home_map_boundaries_note()}</p>
            <p class="mt-1">
              <a
                href="https://github.com/appelson/Tracking_287g"
                target="_blank"
                rel="noreferrer"
                class="underline"
                style="color: var(--color-ink-500);"
              >{m.home_map_download()} ↗</a>
            </p>
          </div>
        </div>
      </div>
    {/if}
    <!-- Below the map: free download / licensing page (not in nav) -->
    <div class="border-t px-4 py-3 text-center sm:px-6" style="border-color: var(--color-paper-200); background: var(--color-paper-100);">
      <a
        href={localizeHref("/use-the-map")}
        class="text-sm font-semibold underline-offset-2 hover:underline"
        style="color: var(--color-ink-700);"
      >{m.home_map_use_cta()}</a>
    </div>
  </section>

  <!-- ── Browse & compare / most active this month ────────────────────────── -->
  <section class="border-b px-4 py-12 sm:px-6 sm:py-16" style="border-color: var(--color-paper-200); background: var(--color-paper-50);">
    <div class="mx-auto grid max-w-6xl gap-6 {mostActiveStates.length > 0 ? 'sm:grid-cols-2' : ''}">
      <div class="flex flex-col justify-between rounded-lg border p-6" style="border-color: var(--color-paper-200); background: var(--color-paper-100);">
        <div>
          <p class="text-xs font-semibold uppercase tracking-widest" style="color: var(--color-ink-500);">{m.browse_eyebrow()}</p>
          <h2 class="mt-1 font-serif text-xl font-bold" style="color: var(--color-ink-900);">{m.home_browse_cta_heading()}</h2>
          <p class="mt-2 text-sm leading-relaxed" style="color: var(--color-ink-700);">{m.home_browse_cta_body()}</p>
        </div>
        <a
          href={localizeHref("/states")}
          class="mt-4 inline-flex w-fit items-center gap-1 text-sm font-semibold no-underline hover:underline"
          style="color: var(--color-ink-900);"
        >{m.home_browse_cta_link()} →</a>
      </div>

      {#if mostActiveStates.length > 0}
        <div class="rounded-lg border p-6" style="border-color: var(--color-paper-200); background: var(--color-paper-100);">
          <p class="text-xs font-semibold uppercase tracking-widest" style="color: var(--color-ink-500);">{m.home_active_heading()}</p>
          <p class="mt-1 text-sm" style="color: var(--color-ink-700);">{m.home_active_body({ month: monthLabel })}</p>
          <ul class="mt-4 space-y-2.5">
            {#each mostActiveStates as s (s.abbr)}
              <li class="flex items-center justify-between gap-3">
                <a
                  href={localizeHref(`/state/${s.abbr.toLowerCase()}`)}
                  class="text-sm font-semibold no-underline hover:underline"
                  style="color: var(--color-ink-900);"
                >{STATE_NAMES[s.abbr] ?? s.abbr}</a>
                <span class="font-mono text-sm tabular-nums" style="color: var(--color-ink-700);">{m.home_active_delta({ count: s.net })}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </section>

  <!-- ── What each model authorizes ───────────────────────────────────────── -->
  <section class="border-b px-4 py-16 sm:px-6 sm:py-20" style="border-color: var(--color-paper-200); background: var(--color-paper-50);">
    <div class="mx-auto max-w-6xl">
      <h2 class="font-serif text-[length:var(--text-h2)] font-bold" style="color: var(--color-ink-900);">
        {m.home_models_heading()}
      </h2>
      <div class="mt-8 grid items-stretch gap-5 sm:grid-cols-3">
        {#each ALL_MODELS as model}
          {@const desc = modelDesc(model)}
          <a
            href={localizeHref(`/model/${MODEL_SLUG[model]}`)}
            class="group flex flex-col overflow-hidden border no-underline shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style="border-color: {MODEL_COLORS[model]};"
          >
            <div class="px-[1.1rem] py-[0.85rem]" style="background: {MODEL_COLORS[model]};">
              <h3
                class="font-serif text-base font-bold tracking-[0.01em]"
                style="color: {MODEL_TEXT_COLORS[model] ?? '#ffffff'};"
              >{model.replace(/ Model$/, '')}</h3>
            </div>
            <div class="flex flex-1 flex-col gap-3 px-[1.1rem] py-4" style="background: {MODEL_COLORS[model]}28;">
              <p class="text-sm leading-relaxed" style="color: var(--color-ink-700);">{@html desc.short}</p>
              <div class="mt-auto flex items-end justify-between gap-2">
                <span
                  class="text-sm font-semibold group-hover:underline"
                  style="color: {MODEL_DARK_COLORS[model] ?? '#334155'};"
                >Learn more →</span>
                {#if data.modelCounts[model]}
                  <p
                    class="text-right font-mono text-xs"
                    style="color: var(--color-ink-500);"
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


  <!-- ── Recently signed agreements ────────────────────────────────────────── -->
  <section class="px-4 py-16 sm:px-6 sm:py-20">
    <div class="mx-auto max-w-6xl">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <h2 class="font-serif text-[length:var(--text-h2)] font-bold" style="color: var(--color-ink-900);">{m.home_recent_heading()}</h2>
        <div class="flex flex-col items-end gap-1 text-sm font-semibold">
          <a
            href={localizeHref("/states")}
            class="no-underline hover:underline"
            style="color: var(--color-ink-900);"
          >{m.home_recent_browse_all()} →</a>
          <a
            href={localizeHref("/timeline")}
            class="no-underline hover:underline"
            style="color: var(--color-ink-700);"
          >{m.home_recent_see_timeline()} →</a>
        </div>
      </div>

      {#if recentAgencies.length > 0}
        <ul class="mt-6 divide-y overflow-hidden rounded-lg border" style="border-color: var(--color-paper-200);">
          {#each recentAgencies as agency (agency.slug)}
            <li class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5" style="border-color: var(--color-paper-100); background: var(--color-paper-50);">
              <div class="min-w-0">
                <a
                  href={localizeHref(`/agency/${agency.slug}`)}
                  class="font-semibold leading-snug no-underline hover:underline"
                  style="color: var(--color-ink-900);"
                >{agency.name}</a>
                <p class="text-xs" style="color: var(--color-ink-500);">
                  {#if agency.city}{agency.city}, {/if}<a
                    href={localizeHref(`/state/${agency.state.toLowerCase()}`)}
                    class="no-underline hover:underline"
                  >{agency.state}</a>
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-3">
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
                <span class="font-mono text-xs tabular-nums" style="color: var(--color-ink-500);">{agency.signed_date}</span>
              </div>
            </li>
          {/each}
        </ul>
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
      0 1px 3px rgba(36, 31, 22, 0.08),
      0 8px 22px rgba(36, 31, 22, 0.10);
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
    outline: 2px solid rgba(36, 31, 22, 0.4);
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
    background: rgba(36, 31, 22, 0.12);
    align-self: stretch;
  }
  .count-number {
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-weight: 800;
    font-size: 1.35rem;
    line-height: 1;
    color: var(--color-ink-900);
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
    color: var(--color-ink-500);
    text-align: center;
    white-space: nowrap;
  }
  @media (min-width: 640px) {
    .count-label { font-size: 0.62rem; }
  }
</style>

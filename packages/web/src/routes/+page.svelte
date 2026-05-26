<script lang="ts">
  import type { PageData } from "./$types";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_DARK_COLORS, MODEL_SHORT, MODEL_SLUG } from "$lib/colors";
  import { STATE_NAMES } from "$lib/states";
  import NationalMap from "$lib/components/NationalMap.svelte";
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
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

  // ── Search + filter ────────────────────────────────────────────────────────
  let searchQuery = "";
  let activeModels: Set<string> = new Set();
  let selectedState = "";
  let selectedYear = "";
  let currentPage = 1;
  const PAGE_SIZE = 25;

  const ALL_MODELS = Object.keys(MODEL_SHORT);

  // ── URL state persistence ──────────────────────────────────────────────────
  const SLUG_TO_MODEL = Object.fromEntries(
    Object.entries(MODEL_SLUG).map(([full, slug]) => [slug, full])
  );

  let urlSyncTimer: ReturnType<typeof setTimeout>;
  let mounted = false;
  let detectedState: string | null = null;

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
      if (selectedState) params.set("state", selectedState);
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
  $: { searchQuery; selectedState; selectedYear; activeModels; currentPage;
    if (mounted) scheduleUrlSync();
  }

  onMount(async () => {
    const params = new URLSearchParams(location.search);
    const q = params.get("q");
    const stateParam = params.get("state");
    const models = params.get("models");
    const page = params.get("page");
    if (q) searchQuery = q;
    if (stateParam) selectedState = stateParam;
    const year = params.get("year");
    if (year) selectedYear = year;
    if (models)
      activeModels = new Set(models.split(",").map((s) => SLUG_TO_MODEL[s]).filter(Boolean));

    // Geo: silently default the state filter if the URL didn't specify one.
    // Always record the detected state so the "use my state" link can surface
    // when URL specified a different one.
    const geo = await getCachedGeo();
    if (geo.state && allStates.includes(geo.state)) {
      detectedState = geo.state;
      if (!stateParam) selectedState = detectedState;
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
    const matchesState = !selectedState || a.state === selectedState;
    const matchesYear = !selectedYear || a.signed_date?.startsWith(selectedYear);
    return matchesSearch && matchesModel && matchesState && matchesYear;
  });

  // Reset to page 1 whenever filters change
  $: if (filteredAgencies) currentPage = 1;

  $: totalPages = Math.max(1, Math.ceil(filteredAgencies.length / PAGE_SIZE));
  $: pageStart = (currentPage - 1) * PAGE_SIZE;
  $: pageEnd = Math.min(pageStart + PAGE_SIZE, filteredAgencies.length);
  $: pageAgencies = filteredAgencies.slice(pageStart, pageEnd);

  const toggleModel = (model: string) => {
    const next = new Set(activeModels);
    if (next.has(model)) next.delete(model);
    else next.add(model);
    activeModels = next;
  };

  const clearFilters = () => {
    searchQuery = "";
    activeModels = new Set();
    selectedState = "";
    selectedYear = "";
  };

  $: hasActiveFilters = searchQuery.trim() !== "" || activeModels.size > 0 || selectedState !== "" || selectedYear !== "";

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
      <h1 class="mt-2 text-3xl font-black leading-tight text-slate-900 sm:mt-3 sm:text-5xl lg:text-6xl">
        {m.home_hero_headline_line1()}<br class="hidden sm:block" /> {m.home_hero_headline_line2()}
      </h1>
      <p class="prose-editorial mt-4 text-base sm:mt-6 sm:text-lg">
        <Gloss text={m.home_hero_lead()} />
      </p>

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
            class="flex flex-col overflow-hidden rounded-lg border shadow-sm"
            style="border-color: {MODEL_COLORS[model]};"
          >
            <div class="px-3 py-2.5" style="background: {MODEL_COLORS[model]};">
              <h3
                class="font-sans text-xs font-bold uppercase tracking-widest"
                style="color: {MODEL_TEXT_COLORS[model] ?? '#ffffff'};"
              >{model.replace(/ Model$/, '')}</h3>
            </div>
            <div class="flex flex-1 flex-col gap-2 px-3 py-3" style="background: {MODEL_COLORS[model]}28;">
              <p class="text-xs leading-relaxed text-slate-700">{desc.short}</p>
              <div class="flex items-end justify-between gap-2">
                <a
                  href={localizeHref(`/model/${MODEL_SLUG[model]}`)}
                  class="text-xs font-semibold no-underline hover:underline"
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
  <section class="border-b border-slate-200 bg-stone-50 px-4 py-8 sm:px-6 sm:py-10">
    <div class="mx-auto max-w-6xl">
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
        <div class="flex flex-wrap gap-x-4 gap-y-2 sm:gap-x-6">
          {#each Object.entries(MODEL_SHORT) as [full, short]}
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

      <!-- Map: shorter on mobile, taller on desktop -->
      <div class="relative mt-4 h-[320px] overflow-hidden rounded-lg border border-slate-200 shadow-sm sm:h-[500px] lg:h-[600px]">
        {#if data.agencies.length === 0}
          <div class="flex h-full items-center justify-center bg-slate-100 text-slate-500">
            <div class="px-6 text-center">
              <p class="font-medium text-slate-700">{m.home_map_empty_title()}</p>
              <p class="mt-1 text-sm">{m.home_map_empty_subtitle()}</p>
            </div>
          </div>
        {:else}
          <NationalMap agencies={data.agencies} />
        {/if}
      </div>
    </div>
  </section>

  <!-- ── Support callout ──────────────────────────────────────────────────── -->
  <section class="border-b border-slate-200 bg-white px-4 py-5 sm:px-6">
    <div class="mx-auto flex max-w-6xl items-center justify-between gap-4">
      <p class="text-sm text-slate-500">
        {m.home_support_prefix()} <a href="https://vsr.recoveredfactory.net/en" target="_blank" rel="noreferrer" class="font-medium text-slate-700">Recovered Factory</a>{m.home_support_suffix()}
      </p>
      <a
        href="https://vsr.recoveredfactory.net/en"
        target="_blank"
        rel="noreferrer"
        class="shrink-0 rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 no-underline hover:border-slate-400 hover:text-slate-900 hover:no-underline"
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
              class="w-full rounded-md border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <!-- State + model row — wraps cleanly on mobile -->
          <div class="flex flex-wrap items-center gap-2">
            <select
              bind:value={selectedState}
              class="rounded-md border border-slate-300 bg-white py-2 pl-3 pr-7 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">{m.home_search_all_states()}</option>
              {#each allStates as state}
                <option value={state}>{STATE_NAMES[state] ?? state}</option>
              {/each}
            </select>

            {#if detectedState && selectedState !== detectedState}
              <button
                type="button"
                on:click={() => (selectedState = detectedState ?? "")}
                class="text-xs text-blue-800 underline underline-offset-2 hover:text-blue-900"
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
                class="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
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
            class="text-blue-800 underline underline-offset-2 hover:text-blue-900"
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
            class="mt-2 text-sm text-blue-800 underline underline-offset-2"
          >
            {m.home_search_clear_filters()}
          </button>
        </div>
      {:else}
        <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each pageAgencies as agency (agency.slug)}
            <div class="group relative rounded-lg border border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm">
              <a
                href={localizeHref(`/agency/${agency.slug}`)}
                class="block p-4 no-underline active:bg-slate-50"
              >
                <p class="font-semibold leading-snug text-slate-900 group-hover:text-slate-700">
                  {agency.name}
                </p>
                <p class="mt-0.5 text-sm text-slate-500">
                  {[agency.city, STATE_NAMES[agency.state] ?? agency.state]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                <div class="mt-2 flex flex-wrap gap-1.5" class:pr-12={!!agency.moa_url}>
                  {#each agency.models as model}
                    <span
                      class="model-badge"
                      class:model-badge--jail={model.includes("Jail")}
                      class:model-badge--taskforce={model.includes("Task")}
                      class:model-badge--wso={model.includes("Warrant")}
                    >
                      {MODEL_SHORT[model] ?? model}
                    </span>
                  {/each}
                </div>
              </a>
              {#if agency.moa_url}
                <a
                  href={agency.moa_url}
                  target="_blank"
                  rel="noreferrer"
                  class="absolute bottom-4 right-3 text-xs text-slate-400 no-underline hover:text-slate-700"
                  aria-label="View agreement PDF for {agency.name}"
                >PDF ↗</a>
              {/if}
            </div>
          {/each}
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

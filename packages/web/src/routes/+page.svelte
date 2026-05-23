<script lang="ts">
  import type { PageData } from "./$types";
  import { MODEL_COLORS, MODEL_SHORT, MODEL_SLUG } from "$lib/colors";
  import { STATE_NAMES } from "$lib/states";
  import NationalMap from "$lib/components/NationalMap.svelte";
  import { browser } from "$app/environment";
  import { onMount } from "svelte";

  export let data: PageData;

  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? "https://tracking287g.com";
  const title = "Tracking 287(g) — ICE's Local Enforcement Partnerships";
  $: description = data.agencyCount > 0
    ? `${intFmt.format(data.agencyCount)} local law enforcement agencies have signed 287(g) agreements with ICE, authorizing officers to enforce federal immigration law. We tracked all of them.`
    : "Tracking local law enforcement agencies with 287(g) agreements authorizing officers to enforce federal immigration law.";

  const intFmt = new Intl.NumberFormat();
  const popFmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

  // ── Search + filter ────────────────────────────────────────────────────────
  let searchQuery = "";
  let activeModels: Set<string> = new Set();
  let selectedState = "";
  let currentPage = 1;
  const PAGE_SIZE = 25;

  const ALL_MODELS = Object.keys(MODEL_SHORT);

  // ── URL state persistence ──────────────────────────────────────────────────
  const SLUG_TO_MODEL = Object.fromEntries(
    Object.entries(MODEL_SLUG).map(([full, slug]) => [slug, full])
  );

  let urlSyncTimer: ReturnType<typeof setTimeout>;

  function scheduleUrlSync() {
    if (!browser) return;
    clearTimeout(urlSyncTimer);
    urlSyncTimer = setTimeout(() => {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (selectedState) params.set("state", selectedState);
      if (activeModels.size > 0)
        params.set("models", [...activeModels].map((m) => MODEL_SLUG[m]).filter(Boolean).join(","));
      if (currentPage > 1) params.set("page", String(currentPage));
      const qs = params.toString();
      history.replaceState(history.state, "", qs ? `?${qs}` : location.pathname);
    }, 300);
  }

  $: { searchQuery; selectedState; activeModels; currentPage; scheduleUrlSync(); }

  onMount(() => {
    const params = new URLSearchParams(location.search);
    const q = params.get("q");
    const state = params.get("state");
    const models = params.get("models");
    const page = params.get("page");
    if (q) searchQuery = q;
    if (state) selectedState = state;
    if (models)
      activeModels = new Set(models.split(",").map((s) => SLUG_TO_MODEL[s]).filter(Boolean));
    // Set page last — filter changes above will reset currentPage to 1 reactively,
    // so this must come after all other assignments to stick.
    if (page) {
      const n = parseInt(page, 10);
      if (!isNaN(n) && n > 1) currentPage = n;
    }
  });

  $: allStates = [...new Set(data.agencies.map((a) => a.state).filter(Boolean))].sort();

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
    return matchesSearch && matchesModel && matchesState;
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
  };

  $: hasActiveFilters = searchQuery.trim() !== "" || activeModels.size > 0 || selectedState !== "";

  // ── Model descriptions ─────────────────────────────────────────────────────
  const MODEL_DESCRIPTIONS: Record<string, { short: string; detail: string }> = {
    "Jail Enforcement Model": {
      short: "Officers screen people booked into local jails for immigration status.",
      detail: "Participating officers may issue civil detainers — requests for jails to hold people beyond their scheduled release so ICE can take custody. JEM operates inside detention facilities only, not in the community. It is the oldest and most common 287(g) model.",
    },
    "Task Force Model": {
      short: "Officers work alongside ICE agents in the community to make immigration arrests.",
      detail: "TFM grants the broadest authority of the three models. Participating officers can stop, question, and arrest individuals in the community — not only those already in custody. They operate jointly with ICE field agents on targeted enforcement operations.",
    },
    "Warrant Service Officer": {
      short: "Officers are authorized to serve administrative warrants on people ICE has already identified.",
      detail: "Introduced around 2020, the WSO model is narrower than JEM or TFM. Officers may only serve administrative warrants on specific individuals ICE has already identified for removal. They cannot initiate independent enforcement or conduct community operations.",
    },
  };
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
    creator: { "@type": "Organization", name: "Tracking 287(g)" },
  })}</` + `script>`}
</svelte:head>

<main id="main-content">

  <!-- ── Hero ─────────────────────────────────────────────────────────────── -->
  <section class="border-b border-slate-200 bg-white px-4 py-10 sm:px-6 sm:py-20">
    <div class="mx-auto max-w-3xl">
      <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 sm:text-sm">
        Public Interest Investigation
      </p>
      <h1 class="mt-2 text-3xl font-black leading-tight text-slate-900 sm:mt-3 sm:text-5xl lg:text-6xl">
        Your sheriff<br class="hidden sm:block" /> may work for ICE.
      </h1>
      <p class="prose-editorial mt-4 text-base sm:mt-6 sm:text-lg">
        Under Section 287(g) of the Immigration and Nationality Act, local law enforcement
        agencies can sign agreements with ICE authorizing their officers to perform immigration
        enforcement. The program has expanded dramatically since 2017. We're tracking every
        agreement.
      </p>

      {#if data.agencyCount > 0}
        <div class="mt-6 flex flex-wrap gap-6 sm:mt-8 sm:gap-8">
          <div>
            <p class="font-mono text-2xl font-semibold tabular-nums text-slate-900 sm:text-3xl">
              {intFmt.format(data.agencyCount)}
            </p>
            <p class="mt-0.5 text-xs text-slate-500 sm:text-sm">participating agencies</p>
          </div>
          <div>
            <p class="font-mono text-2xl font-semibold tabular-nums text-slate-900 sm:text-3xl">
              {data.stateCount}
            </p>
            <p class="mt-0.5 text-xs text-slate-500 sm:text-sm">states</p>
          </div>
          {#if data.populationCovered > 0}
            <div>
              <p class="font-mono text-2xl font-semibold tabular-nums text-slate-900 sm:text-3xl">
                {popFmt.format(data.populationCovered)}
              </p>
              <p class="mt-0.5 text-xs text-slate-500 sm:text-sm">people in participating jurisdictions</p>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </section>

  <!-- ── Map ──────────────────────────────────────────────────────────────── -->
  <section class="border-b border-slate-200 bg-stone-50 px-4 py-8 sm:px-6 sm:py-10">
    <div class="mx-auto max-w-6xl">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h2 class="font-serif text-xl font-bold text-slate-900 sm:text-2xl">
            287(g) agencies, by program model
          </h2>
          <p class="mt-1 text-xs text-slate-500 sm:text-sm">
            Click any dot to view the agency's agreement and records.
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
              <p class="font-medium text-slate-700">No data loaded</p>
              <p class="mt-1 text-sm">Run the pipeline to generate agency data.</p>
            </div>
          </div>
        {:else}
          <NationalMap agencies={filteredAgencies} />
        {/if}
      </div>
    </div>
  </section>

  <!-- ── Support callout ──────────────────────────────────────────────────── -->
  <section class="border-b border-slate-200 bg-white px-4 py-5 sm:px-6">
    <div class="mx-auto flex max-w-6xl items-center justify-between gap-4">
      <p class="text-sm text-slate-500">
        This project is made possible by <a href="https://vsr.recoveredfactory.net/en" target="_blank" rel="noreferrer" class="font-medium text-slate-700">Recovered Factory</a>, a data journalism studio.
      </p>
      <a
        href="https://vsr.recoveredfactory.net/en"
        target="_blank"
        rel="noreferrer"
        class="shrink-0 rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 no-underline hover:border-slate-400 hover:text-slate-900 hover:no-underline"
      >
        Hire us
      </a>
    </div>
  </section>

  <!-- ── What each model authorizes ───────────────────────────────────────── -->
  <section class="border-b border-slate-200 bg-white px-4 py-10 sm:px-6 sm:py-12">
    <div class="mx-auto max-w-6xl">
      <h2 class="font-serif text-xl font-bold text-slate-900 sm:text-2xl">
        What each model authorizes
      </h2>
      <p class="mt-1.5 text-sm text-slate-500">
        The three 287(g) program models grant different scopes of authority to local officers.
        <a href="/glossary" class="underline">See the glossary</a> for key definitions.
      </p>

      <div class="mt-5 grid gap-4 sm:grid-cols-3">
        {#each ALL_MODELS as model}
          {@const desc = MODEL_DESCRIPTIONS[model]}
          <div class="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div
              class="border-b-4 px-4 py-3"
              style="background: {MODEL_COLORS[model]}18; border-bottom-color: {MODEL_COLORS[model]};"
            >
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {MODEL_SHORT[model]}
              </p>
              <h3 class="mt-0.5 text-sm font-semibold text-slate-900">{model}</h3>
            </div>
            <div class="px-4 py-4">
              <p class="text-sm font-medium leading-relaxed text-slate-800">{desc.short}</p>
              <p class="mt-2 text-xs italic leading-relaxed text-slate-400">{desc.detail}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- ── Search + filter + browse ──────────────────────────────────────────── -->
  <section class="px-4 py-10 sm:px-6 sm:py-12">
    <div class="mx-auto max-w-6xl">

      <h2 class="font-serif text-xl font-bold text-slate-900 sm:text-2xl">Search agencies</h2>

      <!-- Filter controls — sticky once scrolled into view -->
      <div
        class="sticky z-40 -mx-4 border-b border-slate-200 bg-stone-50/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
        style="top: var(--site-header-height);"
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
              placeholder="Agency name, city, or county…"
              class="w-full rounded-md border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <!-- State + model row — wraps cleanly on mobile -->
          <div class="flex flex-wrap items-center gap-2">
            <select
              bind:value={selectedState}
              class="rounded-md border border-slate-300 bg-white py-2 pl-3 pr-7 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All states</option>
              {#each allStates as state}
                <option value={state}>{STATE_NAMES[state] ?? state}</option>
              {/each}
            </select>

            {#each ALL_MODELS as model}
              {@const active = activeModels.has(model)}
              <button
                type="button"
                on:click={() => toggleModel(model)}
                class="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
                style={active
                  ? `background: ${MODEL_COLORS[model]}; border-color: ${MODEL_COLORS[model]}; color: ${model.includes("Jail") ? "#0f3020" : "#fff"};`
                  : "background: white; border-color: #cbd5e1; color: #475569;"}
              >
                <span
                  class="inline-block h-2 w-2 rounded-full"
                  style="background: {active
                    ? model.includes('Jail') ? '#0f3020' : 'rgba(255,255,255,0.5)'
                    : MODEL_COLORS[model]};"
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
          <span class="font-medium text-slate-800">{intFmt.format(filteredAgencies.length)}</span>
          of {intFmt.format(data.agencies.length)} agencies match —
          <button
            type="button"
            on:click={clearFilters}
            class="text-blue-800 underline underline-offset-2 hover:text-blue-900"
          >Clear filters</button>
        {:else}
          {intFmt.format(data.agencies.length)} agencies across {data.stateCount} states
        {/if}
      </p>

      <!-- Agency grid -->
      {#if filteredAgencies.length === 0}
        <div class="mt-5 rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
          <p class="font-medium text-slate-700">No agencies match your search.</p>
          <button
            type="button"
            on:click={clearFilters}
            class="mt-2 text-sm text-blue-800 underline underline-offset-2"
          >
            Clear filters
          </button>
        </div>
      {:else}
        <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each pageAgencies as agency (agency.slug)}
            <a
              href="/agency/{agency.slug}"
              class="group block rounded-lg border border-slate-200 bg-white p-4 no-underline hover:border-slate-300 hover:shadow-sm active:bg-slate-50"
            >
              <p class="font-semibold leading-snug text-slate-900 group-hover:text-blue-900">
                {agency.name}
              </p>
              <p class="mt-0.5 text-sm text-slate-500">
                {[agency.city, STATE_NAMES[agency.state] ?? agency.state]
                  .filter(Boolean)
                  .join(", ")}
              </p>
              <div class="mt-2 flex flex-wrap gap-1.5">
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
              Previous
            </button>

            <p class="text-sm text-slate-500">
              <span class="font-medium text-slate-800">{pageStart + 1}–{pageEnd}</span>
              of {intFmt.format(filteredAgencies.length)}
            </p>

            <button
              type="button"
              on:click={() => (currentPage = Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              class="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
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

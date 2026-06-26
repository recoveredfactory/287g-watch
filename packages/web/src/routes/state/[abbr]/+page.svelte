<script lang="ts">
  import type { PageData } from "./$types";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_DARK_COLORS, MODEL_SHORT, MODEL_MINI, MODEL_SLUG, MODEL_ORDER } from "$lib/colors";
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
  import { localizeHref, getLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import NationalMap from "$lib/components/NationalMap.svelte";
  import TrendCharts from "$lib/components/TrendCharts.svelte";
  import ModelLink from "$lib/components/ModelLink.svelte";

  export let data: PageData;

  $: ({ abbr, stateName, agencies, stateMeta, snapshotDate, modelCounts, agencyTypeCounts, trendMonths, trend } = data);

  $: newsUpdatedDate = data.news
    ? new Intl.DateTimeFormat(getLocale() === "es" ? "es-MX" : "en-US", {
        year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
      }).format(new Date(data.news.generated_at))
    : "";

  const intFmt = new Intl.NumberFormat();
  const popFmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

  // ── Filters ─────────────────────────────────────────────────────────────────
  let activeModels: Set<string> = new Set();
  let activeTypes: Set<string> = new Set();
  let moaOnly = false;
  let searchQuery = "";
  let sortCol: "name" | "type" | "signed" = "name";
  let sortDir: "asc" | "desc" = "asc";

  const SLUG_TO_MODEL = Object.fromEntries(
    Object.entries(MODEL_SLUG).map(([full, slug]) => [slug, full])
  );

  let mounted = false;

  onMount(() => {
    const params = new URLSearchParams(location.search);
    const q = params.get("q");
    const models = params.get("models");
    const types = params.get("types");
    const moa = params.get("moa");
    if (q) searchQuery = q;
    if (models) activeModels = new Set(models.split(",").map((s) => SLUG_TO_MODEL[s]).filter(Boolean));
    if (types) activeTypes = new Set(types.split(",").filter(Boolean));
    if (moa === "1") moaOnly = true;
    mounted = true;
  });

  $: if (browser && mounted) {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (activeModels.size > 0)
      params.set("models", [...activeModels].map((m) => MODEL_SLUG[m]).filter(Boolean).join(","));
    if (activeTypes.size > 0) params.set("types", [...activeTypes].join(","));
    if (moaOnly) params.set("moa", "1");
    const qs = params.toString();
    history.replaceState(history.state, "", qs ? `?${qs}` : location.pathname);
  }

  const toggleModel = (model: string) => {
    const next = new Set(activeModels);
    if (next.has(model)) next.delete(model); else next.add(model);
    activeModels = next;
  };

  const toggleType = (type: string) => {
    const next = new Set(activeTypes);
    if (next.has(type)) next.delete(type); else next.add(type);
    activeTypes = next;
  };

  const clearFilters = () => {
    searchQuery = "";
    activeModels = new Set();
    activeTypes = new Set();
    moaOnly = false;
  };

  $: hasFilters = searchQuery.trim() !== "" || activeModels.size > 0 || activeTypes.size > 0 || moaOnly;

  $: allTypes = Object.keys(agencyTypeCounts).sort((a, b) =>
    (agencyTypeCounts[b] ?? 0) - (agencyTypeCounts[a] ?? 0)
  );

  $: filteredAgencies = agencies.filter((a) => {
    const q = searchQuery.trim().toLowerCase();
    if (q && !a.name.toLowerCase().includes(q) && !(a.city ?? "").toLowerCase().includes(q) && !(a.county ?? "").toLowerCase().includes(q)) return false;
    if (activeModels.size > 0 && !a.models.some((m) => activeModels.has(m))) return false;
    if (activeTypes.size > 0 && !activeTypes.has(a.agency_type)) return false;
    if (moaOnly && !a.moa_url) return false;
    return true;
  });

  $: sortedAgencies = [...filteredAgencies].sort((a, b) => {
    let cmp = 0;
    if (sortCol === "name") cmp = a.name.localeCompare(b.name);
    else if (sortCol === "type") cmp = (a.agency_type ?? "").localeCompare(b.agency_type ?? "");
    else if (sortCol === "signed") cmp = (a.signed_date ?? "").localeCompare(b.signed_date ?? "");
    return sortDir === "asc" ? cmp : -cmp;
  });

  const setSort = (col: typeof sortCol) => {
    if (sortCol === col) sortDir = sortDir === "asc" ? "desc" : "asc";
    else { sortCol = col; sortDir = "asc"; }
  };

  const sortIcon = (col: typeof sortCol) =>
    sortCol !== col ? "↕" : sortDir === "asc" ? "↑" : "↓";

  $: selectedStates = new Set([abbr]);

  // Show trend chart when there are at least 2 trend months with non-zero data
  $: showTrend = trendMonths.length >= 2 && (() => {
    const s = trend[""];
    if (!s) return false;
    return [...s.jail, ...s.taskforce, ...s.wso].some((v) => v > 0);
  })();
</script>

<svelte:head>
  <title>{stateName} 287(g) Agencies</title>
  <meta name="description" content="{agencies.length} agencies in {stateName} participating in the 287(g) immigration enforcement program." />
</svelte:head>

<main id="main-content">

  <!-- ── Header ──────────────────────────────────────────────────────────────── -->
  <section class="border-b border-slate-200 bg-white px-4 py-8 sm:px-6 sm:py-10">
    <div class="mx-auto max-w-6xl">
      <p class="text-xs font-semibold uppercase tracking-widest text-slate-400">
        287(g) Program
      </p>
      <h1 class="mt-1 text-2xl font-black text-slate-900 sm:text-3xl">
        {stateName}
      </h1>
      <div class="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
        <span>
          <span class="font-semibold text-slate-900">{intFmt.format(agencies.length)}</span>
          {agencies.length === 1 ? "agency" : "agencies"}
        </span>
        {#each MODEL_ORDER as model}
          {#if modelCounts[model]}
            <span class="flex items-center gap-1.5">
              <span class="inline-block h-2 w-2 rounded-full" style="background: {MODEL_COLORS[model]};"></span>
              <span class="font-semibold text-slate-900">{modelCounts[model]}</span>
              {MODEL_SHORT[model]}
            </span>
          {/if}
        {/each}
        {#if stateMeta?.population_served}
          <span>
            <span class="font-semibold text-slate-900">{popFmt.format(stateMeta.population_served)}</span>
            covered
          </span>
        {/if}
      </div>
      {#if snapshotDate}
        <p class="mt-2 text-xs italic text-slate-400">
          As of {new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(snapshotDate))}
        </p>
      {/if}
    </div>
  </section>

  <!-- ── News summary ─────────────────────────────────────────────────────── -->
  {#if data.news}
    <section class="border-b border-slate-200 bg-white px-4 py-8 sm:px-6 sm:py-10">
      <div class="mx-auto max-w-3xl">
        <h2 class="font-serif text-lg font-bold text-slate-900 sm:text-xl">
          {m.news_heading({ state: stateName })}
        </h2>
        <p class="mt-1 text-xs italic text-slate-400">
          {m.news_updated({ date: newsUpdatedDate })}
        </p>
        <div class="prose-editorial news-summary mt-5">
          {@html data.news.summary_html}
        </div>
        <p class="mt-6 border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-500">
          {m.news_source_note()}
        </p>
      </div>
    </section>
  {/if}

  <!-- ── Map ──────────────────────────────────────────────────────────────── -->
  <section class="border-b border-slate-200 bg-stone-50 pt-6 sm:pt-8">
    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <h2 class="font-serif text-lg font-bold text-slate-900 sm:text-xl">Agency Locations</h2>
    </div>
    <div
      class="relative mt-3 h-[300px] overflow-hidden border-y border-slate-200 shadow-sm sm:h-[420px]"
      aria-label="Map showing 287(g) agency locations in {stateName}"
    >
      <NationalMap
        agencies={data.mapAgencies}
        terminatedAgencies={[]}
        {selectedStates}
        focusSelected
        cursorIdx={null}
      />
    </div>
  </section>

  <!-- ── Trend chart ──────────────────────────────────────────────────────── -->
  {#if showTrend}
    <TrendCharts {trendMonths} {trend} hideSelector />
  {/if}

  <!-- ── Agency list ──────────────────────────────────────────────────────── -->
  <section class="px-4 py-8 sm:px-6 sm:py-10">
    <div class="mx-auto max-w-6xl">
      <h2 class="font-serif text-lg font-bold text-slate-900 sm:text-xl">
        {stateName} Agencies
      </h2>

      <!-- Model filter pills (split-button: toggle left, ⓘ info right) -->
      <div class="mt-4 flex flex-wrap gap-2">
        {#each MODEL_ORDER as model}
          {#if modelCounts[model]}
            {@const active = activeModels.has(model)}
            <div
              class="inline-flex overflow-hidden rounded border text-xs font-semibold transition-colors"
              style={active
                ? `border-color: ${MODEL_COLORS[model]}; background: ${MODEL_COLORS[model]};`
                : `border-color: ${MODEL_COLORS[model]}88; background: ${MODEL_COLORS[model]}18;`}
            >
              <button
                type="button"
                on:click={() => toggleModel(model)}
                aria-pressed={active}
                class="px-3 py-1.5"
                style={active
                  ? `color: ${MODEL_TEXT_COLORS[model] ?? "#fff"};`
                  : `color: ${MODEL_DARK_COLORS[model] ?? "#334155"};`}
              >
                {MODEL_SHORT[model]}
                <span class="ml-1 tabular-nums opacity-70">{modelCounts[model]}</span>
              </button>
              <a
                href={localizeHref(`/model/${MODEL_SLUG[model]}`)}
                class="flex items-center border-l px-2 py-1.5 no-underline transition-opacity hover:opacity-70"
                style={active
                  ? `border-color: ${MODEL_TEXT_COLORS[model] ?? "#fff"}44; color: ${MODEL_TEXT_COLORS[model] ?? "#fff"};`
                  : `border-color: ${MODEL_COLORS[model]}44; color: ${MODEL_DARK_COLORS[model] ?? "#334155"};`}
                aria-label="Learn about {model}"
                title="Learn about {model}"
              >ⓘ</a>
            </div>
          {/if}
        {/each}
      </div>

      <!-- Agency type filters -->
      {#if allTypes.length > 1}
        <div class="mt-2 flex flex-wrap gap-2">
          {#each allTypes as type}
            <button
              type="button"
              on:click={() => toggleType(type)}
              aria-pressed={activeTypes.has(type)}
              class="rounded border px-3 py-1 text-xs transition-colors"
              class:bg-slate-800={activeTypes.has(type)}
              class:text-white={activeTypes.has(type)}
              class:border-slate-800={activeTypes.has(type)}
              class:text-slate-600={!activeTypes.has(type)}
              class:border-slate-300={!activeTypes.has(type)}
              class:hover:border-slate-500={!activeTypes.has(type)}
            >
              {type}
              <span class="ml-1 tabular-nums opacity-60">{agencyTypeCounts[type]}</span>
            </button>
          {/each}
        </div>
      {/if}

      <!-- Search + MOA toggle row -->
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <div class="relative flex-1" style="min-width: 200px; max-width: 360px;">
          <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="search"
            bind:value={searchQuery}
            placeholder="Search agencies…"
            class="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <label class="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" bind:checked={moaOnly} class="rounded" />
          MOA only
        </label>
        {#if hasFilters}
          <button
            type="button"
            on:click={clearFilters}
            class="text-sm text-slate-500 underline underline-offset-2 hover:text-slate-900"
          >Clear filters</button>
        {/if}
      </div>

      <!-- Result count -->
      <p class="mt-3 text-sm text-slate-500">
        {#if hasFilters}
          {intFmt.format(filteredAgencies.length)} of {intFmt.format(agencies.length)} agencies
        {:else}
          {intFmt.format(agencies.length)} {agencies.length === 1 ? "agency" : "agencies"}
        {/if}
      </p>

      <!-- Table -->
      {#if sortedAgencies.length === 0}
        <div class="mt-4 rounded-lg border border-slate-200 bg-white px-6 py-10 text-center">
          <p class="text-sm font-medium text-slate-700">No agencies match your filters.</p>
          <button
            type="button"
            on:click={clearFilters}
            class="mt-2 text-sm text-slate-500 underline underline-offset-2 hover:text-slate-900"
          >Clear filters</button>
        </div>
      {:else}
        <div class="mt-4 overflow-x-auto rounded-lg border border-slate-200">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-slate-200 bg-slate-50 text-left">
                <th class="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-700 sm:px-4 sm:py-3" aria-sort={sortCol === "name" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" on:click={() => setSort("name")} class="flex items-center gap-1 hover:text-slate-900">
                    Agency {sortIcon("name")}
                  </button>
                </th>
                <th class="px-2 py-2 text-xs font-bold uppercase tracking-wider text-slate-700 sm:px-3 sm:py-3" aria-sort={sortCol === "type" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" on:click={() => setSort("type")} class="flex items-center gap-1 hover:text-slate-900">
                    Type {sortIcon("type")}
                  </button>
                </th>
                <th class="px-2 py-2 text-xs font-bold uppercase tracking-wider text-slate-700 sm:px-3 sm:py-3">Models</th>
                <th class="px-2 py-2 text-xs font-bold uppercase tracking-wider text-slate-700 sm:px-3 sm:py-3" aria-sort={sortCol === "signed" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" on:click={() => setSort("signed")} class="flex items-center gap-1 hover:text-slate-900">
                    Signed {sortIcon("signed")}
                  </button>
                </th>
                <th class="hidden px-2 py-2 text-xs font-bold uppercase tracking-wider text-slate-700 sm:table-cell sm:px-3 sm:py-3">Population</th>
                <th class="px-2 py-2 text-xs font-bold uppercase tracking-wider text-slate-700 sm:px-3 sm:py-3">MOA</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              {#each sortedAgencies as agency (agency.slug)}
                <tr class="hover:bg-slate-50">
                  <td class="px-3 py-2 sm:px-4 sm:py-3">
                    <a
                      href={localizeHref(`/agency/${agency.slug}`)}
                      class="font-semibold leading-snug text-slate-900 no-underline hover:underline"
                    >{agency.name}</a>
                    {#if agency.city || agency.county}
                      <p class="text-xs text-slate-500">{[agency.city, agency.county].filter(Boolean).join(", ")}</p>
                    {/if}
                  </td>
                  <td class="px-2 py-2 text-xs text-slate-600 sm:px-3 sm:py-3">{agency.agency_type ?? "—"}</td>
                  <td class="px-2 py-2 sm:px-3 sm:py-3">
                    <div class="flex flex-wrap gap-1">
                      {#each agency.models as model}
                        <ModelLink
                          {model}
                          underline={false}
                          class="model-badge model-badge--{MODEL_SLUG[model]}"
                        ><span class="sm:hidden">{MODEL_MINI[model] ?? model}</span><span class="hidden sm:inline">{MODEL_SHORT[model] ?? model}</span></ModelLink>
                      {/each}
                    </div>
                  </td>
                  <td class="px-2 py-2 tabular-nums text-slate-600 sm:px-3 sm:py-3">
                    {agency.signed_date ? agency.signed_date.slice(0, 4) : "—"}
                  </td>
                  <td class="hidden px-2 py-2 tabular-nums text-slate-600 sm:table-cell sm:px-3 sm:py-3">
                    {agency.population ? popFmt.format(agency.population) : "—"}
                  </td>
                  <td class="px-2 py-2 sm:px-3 sm:py-3">
                    {#if agency.moa_url}
                      <a href={agency.moa_url} target="_blank" rel="noreferrer" class="text-xs font-semibold no-underline hover:underline">↗</a>
                    {:else}
                      <span class="text-slate-300 text-xs">—</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </section>

</main>

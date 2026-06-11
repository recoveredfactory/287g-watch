<script lang="ts">
  import type { StatePageData } from "./+page.server";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_DARK_COLORS, MODEL_SHORT, MODEL_MINI, MODEL_SLUG, MODEL_ORDER } from "$lib/colors";
  import NationalMap from "$lib/components/NationalMap.svelte";
  import MapTimelineScrubber from "$lib/components/MapTimelineScrubber.svelte";
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
  import { tweened } from "svelte/motion";
  import { cubicOut } from "svelte/easing";
  import { localizeHref } from "$lib/paraglide/runtime";
  import TrendCharts from "$lib/components/TrendCharts.svelte";

  export let data: StatePageData;

  const { abbr, stateName, agencies, stateMeta, snapshotDate, modelCounts, agencyTypeCounts } = data;

  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? "https://287g.recoveredfactory.net";
  const title = `287(g) in ${stateName} — 287(g) Explorer`;
  const description = agencies.length === 1
    ? `1 local law enforcement agency in ${stateName} has a 287(g) agreement with ICE.`
    : `${agencies.length} local law enforcement agencies in ${stateName} have 287(g) agreements with ICE.`;
  const canonicalUrl = `${siteUrl}/state/${abbr.toLowerCase()}`;

  const intFmt = new Intl.NumberFormat();
  const popFmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  const popFmtOverlay = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 0 });
  const dateFmt = snapshotDate
    ? new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(snapshotDate))
    : null;
  const signedFmt = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", timeZone: "UTC" });

  const totalPop = agencies.reduce((s, a) => s + (a.population ?? 0), 0);

  // ── Timeline ────────────────────────────────────────────────────────────────
  const TIMELINE_EPOCH_YEAR = 2025;
  const BASELINE_IDX = -10000;
  const signedIdx = (d: string | null | undefined): number => {
    if (!d || d.length < 10) return BASELINE_IDX;
    const y = Number(d.slice(0, 4));
    const mo = Number(d.slice(5, 7));
    const day = Number(d.slice(8, 10));
    if (y < TIMELINE_EPOCH_YEAR) return BASELINE_IDX;
    return (y - TIMELINE_EPOCH_YEAR) * 12 + (mo - 1) + (day - 1) / 31;
  };

  $: signedIndices = agencies.map((a) => signedIdx(a.signed_date));
  $: agencyPops = agencies.map((a) => a.population ?? 0);

  const today = new Date();
  const todayIdx =
    (today.getUTCFullYear() - TIMELINE_EPOCH_YEAR) * 12 +
    today.getUTCMonth() +
    (today.getUTCDate() - 1) / 31;
  const minIdx = 0;
  $: maxIdx = Math.max(todayIdx, ...signedIndices.filter((i) => i > BASELINE_IDX)) + 0.5;

  let cursorIdx = NaN;
  $: if (Number.isNaN(cursorIdx) && Number.isFinite(maxIdx)) cursorIdx = maxIdx;
  $: countAtCursor = signedIndices.filter((i) => i <= cursorIdx).length;
  $: popAtCursor = signedIndices.reduce((sum, idx, i) => (idx <= cursorIdx ? sum + agencyPops[i] : sum), 0);

  let timelinePlaying = false;
  const displayedCount = tweened(0, { duration: 280, easing: cubicOut });
  const displayedPop = tweened(0, { duration: 280, easing: cubicOut });
  $: displayedCount.set(countAtCursor);
  $: displayedPop.set(popAtCursor);

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

  const selectedStates = new Set([abbr]);

  // ── Table filter + sort ─────────────────────────────────────────────────────
  type SortCol = "name" | "signed" | "population";
  let sortCol: SortCol = "signed";
  let sortDir: 1 | -1 = -1;
  let searchQuery = "";
  let activeModels = new Set<string>();
  let activeTypes = new Set<string>();
  let moaOnly = false;

  // Short URL keys for model names
  const MODEL_URL_KEY: Record<string, string> = {
    "Jail Enforcement Model": "jail",
    "Task Force Model": "tf",
    "Warrant Service Officer": "wso",
  };
  const URL_KEY_MODEL: Record<string, string> = Object.fromEntries(
    Object.entries(MODEL_URL_KEY).map(([k, v]) => [v, k])
  );

  // Read initial filter state from URL params on mount
  let mounted = false;
  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q"); if (q) searchQuery = q;
    const mp = params.get("model");
    if (mp) activeModels = new Set(mp.split(",").map(k => URL_KEY_MODEL[k]).filter(Boolean));
    const tp = params.get("type");
    if (tp) activeTypes = new Set(tp.split(","));
    if (params.get("moa") === "1") moaOnly = true;
    const sp = params.get("sort") as SortCol | null;
    if (sp && ["name", "signed", "population"].includes(sp)) sortCol = sp;
    if (params.get("dir") === "asc") sortDir = 1;
    mounted = true;
  });

  // Sync filter state back to URL (replaces history entry, no navigation)
  $: if (browser && mounted) {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (activeModels.size > 0) params.set("model", [...activeModels].map(m => MODEL_URL_KEY[m] ?? m).join(","));
    if (activeTypes.size > 0) params.set("type", [...activeTypes].join(","));
    if (moaOnly) params.set("moa", "1");
    if (sortCol !== "signed") params.set("sort", sortCol);
    if (sortDir === 1) params.set("dir", "asc");
    const qs = params.toString();
    history.replaceState({}, "", window.location.pathname + (qs ? "?" + qs : ""));
  }

  function setSort(col: SortCol) {
    if (sortCol === col) sortDir = sortDir === 1 ? -1 : 1;
    else { sortCol = col; sortDir = col === "name" ? 1 : -1; }
  }

  function toggleModel(model: string) {
    const next = new Set(activeModels);
    if (next.has(model)) next.delete(model); else next.add(model);
    activeModels = next;
  }

  function toggleType(type: string) {
    const next = new Set(activeTypes);
    if (next.has(type)) next.delete(type); else next.add(type);
    activeTypes = next;
  }

  function clearFilters() {
    searchQuery = "";
    activeModels = new Set();
    activeTypes = new Set();
    moaOnly = false;
  }

  $: hasFilters = searchQuery.trim() !== "" || activeModels.size > 0 || activeTypes.size > 0 || moaOnly;

  $: filteredAgencies = agencies.filter(a => {
    if (searchQuery.trim() && !a.name.toLowerCase().includes(searchQuery.toLowerCase().trim())) return false;
    if (activeModels.size > 0 && !a.models.some(m => activeModels.has(m))) return false;
    if (activeTypes.size > 0 && !activeTypes.has(a.agency_type)) return false;
    if (moaOnly && !a.moa_url) return false;
    return true;
  });

  $: sortedAgencies = [...filteredAgencies].sort((a, b) => {
    if (sortCol === "name") return sortDir * a.name.localeCompare(b.name);
    if (sortCol === "signed") return sortDir * ((a.signed_date ?? "").localeCompare(b.signed_date ?? ""));
    if (sortCol === "population") return sortDir * ((a.population ?? 0) - (b.population ?? 0));
    return 0;
  });

  const sortArrow = (col: SortCol) => sortCol === col ? (sortDir === 1 ? " ↑" : " ↓") : "";

  const formatSigned = (d: string | undefined) => {
    if (!d || d.length < 7) return "—";
    try {
      return signedFmt.format(new Date(d + "T12:00:00Z"));
    } catch { return d.slice(0, 7); }
  };
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={canonicalUrl} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={canonicalUrl} />
</svelte:head>

<main id="main-content">

  <!-- Header -->
  <div class="mx-auto max-w-4xl px-4 pt-8 pb-6 sm:px-6 sm:pt-12 sm:pb-8">
    <nav class="text-sm text-slate-500" aria-label="Breadcrumb">
      <a href={localizeHref("/")} class="no-underline hover:underline">Home</a>
      <span class="mx-1.5">›</span>
      <span>{stateName}</span>
    </nav>

    <div class="mt-4">
      <p class="text-xs font-semibold uppercase tracking-widest text-slate-400">287(g) Participation</p>
      <h1 class="mt-1 text-3xl font-black leading-tight text-slate-900 sm:text-4xl">
        {stateName}
      </h1>
      {#if dateFmt}
        <p class="mt-1 text-sm italic text-slate-400">as of {dateFmt}</p>
      {/if}
    </div>

    <!-- Stats row -->
    <div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div class="text-2xl font-black tabular-nums text-slate-900">{intFmt.format(agencies.length)}</div>
        <div class="mt-0.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Participating agencies</div>
      </div>
      {#if stateMeta}
        <div class="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div class="text-2xl font-black tabular-nums text-slate-900">{Math.round(stateMeta.pct * 100)}%</div>
          <div class="mt-0.5 text-xs font-semibold uppercase tracking-wider text-slate-500">of state LE agencies</div>
        </div>
      {/if}
      {#if totalPop > 0}
        <div class="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div class="text-2xl font-black tabular-nums text-slate-900">{popFmt.format(totalPop)}</div>
          <div class="mt-0.5 text-xs font-semibold uppercase tracking-wider text-slate-500">Population covered</div>
        </div>
      {/if}
      {#if stateMeta?.state_local_population}
        <div class="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div class="text-2xl font-black tabular-nums text-slate-900">
            {Math.round((totalPop / stateMeta.state_local_population) * 100)}%
          </div>
          <div class="mt-0.5 text-xs font-semibold uppercase tracking-wider text-slate-500">of state population</div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Map: full-bleed -->
  <div
    class="relative h-[320px] overflow-hidden border-y border-slate-200 shadow-sm sm:h-[460px]"
    aria-label="Map showing 287(g) agency locations in {stateName}"
  >
    <NationalMap
      {agencies}
      {selectedStates}
      {cursorIdx}
    />
    {#if showCountOverlay}
      <div class="pointer-events-none absolute inset-x-0 top-2 flex justify-center sm:top-4" aria-hidden="true">
        <div class="flex items-center gap-4 rounded-xl bg-white/90 px-5 py-2.5 shadow-md backdrop-blur">
          <div class="text-center">
            <div class="text-xl font-black tabular-nums text-slate-900">{intFmt.format(Math.round($displayedCount))}</div>
            <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">agencies</div>
          </div>
          {#if totalPop > 0}
            <div class="h-8 w-px bg-slate-200" aria-hidden="true"></div>
            <div class="text-center">
              <div class="text-xl font-black tabular-nums text-slate-900">{popFmtOverlay.format(Math.max(0, $displayedPop))}</div>
              <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Pop. covered</div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
  {#if signedIndices.length > 0 && Number.isFinite(maxIdx)}
    <div class="border-b border-slate-200 bg-white">
      <div class="mx-auto max-w-6xl">
        <MapTimelineScrubber {minIdx} {maxIdx} labelMaxIdx={todayIdx} bind:cursorIdx bind:playing={timelinePlaying} {countAtCursor} />
      </div>
    </div>
  {/if}

  <!-- Trend chart -->
  {#if data.timeline.length > 1}
    <section class="border-b border-slate-200 px-4 py-8 sm:px-6 sm:py-10">
      <div class="mx-auto max-w-4xl">
        <h2 class="font-serif text-xl font-bold text-slate-900">Participation over time</h2>
        <p class="mt-1 text-sm text-slate-500">
          Agencies in the 287(g) program in {stateName}, by agreement type
        </p>
        <div class="mt-5">
          <TrendCharts timeline={data.timeline} />
        </div>
      </div>
    </section>
  {/if}

  <!-- Model breakdown + table -->
  <div class="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">

    <!-- Agreement types + filter controls -->
    <section>
      <h2 class="font-serif text-xl font-bold text-slate-900">Agreement types</h2>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        {#each MODEL_ORDER as model}
          {#if modelCounts[model]}
            {@const active = activeModels.has(model)}
            <div class="flex items-center">
              <button
                type="button"
                aria-pressed={active}
                on:click={() => toggleModel(model)}
                class="rounded-l border px-3 py-1.5 text-xs font-semibold transition-colors"
                style={active
                  ? `background: ${MODEL_COLORS[model]}; border-color: ${MODEL_COLORS[model]}; color: ${MODEL_TEXT_COLORS[model] ?? '#fff'};`
                  : `background: ${MODEL_COLORS[model]}22; border-color: ${MODEL_COLORS[model]}88; color: ${MODEL_DARK_COLORS[model]};`}
              >{MODEL_SHORT[model]} · {intFmt.format(modelCounts[model])}</button>
              <a
                href={localizeHref(`/model/${MODEL_SLUG[model]}`)}
                aria-label="About {MODEL_SHORT[model]}"
                class="rounded-r border-y border-r px-2 py-1.5 text-xs font-semibold no-underline transition-colors hover:opacity-80"
                style={active
                  ? `background: ${MODEL_COLORS[model]}dd; border-color: ${MODEL_COLORS[model]}; color: ${MODEL_TEXT_COLORS[model] ?? '#fff'};`
                  : `background: ${MODEL_COLORS[model]}15; border-color: ${MODEL_COLORS[model]}88; color: ${MODEL_DARK_COLORS[model]};`}
              >→</a>
            </div>
          {/if}
        {/each}
      </div>
    </section>

    <!-- Agencies table -->
    <section class="mt-10">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="font-serif text-xl font-bold text-slate-900">
          Participating agencies
          {#if hasFilters}
            <span class="ml-1 font-sans text-base font-normal text-slate-400">({intFmt.format(sortedAgencies.length)} of {intFmt.format(agencies.length)})</span>
          {:else}
            <span class="ml-1 font-sans text-base font-normal text-slate-400">({intFmt.format(agencies.length)})</span>
          {/if}
        </h2>
        {#if hasFilters}
          <button type="button" on:click={clearFilters} class="text-xs font-semibold text-slate-500 hover:text-slate-800 underline underline-offset-2">Clear filters</button>
        {/if}
      </div>

      <!-- Search + type + MOA filters -->
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search agencies…"
          aria-label="Search agencies"
          bind:value={searchQuery}
          class="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none sm:w-56"
        />
        {#each Object.entries(agencyTypeCounts).sort((a, b) => b[1] - a[1]) as [type, n]}
          {@const typeActive = activeTypes.has(type)}
          <button
            type="button"
            aria-pressed={typeActive}
            on:click={() => toggleType(type)}
            class="rounded border px-3 py-1.5 text-xs font-semibold transition-colors"
            class:bg-slate-700={typeActive}
            class:border-slate-700={typeActive}
            class:text-white={typeActive}
            class:bg-slate-100={!typeActive}
            class:border-slate-300={!typeActive}
            class:text-slate-600={!typeActive}
          >{type} · {n}</button>
        {/each}
        <button
          type="button"
          aria-pressed={moaOnly}
          on:click={() => (moaOnly = !moaOnly)}
          class="rounded border px-3 py-1.5 text-xs font-semibold transition-colors"
          class:bg-slate-700={moaOnly}
          class:border-slate-700={moaOnly}
          class:text-white={moaOnly}
          class:bg-slate-100={!moaOnly}
          class:border-slate-300={!moaOnly}
          class:text-slate-600={!moaOnly}
        >Has MOA</button>
      </div>

      <div class="mt-3 overflow-x-auto rounded-lg border border-slate-200">
        <table class="w-full min-w-[340px] text-sm">
          <thead>
            <tr class="border-b border-slate-200 bg-slate-50">
              <th class="px-4 py-3 text-left" aria-sort={sortCol === "name" ? (sortDir === 1 ? "ascending" : "descending") : "none"}>
                <button
                  type="button"
                  class="font-bold text-slate-700 hover:text-slate-900"
                  on:click={() => setSort("name")}
                >Agency{sortArrow("name")}</button>
              </th>
              <th class="hidden px-4 py-3 text-left font-bold text-slate-700 sm:table-cell">Type</th>
              <th class="px-4 py-3 text-left font-bold text-slate-700">Model</th>
              <th class="px-4 py-3 text-left" aria-sort={sortCol === "signed" ? (sortDir === 1 ? "ascending" : "descending") : "none"}>
                <button
                  type="button"
                  class="font-bold text-slate-700 hover:text-slate-900"
                  on:click={() => setSort("signed")}
                >Signed{sortArrow("signed")}</button>
              </th>
              <th class="hidden px-4 py-3 text-right sm:table-cell" aria-sort={sortCol === "population" ? (sortDir === 1 ? "ascending" : "descending") : "none"}>
                <button
                  type="button"
                  class="font-bold text-slate-700 hover:text-slate-900"
                  on:click={() => setSort("population")}
                >Population{sortArrow("population")}</button>
              </th>
              <th class="hidden px-4 py-3 text-center font-bold text-slate-700 sm:table-cell">MOA</th>
            </tr>
          </thead>
          <tbody>
            {#each sortedAgencies as agency}
              <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                <td class="px-4 py-3">
                  <a
                    href={localizeHref(`/agency/${agency.slug}`)}
                    class="font-semibold text-slate-900 no-underline hover:underline"
                  >{agency.name}</a>
                  {#if agency.city}
                    <div class="text-xs text-slate-500">{agency.city}</div>
                  {/if}
                </td>
                <td class="hidden px-4 py-3 text-xs text-slate-500 sm:table-cell">{agency.agency_type ?? "—"}</td>
                <td class="px-4 py-3">
                  <div class="flex flex-wrap gap-1">
                    {#each agency.models as model}
                      <span
                        class="rounded px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide"
                        style="background: {MODEL_COLORS[model] ?? '#e2e8f0'}; color: {MODEL_TEXT_COLORS[model] ?? '#0f172a'};"
                      >{MODEL_MINI[model] ?? model}</span>
                    {/each}
                  </div>
                </td>
                <td class="px-4 py-3 text-slate-600">{formatSigned(agency.signed_date)}</td>
                <td class="hidden px-4 py-3 text-right tabular-nums text-slate-600 sm:table-cell">
                  {agency.population ? intFmt.format(agency.population) : "—"}
                </td>
                <td class="hidden px-4 py-3 text-center sm:table-cell">
                  {#if agency.moa_url}
                    <a
                      href={agency.moa_url}
                      target="_blank"
                      rel="noreferrer"
                      class="text-xs font-semibold text-slate-500 no-underline hover:text-slate-900"
                      aria-label="View MOA for {agency.name}"
                    >PDF →</a>
                  {:else}
                    <span class="text-xs text-slate-300">—</span>
                  {/if}
                </td>
              </tr>
            {/each}
            {#if sortedAgencies.length === 0}
              <tr>
                <td colspan="6" class="px-4 py-8 text-center text-sm text-slate-400">
                  No agencies match your filters.
                  <button type="button" on:click={clearFilters} class="ml-1 underline underline-offset-2 hover:text-slate-600">Clear</button>
                </td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>
    </section>

  </div>
</main>


<script lang="ts">
  import type { PageData } from "./$types";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_DARK_COLORS, MODEL_SHORT, MODEL_MINI, MODEL_SLUG, MODEL_ORDER } from "$lib/colors";
  import { browser } from "$app/environment";
  import { onMount, tick } from "svelte";
  import { localizeHref, getLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import NationalMap from "$lib/components/NationalMap.svelte";
  import ExpandableMapFrame from "$lib/components/ExpandableMapFrame.svelte";
  import TrendCharts from "$lib/components/TrendCharts.svelte";
  import ModelLink from "$lib/components/ModelLink.svelte";
  import NewsAiWarning from "$lib/components/NewsAiWarning.svelte";
  import LegislationBadge from "$lib/components/LegislationBadge.svelte";
  import { SHOW_LEGISLATION_STANCE } from "$lib/features";
  import { ogImage } from "$lib/ogImage";

  export let data: PageData;

  $: ({ abbr, stateName, agencyCountRank, agencyCountRankTotal, agencies, stateMeta, snapshotDate, modelCounts, agencyTypeCounts, trendMonths, trend } = data);

  // Shared by <title>/description and the og:/twitter: tags so a share preview
  // can never drift from the page itself.
  $: metaTitle = m.state_meta_title({ state: stateName });
  $: metaDescription = m.state_meta_description({ count: agencies.length, state: stateName });

  // "% of local LE agencies" (FBI LEE County+City; state police excluded both
  // sides). Rounded whole percent, but a participating state that rounds to 0
  // shows "<1" so a card never reads "1 agency · 0%". Null when no LEE denom.
  $: localLePct =
    stateMeta && stateMeta.local_le_agencies
      ? stateMeta.participating > 0 && Math.round(stateMeta.pct * 100) === 0
        ? "<1"
        : String(Math.round(stateMeta.pct * 100))
      : null;

  const localeTag = getLocale() === "es" ? "es-MX" : "en-US";
  const intFmt = new Intl.NumberFormat(localeTag);
  const popFmt = new Intl.NumberFormat(localeTag, { notation: "compact", maximumFractionDigits: 1 });
  const dateFmt = new Intl.DateTimeFormat(localeTag, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

  // The real last-built time from the program (built_at); server already falls it
  // back to the local write stamp when an older cached response lacks it.
  $: newsUpdatedDate = data.news ? dateFmt.format(new Date(data.news.built_at)) : "";

  // The TL;DR is always shown; one "show more" toggle unfurls BOTH the full
  // narrative body and the source-article table, and a single "show less" at the
  // foot collapses them (the fixed-height table keeps the expanded block from
  // running too long). Collapsing from the foot scrolls the section back up.
  let newsExpanded = false;
  let newsSection: HTMLElement;
  $: newsCanExpand = Boolean(data.news?.body_html || data.news?.articles?.length);
  async function collapseNews() {
    newsExpanded = false;
    await tick();
    newsSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Server ships the relevant article rows already shaped (cleaned title + link,
  // publication, date, agencies, counties) and sorted newest-first. The program's
  // Date is an RSS string ("Thu, 02 Apr 2026 07:00:00 GMT"); render it as a locale
  // month-day-year, falling back to the raw value if unparseable.
  const fmtArticleDate = (raw: string) => {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? raw : dateFmt.format(d);
  };

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

    // Deep-link to the story summary: open the full body and scroll to it when the
    // URL targets the section (#news or the friendlier #summary). Scroll after a
    // tick so the just-expanded body is laid out first. No-op where a state has no
    // news (section unrendered → newsSection undefined).
    const hash = location.hash.slice(1);
    if (hash === "news" || hash === "summary") {
      newsExpanded = true;
      tick().then(() =>
        newsSection?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }

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
  <title>{metaTitle}</title>
  <meta name="description" content={metaDescription} />
  <meta property="og:title" content={metaTitle} />
  <meta property="og:description" content={metaDescription} />
  <!-- Generic card for now; per-state artwork is #265. -->
  <meta property="og:image" content={ogImage("states.png")} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:image" content={ogImage("states.png")} />
</svelte:head>

<main id="main-content" class="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">

  <!-- ── Header ──────────────────────────────────────────────────────────────── -->
  <header>
    <p class="text-xs font-semibold uppercase tracking-widest text-ink-500">
      {m.state_eyebrow()}
    </p>
    <h1 class="mt-1 text-2xl font-black text-ink-900 sm:text-3xl">
      {stateName}
    </h1>
    <div class="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-700">
      {#if SHOW_LEGISLATION_STANCE && data.news?.legislation}
        <LegislationBadge legislation={data.news.legislation} />
      {/if}
      <span>
        <span class="font-semibold text-ink-900">{intFmt.format(agencies.length)}</span>
        {agencies.length === 1 ? m.state_agency_one() : m.state_agency_other()}
        {#if agencyCountRank > 0}
          <span class="font-mono text-xs text-ink-500">{m.state_rank_of({ rank: agencyCountRank, total: agencyCountRankTotal })}</span>
        {/if}
      </span>
      {#if localLePct !== null}
        <span>
          <span class="font-semibold text-ink-900">{localLePct}%</span>
          {m.state_local_le_pct()}
        </span>
      {/if}
      {#each MODEL_ORDER as model}
        {#if modelCounts[model]}
          <span class="flex items-center gap-1.5">
            <span class="inline-block h-2 w-2 rounded-full" style="background: {MODEL_COLORS[model]};"></span>
            <span class="font-semibold text-ink-900">{modelCounts[model]}</span>
            {MODEL_SHORT[model]}
          </span>
        {/if}
      {/each}
      {#if stateMeta?.population_served}
        <span>
          <span class="font-semibold text-ink-900">{popFmt.format(stateMeta.population_served)}</span>
          {m.state_covered()}
        </span>
      {/if}
    </div>
    <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      {#if snapshotDate}
        <p class="text-xs italic text-ink-500">
          {m.state_as_of({ date: dateFmt.format(new Date(snapshotDate)) })}
        </p>
      {/if}
      <a
        href={localizeHref(`/states?sel=state:${abbr}`)}
        class="text-xs font-semibold text-ink-900 underline underline-offset-2 hover:text-ink-700"
      >{m.state_compare_cta()} →</a>
    </div>
  </header>

  <!-- ── Map ──────────────────────────────────────────────────────────────── -->
  <section class="mt-8">
    <h2 class="font-serif text-lg font-bold text-ink-900 sm:text-xl">{m.state_map_heading()}</h2>
    <div class="relative mt-3">
      <ExpandableMapFrame ariaLabel={m.state_map_aria({ state: stateName })}>
        <NationalMap
          agencies={data.mapAgencies}
          terminatedAgencies={[]}
          {selectedStates}
          focusSelected
          focusPadding={24}
          focusMaxZoom={7}
          cursorIdx={null}
        />
      </ExpandableMapFrame>
    </div>
  </section>

  <!-- ── Trend chart ──────────────────────────────────────────────────────── -->
  {#if showTrend}
    <section class="mt-10">
      <TrendCharts {trendMonths} {trend} hideSelector embedded />
    </section>
  {/if}

  <!-- ── News summary ─────────────────────────────────────────────────────── -->
  {#if data.news}
    <section id="news" class="mt-10" bind:this={newsSection}>
      <h2 class="font-serif text-lg font-bold text-ink-900 sm:text-xl">
        {m.news_heading({ state: stateName })}
      </h2>

      <!-- Real last-built date, ahead of the summary (the stance pill rides up in
           the header's topline figures). -->
      <!-- Just the date — the PromptQL credit lives in the warning right below. -->
      <p class="mt-1.5 text-xs italic text-ink-500">
        {m.news_updated({ date: newsUpdatedDate })}
      </p>

      <!-- Small hallucination caution, directly above the AI-written summary.
           Full width of the news section (not clamped to the reading measure). -->
      <div class="mt-4">
        <NewsAiWarning />
      </div>

      <!-- TL;DR lead — a narrow reading measure (max-w-prose), set apart from the
           full-width map/chart above it. Tapping it toggles the full summary
           open/closed (same convenience as the states-index cards); the toggle
           button below stays the keyboard/AT path, and clicks on links and
           active text selections pass through. -->
      <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
      <div
        class="news-prose news-tldr mt-5 max-w-prose {newsCanExpand ? 'cursor-pointer' : ''}"
        on:click={(e) => {
          if (!newsCanExpand) return;
          if (e.target instanceof Element && e.target.closest("a, button")) return;
          if (window.getSelection()?.toString()) return;
          newsExpanded = !newsExpanded;
        }}
      >
        {@html data.news.tldr_html}
      </div>

      {#if data.news.body_html || data.news.articles?.length}
        <!-- One trigger unfurls BOTH the full narrative and the source-article
             table. Anchored under the TL;DR; centered pill flanked by hairline
             rules. Default collapsed → only the TL;DR shows. -->
        <div class="news-toggle-row mt-4">
          <span class="news-rule" aria-hidden="true"></span>
          <button
            type="button"
            class="news-toggle"
            on:click={() => (newsExpanded = !newsExpanded)}
            aria-expanded={newsExpanded}
            aria-controls="news-expand"
          >
            {newsExpanded ? m.news_show_less() : m.news_show_more()}
            <span class="news-chev" class:rotate-180={newsExpanded} aria-hidden="true">▾</span>
          </button>
          <span class="news-rule" aria-hidden="true"></span>
        </div>

        {#if newsExpanded}
          <div id="news-expand">
            {#if data.news.body_html}
              <div class="news-prose news-body mt-5 max-w-prose">
                {@html data.news.body_html}
              </div>
            {/if}

            {#if data.news.articles?.length}
              <!-- Source-article list: fixed-height scroll, sticky header, newest
                   first (sorted server-side). Title links out (a gnews redirect
                   unless it resolved); Link/Relevant/Found-Via columns dropped.
                   Table at md:+; below that, one citation card per article —
                   this data is citation-shaped (title/byline/tags), not
                   agency-row-shaped, so it gets its own bespoke card rather
                   than reusing the agency table's card layout. -->
              <div
                id="news-articles"
                class="news-articles mt-6 hidden max-h-[28rem] overflow-auto rounded-lg border md:block"
                style="border-color: var(--color-paper-200);"
              >
                <table class="news-articles-table">
                  <thead>
                    <tr>
                      <th>{m.news_col_title()}</th>
                      <th>{m.news_col_publication()}</th>
                      <th>{m.news_col_date()}</th>
                      <th>{m.news_col_agencies()}</th>
                      <th>{m.news_col_counties()}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each data.news.articles as a}
                      <tr>
                        <td>
                          {#if a.url}
                            <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a>
                          {:else}
                            {a.title}
                          {/if}
                        </td>
                        <td>{a.publication}</td>
                        <td class="whitespace-nowrap tabular-nums">{fmtArticleDate(a.date)}</td>
                        <td>{#each a.agencies as ag, i}{#if i > 0}, {/if}{#if ag.slug}<a href={localizeHref(`/agency/${ag.slug}`)}>{ag.name}</a>{:else}{ag.name}{/if}{/each}</td>
                        <td>{a.counties}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>

              <div class="mt-6 grid max-h-[28rem] gap-2.5 overflow-auto md:hidden">
                {#each data.news.articles as a}
                  <div class="rounded-lg border p-3 text-xs" style="border-color: var(--color-paper-200); background: var(--color-paper-50);">
                    <p class="text-sm font-medium leading-snug">
                      {#if a.url}
                        <a href={a.url} target="_blank" rel="noopener noreferrer" class="underline underline-offset-2" style="color: var(--color-ink-900); text-decoration-color: var(--color-ink-500);">{a.title}</a>
                      {:else}
                        <span style="color: var(--color-ink-900);">{a.title}</span>
                      {/if}
                    </p>
                    <p class="mt-1" style="color: var(--color-ink-500);">
                      {a.publication}<span class="mx-1">·</span>{fmtArticleDate(a.date)}
                    </p>
                    {#if a.agencies?.length || a.counties}
                      <p class="mt-1.5" style="color: var(--color-ink-700);">
                        {#if a.agencies?.length}{#each a.agencies as ag, i}{#if i > 0}, {/if}{#if ag.slug}<a href={localizeHref(`/agency/${ag.slug}`)} class="underline underline-offset-2" style="text-decoration-color: var(--color-ink-500);">{ag.name}</a>{:else}{ag.name}{/if}{/each}{/if}
                        {#if a.agencies?.length && a.counties} · {/if}
                        {a.counties ?? ""}
                      </p>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <!-- Single collapse at the foot of the expanded block. -->
          <div class="news-toggle-row mt-6">
            <span class="news-rule" aria-hidden="true"></span>
            <button type="button" class="news-toggle" on:click={collapseNews}>
              {m.news_show_less()}
              <span class="news-chev rotate-180" aria-hidden="true">▾</span>
            </button>
            <span class="news-rule" aria-hidden="true"></span>
          </div>
        {/if}
      {/if}

      <!-- Reuse license for the summary prose: CC BY 4.0. Always visible (even in
           the collapsed TL;DR view) so the terms travel with the summary. Covers
           our prose, not the cited third-party articles. -->
      <p class="mt-6 max-w-prose text-xs italic text-ink-500">
        {m.news_license_prefix()}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="license noopener noreferrer"
          class="font-semibold underline decoration-paper-200 underline-offset-2 hover:text-ink-700 hover:decoration-ink-500"
        >{m.news_license_link()}</a>
        {m.news_license_suffix()}
      </p>
    </section>
  {/if}

  <!-- ── Agency list ──────────────────────────────────────────────────────── -->
  <section id="agencies" class="mt-10 scroll-mt-24">
    <div>
      <h2 class="font-serif text-lg font-bold text-ink-900 sm:text-xl">
        {m.state_agencies_heading({ state: stateName })}
      </h2>

      {#if agencies.length}
      <!-- Model filter pills -->
      <div class="mt-4 flex flex-wrap gap-2">
        {#each MODEL_ORDER as model}
          {#if modelCounts[model]}
            {@const active = activeModels.has(model)}
            <button
              type="button"
              on:click={() => toggleModel(model)}
              aria-pressed={active}
              class="rounded border px-3 py-1.5 text-xs font-semibold transition-colors"
              style={active
                ? `background: ${MODEL_COLORS[model]}; border-color: ${MODEL_COLORS[model]}; color: ${MODEL_TEXT_COLORS[model] ?? "var(--color-ink-900)"};`
                : `background: ${MODEL_COLORS[model]}22; border-color: ${MODEL_COLORS[model]}88; color: ${MODEL_DARK_COLORS[model] ?? "var(--color-ink-700)"};`}
            >
              {MODEL_SHORT[model]}
              <span class="ml-1 tabular-nums opacity-70">{modelCounts[model]}</span>
            </button>
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
              class:bg-ink-900={activeTypes.has(type)}
              class:text-white={activeTypes.has(type)}
              class:border-ink-900={activeTypes.has(type)}
              class:text-ink-700={!activeTypes.has(type)}
              class:border-paper-200={!activeTypes.has(type)}
              class:hover:border-ink-500={!activeTypes.has(type)}
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
          <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="search"
            bind:value={searchQuery}
            placeholder={m.state_search_placeholder()}
            class="w-full rounded-md border border-paper-200 bg-paper-50 py-2 pl-9 pr-3 text-sm text-ink-900 placeholder:text-ink-500 focus:border-ink-700 focus:outline-none focus:ring-1 focus:ring-ink-700"
          />
        </div>
        <label class="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" bind:checked={moaOnly} class="rounded" />
          {m.state_moa_only()}
        </label>
        {#if hasFilters}
          <button
            type="button"
            on:click={clearFilters}
            class="text-sm text-ink-500 underline underline-offset-2 hover:text-ink-900"
          >{m.home_search_clear_filters()}</button>
        {/if}
      </div>

      <!-- Result count -->
      <p class="mt-3 text-sm text-ink-500">
        {#if hasFilters}
          {m.state_result_count({ filtered: intFmt.format(filteredAgencies.length), total: intFmt.format(agencies.length) })}
        {:else}
          {intFmt.format(agencies.length)} {agencies.length === 1 ? m.state_agency_one() : m.state_agency_other()}
        {/if}
      </p>

      <!-- Table -->
      {#if sortedAgencies.length === 0}
        <div class="mt-4 rounded-lg border border-paper-200 bg-paper-50 px-6 py-10 text-center">
          <p class="text-sm font-medium text-ink-700">{m.state_no_match()}</p>
          <button
            type="button"
            on:click={clearFilters}
            class="mt-2 text-sm text-ink-500 underline underline-offset-2 hover:text-ink-900"
          >{m.home_search_clear_filters()}</button>
        </div>
      {:else}
        <!-- Table at md:+ (768px); below that, one card per agency (§ mobile
             card fallback — kept as bespoke markup rather than routed through
             ResponsiveDataTable, since that component pulls in virtualization
             via svelte-virtuallists, which isn't warranted for a per-state
             list — most states are well under a hundred agencies, and a fixed-
             height virtualized scroll box would be worse UX here than the
             page just flowing naturally). Sort-by-column only applies to the
             table (card mode has no header row to click); both views read
             from the same sortedAgencies array, so a sort chosen at md:+
             carries over if the viewport narrows. -->
        <div class="mt-4 hidden overflow-x-auto rounded-lg border md:block" style="border-color: var(--color-paper-200);">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b text-left" style="border-color: var(--color-paper-200); background: var(--color-paper-100);">
                <th class="px-3 py-2 text-xs font-bold uppercase tracking-wider sm:px-4 sm:py-3" style="color: var(--color-ink-700);" aria-sort={sortCol === "name" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" on:click={() => setSort("name")} class="flex items-center gap-1 hover:text-ink-900">
                    {m.state_th_agency()} {sortIcon("name")}
                  </button>
                </th>
                <th class="px-2 py-2 text-xs font-bold uppercase tracking-wider sm:px-3 sm:py-3" style="color: var(--color-ink-700);" aria-sort={sortCol === "type" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" on:click={() => setSort("type")} class="flex items-center gap-1 hover:text-ink-900">
                    {m.state_th_type()} {sortIcon("type")}
                  </button>
                </th>
                <th class="px-2 py-2 text-xs font-bold uppercase tracking-wider sm:px-3 sm:py-3" style="color: var(--color-ink-700);">{m.state_th_models()}</th>
                <th class="px-2 py-2 text-xs font-bold uppercase tracking-wider sm:px-3 sm:py-3" style="color: var(--color-ink-700);" aria-sort={sortCol === "signed" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" on:click={() => setSort("signed")} class="flex items-center gap-1 hover:text-ink-900">
                    {m.state_th_signed()} {sortIcon("signed")}
                  </button>
                </th>
                <th class="px-2 py-2 text-xs font-bold uppercase tracking-wider sm:px-3 sm:py-3" style="color: var(--color-ink-700);">{m.state_th_population()}</th>
                <th class="px-2 py-2 text-xs font-bold uppercase tracking-wider sm:px-3 sm:py-3" style="color: var(--color-ink-700);">{m.state_th_moa()}</th>
              </tr>
            </thead>
            <tbody class="divide-y" style="border-color: var(--color-paper-100);">
              {#each sortedAgencies as agency (agency.slug)}
                <tr class="agency-row-hover">
                  <td class="px-3 py-2 sm:px-4 sm:py-3">
                    <a
                      href={localizeHref(`/agency/${agency.slug}`)}
                      class="font-semibold leading-snug no-underline hover:underline"
                      style="color: var(--color-ink-900);"
                    >{agency.name}</a>
                    {#if agency.city || agency.county}
                      <p class="text-xs" style="color: var(--color-ink-500);">{[agency.city, agency.county].filter(Boolean).join(", ")}</p>
                    {/if}
                  </td>
                  <td class="px-2 py-2 text-xs sm:px-3 sm:py-3" style="color: var(--color-ink-700);">{agency.agency_type ?? "—"}</td>
                  <td class="px-2 py-2 sm:px-3 sm:py-3">
                    <div class="flex flex-wrap gap-1">
                      {#each agency.models as model}
                        <span class="model-badge model-badge--{MODEL_SLUG[model]}">
                          <ModelLink {model} underline={false}
                            ><span class="sm:hidden">{MODEL_MINI[model] ?? model}</span><span class="hidden sm:inline">{MODEL_SHORT[model] ?? model}</span></ModelLink>
                        </span>
                      {/each}
                    </div>
                  </td>
                  <td class="px-2 py-2 tabular-nums sm:px-3 sm:py-3" style="color: var(--color-ink-700);">
                    {agency.signed_date ? agency.signed_date.slice(0, 4) : "—"}
                  </td>
                  <td class="px-2 py-2 tabular-nums sm:px-3 sm:py-3" style="color: var(--color-ink-700);">
                    {agency.population ? popFmt.format(agency.population) : "—"}
                  </td>
                  <td class="px-2 py-2 sm:px-3 sm:py-3">
                    {#if agency.moa_url}
                      <a href={agency.moa_url} target="_blank" rel="noreferrer" class="text-xs font-semibold no-underline hover:underline">↗</a>
                    {:else}
                      <span class="text-xs" style="color: var(--color-paper-200);">—</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <div class="mt-4 grid gap-3 md:hidden">
          {#each sortedAgencies as agency (agency.slug)}
            <div class="rounded-lg border p-3" style="border-color: var(--color-paper-200); background: var(--color-paper-50);">
              <a
                href={localizeHref(`/agency/${agency.slug}`)}
                class="font-semibold leading-snug no-underline hover:underline"
                style="color: var(--color-ink-900);"
              >{agency.name}</a>
              {#if agency.city || agency.county}
                <p class="text-xs" style="color: var(--color-ink-500);">{[agency.city, agency.county].filter(Boolean).join(", ")}</p>
              {/if}
              <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs" style="color: var(--color-ink-700);">
                <div class="flex flex-wrap gap-1">
                  {#each agency.models as model}
                    <span class="model-badge model-badge--{MODEL_SLUG[model]}">
                      <ModelLink {model} underline={false}>{MODEL_MINI[model] ?? model}</ModelLink>
                    </span>
                  {/each}
                </div>
                {#if agency.agency_type}
                  <span>{agency.agency_type}</span>
                {/if}
                <span>
                  <span class="opacity-60">{m.state_th_signed()}</span>
                  <span class="tabular-nums font-medium">{agency.signed_date ? agency.signed_date.slice(0, 4) : "—"}</span>
                </span>
                {#if agency.population}
                  <span>
                    <span class="opacity-60">{m.state_th_population()}</span>
                    <span class="tabular-nums font-medium">{popFmt.format(agency.population)}</span>
                  </span>
                {/if}
                {#if agency.moa_url}
                  <a href={agency.moa_url} target="_blank" rel="noreferrer" class="font-semibold no-underline hover:underline">{m.state_th_moa()} ↗</a>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
      {:else}
        <!-- Non-participating state: no signed 287(g) agreement on the current
             roster. A deliberately-empty state (the "why" lives in the news
             summary above when present) — not a data-missing error. -->
        <div class="mt-4 rounded-lg border border-paper-200 bg-paper-50 px-6 py-10 text-center">
          <p class="text-base font-semibold text-ink-900">
            {m.state_no_agencies_title({ state: stateName })}
          </p>
          <p class="mx-auto mt-2 max-w-prose text-sm leading-relaxed text-ink-700">
            {m.state_no_agencies_body({ state: stateName })}
          </p>
          <a
            href={localizeHref("/")}
            class="mt-4 inline-block text-sm font-medium text-ink-900 underline underline-offset-2 hover:text-ink-700"
          >{m.state_no_agencies_cta()}</a>
        </div>
      {/if}
    </div>
  </section>

</main>

<style>
  .agency-row-hover:hover {
    background: var(--color-paper-100);
  }
</style>

<script lang="ts">
  import type { PageData } from "./$types";
  import { MODEL_ORDER, MODEL_COLORS, MODEL_SHORT } from "$lib/colors";
  import { localizeHref, getLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import StateMiniMap from "$lib/components/StateMiniMap.svelte";
  import StateTrendMini from "$lib/components/StateTrendMini.svelte";
  import StateTopAgencies from "$lib/components/StateTopAgencies.svelte";

  export let data: PageData;
  $: ({ rows, generatedAt, trendMonths } = data);

  const localeTag = getLocale() === "es" ? "es-MX" : "en-US";
  const intFmt = new Intl.NumberFormat(localeTag);
  const popFmt = new Intl.NumberFormat(localeTag, { notation: "compact", maximumFractionDigits: 1 });
  const dateFmt = new Intl.DateTimeFormat(localeTag, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const monthFmt = new Intl.DateTimeFormat(localeTag, { month: "short", year: "2-digit", timeZone: "UTC" });
  const monthLabel = (ym: string | undefined) => (ym ? monthFmt.format(new Date(`${ym}-01`)) : "");

  $: updatedDate = generatedAt ? dateFmt.format(new Date(generatedAt)) : "";
  $: trendStart = monthLabel(trendMonths?.[0]);
  $: trendEnd = monthLabel(trendMonths?.at(-1));

  // Per-row expand state. Expand-all only targets rows that actually have a full
  // body to reveal (the TL;DR is always visible).
  let expanded: Set<string> = new Set();
  const toggle = (abbr: string) => {
    const next = new Set(expanded);
    next.has(abbr) ? next.delete(abbr) : next.add(abbr);
    expanded = next;
  };
  $: expandable = rows.filter((r) => r.news?.body_html);
  const expandAll = () => (expanded = new Set(expandable.map((r) => r.abbr)));
  const collapseAll = () => (expanded = new Set());
  $: allExpanded = expandable.length > 0 && expandable.every((r) => expanded.has(r.abbr));
</script>

<svelte:head>
  <title>{m.states_index_meta_title()}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main id="main-content" class="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
  <!-- ── Header ──────────────────────────────────────────────────────────────── -->
  <header>
    <p class="text-xs font-semibold uppercase tracking-widest text-amber-600">
      {m.states_index_eyebrow()}
    </p>
    <h1 class="mt-1 text-2xl font-black text-slate-900 sm:text-3xl">
      {m.states_index_title()}
    </h1>
    <p class="mt-3 max-w-prose text-sm leading-relaxed text-slate-600">
      {m.states_index_subtitle({ count: intFmt.format(rows.length) })}
    </p>
    <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <button
        type="button"
        on:click={allExpanded ? collapseAll : expandAll}
        class="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-500 hover:text-slate-900"
      >
        {allExpanded ? m.states_index_collapse_all() : m.states_index_expand_all()}
      </button>
      {#if updatedDate}
        <span class="text-xs italic text-slate-400">{m.news_updated({ date: updatedDate })}</span>
      {/if}
    </div>
  </header>

  <!-- ── State cards ─────────────────────────────────────────────────────────── -->
  <div class="mt-8 space-y-4">
    {#each rows as row (row.abbr)}
      {@const isExp = expanded.has(row.abbr)}
      {@const canExpand = Boolean(row.news?.body_html) || Boolean(row.spark)}
      <article class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <!-- Topline header: state name + dead-simple figures -->
        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 class="font-serif text-lg font-bold sm:text-xl">
            <a
              href={localizeHref(`/state/${row.abbr.toLowerCase()}`)}
              class="text-slate-900 no-underline hover:underline"
              aria-label={m.states_index_open_state({ state: row.stateName })}
            >{row.stateName}</a>
          </h2>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
            <span>
              <span class="font-semibold text-slate-900">{intFmt.format(row.agencyCount)}</span>
              {row.agencyCount === 1 ? m.state_agency_one() : m.state_agency_other()}
            </span>
            {#each MODEL_ORDER as model}
              {#if row.modelCounts[model]}
                <span class="flex items-center gap-1.5">
                  <span class="inline-block h-2 w-2 rounded-full" style="background: {MODEL_COLORS[model]};"></span>
                  <span class="font-semibold text-slate-900">{row.modelCounts[model]}</span>
                  {MODEL_SHORT[model]}
                </span>
              {/if}
            {/each}
            {#if row.populationServed}
              <span>
                <span class="font-semibold text-slate-900">{popFmt.format(row.populationServed)}</span>
                {m.state_covered()}
              </span>
            {/if}
          </div>
        </div>

        <!-- Block 1 (always): TL;DR summary | map. Two columns on desktop (text
             gets the wider ~2/3); the map is a fluid 3:2 box the SVG letterboxes
             into. Stacks on mobile. -->
        <div class="mt-4 sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:items-start sm:gap-8">
          <div class="min-w-0">
            {#if row.news}
              <div class="news-prose news-tldr max-w-prose">{@html row.news.tldr_html}</div>
            {:else}
              <p class="text-sm italic text-slate-400">{m.states_index_no_summary()}</p>
            {/if}
          </div>
          {#if row.map}
            <div class="mt-4 aspect-[3/2] w-full sm:mt-0">
              <StateMiniMap
                id={row.abbr}
                w={row.map.w}
                h={row.map.h}
                outline={row.map.outline}
                highways={row.map.highways}
                dots={row.map.dots}
                label={m.states_index_map_aria({ state: row.stateName })}
              />
            </div>
          {/if}
        </div>

        {#if canExpand}
          <!-- ── read more / less ── centered pill, full-width hairline rules -->
          <div class="mt-5 flex items-center gap-3">
            <span class="h-px flex-1 bg-slate-200" aria-hidden="true"></span>
            <button
              type="button"
              class="news-toggle"
              on:click={() => toggle(row.abbr)}
              aria-expanded={isExp}
              aria-controls={`exp-${row.abbr}`}
            >
              {isExp ? m.states_index_hide_summary() : m.states_index_read_summary()}
              <span class="news-chev" class:rotate-180={isExp} aria-hidden="true">▾</span>
            </button>
            <span class="h-px flex-1 bg-slate-200" aria-hidden="true"></span>
          </div>

          <!-- Block 2: narrative (wide) | right rail (chart, then agencies). The
               chart lives in the rail in BOTH states, so it's part of the
               collapsed fadey preview; only the narrative clips+fades when
               collapsed, and the agencies list is revealed on expand. DOM order
               (rail first) makes the chart lead on mobile with agencies right
               under it, then the narrative; the grid reflows to two columns on
               desktop. -->
          <div
            id={`exp-${row.abbr}`}
            class="mt-5 {isExp ? 'states-reveal' : ''} {row.spark || row.topAgencies.length ? 'sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:items-start sm:gap-x-8' : ''}"
          >
            <!-- Right rail: chart + (on expand) largest agencies -->
            <div class="sm:col-start-2 sm:row-start-1">
              {#if row.spark}
                <div class="aspect-[2/1] w-full">
                  <StateTrendMini
                    series={row.spark}
                    startLabel={trendStart}
                    endLabel={trendEnd}
                    label={m.states_index_spark_aria({ state: row.stateName })}
                  />
                </div>
              {/if}
              {#if isExp && row.topAgencies.length}
                <div class="mt-4">
                  <StateTopAgencies agencies={row.topAgencies} />
                </div>
              {/if}
            </div>

            <!-- Narrative: full text when expanded; a clipped, faded peek when
                 collapsed (inert so its citation links stay out of the tab
                 order). -->
            {#if row.news?.body_html}
              <div
                class="mt-4 min-w-0 sm:col-start-1 sm:row-start-1 sm:mt-0 {isExp ? '' : 'states-peek'}"
                inert={!isExp}
              >
                <div class="news-prose news-body max-w-prose">{@html row.news.body_html}</div>
              </div>
            {/if}
          </div>

          {#if isExp}
            <!-- Collapse control at the foot of the expanded block -->
            <div class="mt-6 flex items-center gap-3">
              <span class="h-px flex-1 bg-slate-200" aria-hidden="true"></span>
              <button type="button" class="news-toggle" on:click={() => toggle(row.abbr)}>
                {m.states_index_hide_summary()}
                <span class="news-chev rotate-180" aria-hidden="true">▾</span>
              </button>
              <span class="h-px flex-1 bg-slate-200" aria-hidden="true"></span>
            </div>
          {/if}
        {/if}
      </article>
    {/each}
  </div>
</main>

<style>
  /* Expanded block eases in on reveal. */
  .states-reveal {
    animation: states-reveal 240ms ease both;
  }
  @keyframes states-reveal {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: none; }
  }
  /* Collapsed peek: show the top of the hidden narrative, clipped and faded to
     nothing so it reads as a teaser. Height roughly matches the chart beside it. */
  .states-peek {
    max-height: 7.5rem;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(to bottom, #000 35%, transparent);
    mask-image: linear-gradient(to bottom, #000 35%, transparent);
  }
  @media (prefers-reduced-motion: reduce) {
    .states-reveal { animation: none; }
  }
</style>

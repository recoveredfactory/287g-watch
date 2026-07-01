<script lang="ts">
  import type { PageData } from "./$types";
  import { MODEL_ORDER, MODEL_COLORS, MODEL_SHORT } from "$lib/colors";
  import { localizeHref, getLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";

  export let data: PageData;
  $: ({ rows, generatedAt } = data);

  const localeTag = getLocale() === "es" ? "es-MX" : "en-US";
  const intFmt = new Intl.NumberFormat(localeTag);
  const popFmt = new Intl.NumberFormat(localeTag, { notation: "compact", maximumFractionDigits: 1 });
  const dateFmt = new Intl.DateTimeFormat(localeTag, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

  $: updatedDate = generatedAt ? dateFmt.format(new Date(generatedAt)) : "";

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

        <!-- News summary: TL;DR always shown, body behind a per-row toggle -->
        {#if row.news}
          <div class="news-prose news-tldr mt-4 max-w-prose">
            {@html row.news.tldr_html}
          </div>

          {#if row.news.body_html}
            <button
              type="button"
              on:click={() => toggle(row.abbr)}
              aria-expanded={expanded.has(row.abbr)}
              class="news-toggle mt-3"
            >
              {expanded.has(row.abbr) ? m.states_index_hide_summary() : m.states_index_read_summary()}
              <span class="news-chev" class:rotate-180={expanded.has(row.abbr)} aria-hidden="true">▾</span>
            </button>

            {#if expanded.has(row.abbr)}
              <div class="news-prose news-body mt-4 max-w-prose">
                {@html row.news.body_html}
              </div>
            {/if}
          {/if}
        {:else}
          <p class="mt-4 text-sm italic text-slate-400">{m.states_index_no_summary()}</p>
        {/if}
      </article>
    {/each}
  </div>
</main>

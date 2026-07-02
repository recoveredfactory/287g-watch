<script lang="ts">
  import type { PageData } from "./$types";
  import { browser } from "$app/environment";
  import { MODEL_ORDER, MODEL_COLORS, MODEL_SHORT } from "$lib/colors";
  import { localizeHref, getLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import StateMiniMap from "$lib/components/StateMiniMap.svelte";
  import StateTrendMini from "$lib/components/StateTrendMini.svelte";
  import StateTopAgencies from "$lib/components/StateTopAgencies.svelte";
  import NewsAiWarning from "$lib/components/NewsAiWarning.svelte";
  import LegislationBadge from "$lib/components/LegislationBadge.svelte";
  import { SHOW_LEGISLATION_STANCE } from "$lib/features";

  // Honor the OS reduced-motion setting for the unfurl (a 0ms animation = an
  // instant open, no growth).
  const reduceMotion = browser && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Peek clamp height, in px — MUST match the .states-collapsible fallback
  // `max-height` in the CSS below (6rem). At the news-body's 28.8px line box
  // (text-base × leading-1.8) that's ~3.3 lines: lines 1–2 stay crisp, and line 3
  // is shown fading so it clearly reads as "more text below."
  const PEEK = 96;

  // Jump-free open/close. The bottom section is one persistent element; CSS
  // clamps it to PEEK when closed. On toggle we animate `max-height` from the
  // element's CURRENT height (so mid-flight toggles stay smooth) to either its
  // full content height (scrollHeight ignores the clamp) or back to PEEK — never
  // via 0, which is what a slide/height-from-0 transition does and reads as a
  // jump. At rest we clear the inline overrides so CSS governs again. The fade
  // overlay is a separate CSS concern (the .is-open class), so toggling it can't
  // disturb this height measurement.
  const collapsible = (node: HTMLElement, open: boolean) => {
    let prev = open;
    let anim: Animation | null = null;
    const rest = (isOpen: boolean) => {
      anim = null;
      node.style.maxHeight = isOpen ? "none" : "";
      node.style.overflow = isOpen ? "visible" : "";
    };
    rest(open);
    return {
      update(next: boolean) {
        if (next === prev) return;
        prev = next;
        if (reduceMotion) return rest(next);
        const from = node.getBoundingClientRect().height;
        const to = next ? node.scrollHeight : PEEK;
        node.style.overflow = "hidden";
        node.style.maxHeight = `${from}px`;
        anim?.cancel();
        anim = node.animate(
          [{ maxHeight: `${from}px` }, { maxHeight: `${to}px` }],
          { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
        anim.onfinish = () => rest(next);
      },
      destroy: () => anim?.cancel(),
    };
  };

  // Split the rendered summary HTML after its first paragraph, so the mobile
  // layout can tuck the trend chart in right there (desktop keeps it in the side
  // rail). Returns [firstBlock, rest]; if there's no </p> (shouldn't happen), the
  // whole thing is the first block and rest is empty.
  const splitFirstPara = (html: string | undefined): [string, string] => {
    if (!html) return ["", ""];
    const end = html.indexOf("</p>");
    if (end === -1) return [html, ""];
    const cut = end + "</p>".length;
    return [html.slice(0, cut), html.slice(cut)];
  };

  export let data: PageData;
  $: ({ rows, trendMonths } = data);

  const localeTag = getLocale() === "es" ? "es-MX" : "en-US";
  const intFmt = new Intl.NumberFormat(localeTag);
  const popFmt = new Intl.NumberFormat(localeTag, { notation: "compact", maximumFractionDigits: 1 });
  const dateFmt = new Intl.DateTimeFormat(localeTag, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const monthFmt = new Intl.DateTimeFormat(localeTag, { month: "short", year: "2-digit", timeZone: "UTC" });
  const monthLabel = (ym: string | undefined) => (ym ? monthFmt.format(new Date(`${ym}-01`)) : "");

  // Per-card last-built date (the real built_at from the program), formatted in
  // the active locale. Each state carries its own freshness now.
  const builtDate = (built: string) => (built ? dateFmt.format(new Date(built)) : "");
  $: trendStart = monthLabel(trendMonths?.[0]);
  $: trendEnd = monthLabel(trendMonths?.at(-1));

  // Umami custom event (mirrors +layout's trackConversion; no-ops in dev where
  // the script isn't loaded). Passes the state so opens are filterable per state.
  const track = (event: string, data?: Record<string, unknown>) => {
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      umami?: { track?: (e: string, d?: Record<string, unknown>) => void };
    };
    w.umami?.track?.(event, data);
  };

  // Per-row expand state. Expand-all only targets rows that actually have a full
  // body to reveal (the TL;DR is always visible).
  let expanded: Set<string> = new Set();
  const toggle = (abbr: string) => {
    const next = new Set(expanded);
    const opening = !next.has(abbr);
    opening ? next.add(abbr) : next.delete(abbr);
    expanded = next;
    // Fire only on open — the "read the summary" engagement signal.
    if (opening) track("states_index_read_summary", { state: abbr });
  };
  $: expandable = rows.filter((r) => r.news?.body_html || r.topAgencies.length);
  const expandAll = () => {
    expanded = new Set(expandable.map((r) => r.abbr));
    track("states_index_expand_all", { count: expandable.length });
  };
  const collapseAll = () => (expanded = new Set());
  $: allExpanded = expandable.length > 0 && expandable.every((r) => expanded.has(r.abbr));
</script>

<svelte:head>
  <title>{m.states_index_meta_title()}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main id="main-content" class="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
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
    </div>

    <!-- Always-on hallucination caution, at the top of the index above every
         AI-written summary in the cards below. Per-card last-built dates ride
         with each state, so there's no global "updated" line here. -->
    <div class="mt-4 max-w-prose">
      <NewsAiWarning />
    </div>
  </header>

  <!-- ── State cards ─────────────────────────────────────────────────────────── -->
  <div class="mt-8 space-y-4">
    {#each rows as row (row.abbr)}
      {@const isExp = expanded.has(row.abbr)}
      {@const canExpand = Boolean(row.news?.body_html) || row.topAgencies.length > 0}
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
            {#if SHOW_LEGISLATION_STANCE && row.news?.legislation}
              <LegislationBadge legislation={row.news.legislation} />
            {/if}
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

        <!-- Block A (always): the quick take beside the map — TL;DR on the left
             (wider ~2/3), state map on the right. Stacks on mobile. -->
        <div class="mt-4 sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:items-start sm:gap-10">
          <div class="min-w-0">
            {#if row.news}
              <!-- This state's own last-built date, ahead of the summary (the
                   stance pill rides up in the card's topline figures). -->
              <p class="mb-2 text-xs italic text-slate-400">
                {m.news_updated({ date: builtDate(row.news.built_at) })}
              </p>
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

        {#if row.spark || canExpand}
          {@const hasRail = Boolean(row.spark) || row.topAgencies.length > 0}
          {@const gridCls = hasRail
            ? "sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:items-start sm:gap-10"
            : ""}

          <!-- Bottom-section body (narrative left, chart + agencies right). Kept
               fully rendered in both states — the collapse just clamps it — so
               the open/close animation has no content popping in or out. -->
          {#snippet bottomInner()}
            {@const [firstPara, restHtml] = splitFirstPara(row.news?.body_html)}
            {#if row.news?.body_html}
              <div class="min-w-0 {hasRail ? 'sm:col-start-1 sm:row-start-1' : ''}">
                <div class="news-prose news-body max-w-prose">
                  {@html firstPara}
                  {#if row.spark}
                    <!-- Mobile only: the trend chart sits right after the first
                         paragraph. On desktop it lives in the side rail below, so
                         this copy is hidden there (sm:hidden). -->
                    <div class="mb-5 aspect-[2/1] w-full sm:hidden">
                      <StateTrendMini
                        series={row.spark}
                        startLabel={trendStart}
                        endLabel={trendEnd}
                        label={m.states_index_spark_aria({ state: row.stateName })}
                      />
                    </div>
                  {/if}
                  {@html restHtml}
                </div>
              </div>
            {/if}
            {#if hasRail}
              <!-- On mobile the chart has moved inline (above), so this rail only
                   carries the agencies there; drop its top margin when it has no
                   mobile content to avoid a stray gap. -->
              <div class="sm:col-start-2 sm:row-start-1 sm:mt-0 {row.topAgencies.length ? 'mt-4' : ''}">
                {#if row.spark}
                  <!-- Desktop rail chart (hidden on mobile — shown inline above). -->
                  <div class="hidden aspect-[2/1] w-full sm:block">
                    <StateTrendMini
                      series={row.spark}
                      startLabel={trendStart}
                      endLabel={trendEnd}
                      label={m.states_index_spark_aria({ state: row.stateName })}
                    />
                  </div>
                {/if}
                {#if row.topAgencies.length}
                  <div class="mt-6">
                    <StateTopAgencies agencies={row.topAgencies} />
                  </div>
                {/if}
              </div>
            {/if}
          {/snippet}

          <!-- Read-more is anchored right after the quick-take row and stays put:
               the whole bottom section unfurls below it (like the state page's
               toggle-under-the-lead). Collapsed, that section is a single faded,
               clipped tease — the chart included — as the inducement to click. -->
          {#if canExpand}
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
          {/if}

          <!-- Bottom section: chart-only rows (no summary/agencies to open) just
               show; everything else is one persistent element the `collapsible`
               action grows/shrinks between the peek clamp and full height, with a
               fade overlay (`.is-open`) lifting as it opens. `inert` keeps the
               clamped tease out of the tab order. -->
          {#if !canExpand}
            <div class="mt-4 {gridCls}">{@render bottomInner()}</div>
          {:else}
            <div
              id={`exp-${row.abbr}`}
              class="states-collapsible mt-4 {gridCls}"
              class:is-open={isExp}
              use:collapsible={isExp}
              inert={!isExp}
            >
              {@render bottomInner()}
            </div>
          {/if}

          {#if isExp && canExpand}
            <!-- Foot collapse (like the state page) so a long expanded card
                 doesn't force a scroll back up to close it. -->
            <div class="mt-6 flex items-center gap-3">
              <span class="h-px flex-1 bg-slate-200" aria-hidden="true"></span>
              <button
                type="button"
                class="news-toggle"
                on:click={() => toggle(row.abbr)}
                aria-expanded={isExp}
                aria-controls={`exp-${row.abbr}`}
              >
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
  /* Collapsible bottom section. Closed, it's clamped to a short peek of the
     narrative + chart (this fallback max-height is what the `collapsible` action
     animates to/from — keep the px in the script's PEEK in sync). A gradient
     overlay fades the clamped bottom into the card so it reads as a tease; the
     overlay lifts (opacity → 0) as the section opens. Height is driven entirely
     by inline styles from the action, so the .is-open class only governs the
     fade and never disturbs the height measurement. */
  .states-collapsible {
    position: relative;
    /* ~3.3 lines of news-body (28.8px line box): lines 1–2 crisp, line 3 shown
       fading — enough of it visible to read as text and signal "more below." */
    max-height: 6rem;
    overflow: hidden;
  }
  .states-collapsible::after {
    content: "";
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    /* Transparent edge sits at the start of line 3 (6rem − 2.4rem = 3.6rem ≈ 2
       lines), so lines 1–2 read clean and only line 3 fades out. */
    height: 2.4rem;
    background: linear-gradient(to bottom, transparent, #fff);
    pointer-events: none;
    opacity: 1;
    transition: opacity 240ms ease;
  }
  .states-collapsible.is-open::after {
    opacity: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .states-collapsible::after {
      transition: none;
    }
  }
</style>

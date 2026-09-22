<script lang="ts">
  import type { PageData } from "./$types";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import { getCachedGeo } from "$lib/geo";
  import { MODEL_ORDER, MODEL_COLORS, MODEL_SHORT } from "$lib/colors";
  import { localizeHref, getLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import NewsAiWarning from "$lib/components/NewsAiWarning.svelte";
  import LegislationBadge from "$lib/components/LegislationBadge.svelte";
  import { SHOW_LEGISLATION_STANCE } from "$lib/features";
  import { ogImage } from "$lib/ogImage";

  // Honor the OS reduced-motion setting.
  const reduceMotion = browser && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  export let data: PageData;
  $: ({ rows } = data);

  // Search + sort. "rank" keeps the server's own sort order (agencyCount
  // desc, then population, then name).
  let query = "";
  type SortKey = "rank" | "name" | "population";
  let sortKey: SortKey = "rank";
  $: q = query.trim().toLowerCase();
  $: filteredRows = rows
    .filter((r) => !q || r.stateName.toLowerCase().includes(q) || r.abbr.toLowerCase() === q)
    .slice()
    .sort(
      sortKey === "name"
        ? (a, b) => a.stateName.localeCompare(b.stateName)
        : sortKey === "population"
          ? (a, b) => (b.populationServed ?? 0) - (a.populationServed ?? 0)
          : (a, b) => rows.indexOf(a) - rows.indexOf(b),
    );

  const localeTag = getLocale() === "es" ? "es-MX" : "en-US";
  const intFmt = new Intl.NumberFormat(localeTag);
  const popFmt = new Intl.NumberFormat(localeTag, { notation: "compact", maximumFractionDigits: 1 });
  const dateFmt = new Intl.DateTimeFormat(localeTag, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

  // Per-row last-built date (the real built_at from the program), formatted
  // in the active locale.
  const builtDate = (built: string) => (built ? dateFmt.format(new Date(built)) : "");

  // "% of local LE agencies" for a row — rounded whole percent, "<1" for
  // participating states that round to 0, null when there's no LEE denominator.
  const leePctLabel = (denom: number | null, num: number | null): string | null => {
    if (!denom || num == null) return null;
    const p = Math.round((num / denom) * 100);
    return num > 0 && p === 0 ? "<1" : String(p);
  };

  $: metaTitle = m.states_index_meta_title();
  $: metaDescription = m.states_index_meta_description({ count: intFmt.format(rows.length) });

  // Structured data (schema.org ItemList): each list item points at a real
  // state page carrying its own Dataset/BreadcrumbList markup, so a crawler
  // or AI tool can both see this as an index AND follow through to a specific
  // state's own structured data rather than treating this page as a dead end.
  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? "https://287g.recoveredfactory.net";
  $: canonicalUrl = siteUrl + localizeHref("/states");
  $: jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: metaTitle,
    description: metaDescription,
    url: canonicalUrl,
    itemListElement: rows.map((row, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: row.stateName,
      url: siteUrl + localizeHref(`/state/${row.abbr.toLowerCase()}`),
    })),
  });

  // Umami custom event (mirrors +layout's trackConversion; no-ops in dev where
  // the script isn't loaded). Passes the state so opens are filterable per state.
  const track = (event: string, data?: Record<string, unknown>) => {
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      umami?: { track?: (e: string, d?: Record<string, unknown>) => void };
    };
    w.umami?.track?.(event, data);
  };

  // Which row's short preview is open — one at a time, click to toggle. Rows
  // without a summary aren't expandable at all (nothing to preview).
  let expandedRow: string | null = null;
  const toggle = (abbr: string) => {
    const opening = expandedRow !== abbr;
    expandedRow = opening ? abbr : null;
    // Fire only on open — the "read the summary" engagement signal.
    if (opening) track("states_index_read_summary", { state: abbr });
  };

  // ── "Jump to your state" ────────────────────────────────────────────────────
  // Client-side geo (same lookup as the homepage hero) resolves the viewer's
  // state; if it's one of the rows below, offer a one-tap jump. Every navigable
  // state has a row, so a detected US state always resolves to one.
  let detectedState: string | null = null;
  let bannerDismissed = false;
  let justJumped: string | null = null; // brief highlight on the jumped-to row
  $: detectedRow = detectedState ? rows.find((r) => r.abbr === detectedState) ?? null : null;

  // Fire once, the moment the banner actually starts showing — not on every
  // reactive re-evaluation.
  let detectedShownTracked = false;
  $: if (detectedRow && !bannerDismissed && !detectedShownTracked) {
    track("states_index_detected_shown", { state: detectedRow.abbr });
    detectedShownTracked = true;
  }

  onMount(async () => {
    const geo = await getCachedGeo();
    if (geo.state && rows.some((r) => r.abbr === geo.state)) {
      detectedState = geo.state;
    } else {
      track("states_index_detected_failed");
    }
  });

  const jumpToDetected = () => {
    const abbr = detectedState;
    if (!abbr) return;
    track("states_index_jump_detected", { state: abbr });
    if (rows.find((r) => r.abbr === abbr)?.news) expandedRow = abbr;
    const scroll = () => {
      document
        .getElementById(`state-${abbr}`)
        ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      justJumped = abbr;
      setTimeout(() => justJumped === abbr && (justJumped = null), 1800);
    };
    // One frame so the just-opened row is laid out before we scroll to it.
    requestAnimationFrame(scroll);
  };
</script>

<svelte:head>
  <title>{metaTitle}</title>
  <meta name="description" content={metaDescription} />
  <meta property="og:title" content={metaTitle} />
  <meta property="og:description" content={metaDescription} />
  <meta property="og:url" content={canonicalUrl} />
  <meta property="og:image" content={ogImage("states.png")} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:image" content={ogImage("states.png")} />
  {@html `<script type="application/ld+json">${jsonLd}</` + `script>`}
</svelte:head>

<main id="main-content" class="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
  <!-- ── Header ──────────────────────────────────────────────────────────────── -->
  <header>
    <p class="text-xs font-semibold uppercase tracking-widest text-ink-500">
      {m.states_index_eyebrow()}
    </p>
    <h1 class="mt-1 text-2xl font-black text-ink-900 sm:text-3xl">
      {m.states_index_title()}
    </h1>
    <p class="mt-3 max-w-prose text-sm leading-relaxed text-ink-700">
      {m.states_index_subtitle({ count: intFmt.format(rows.length) })}
    </p>

    <!-- Always-on hallucination caution, above the controls and every AI-written
         summary below. -->
    <div class="mt-4">
      <NewsAiWarning />
    </div>

    <!-- Search + sort, one row. -->
    <div class="mt-4 flex flex-wrap items-center gap-2">
      <div class="relative max-w-sm flex-1">
        <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          type="search"
          bind:value={query}
          placeholder={m.states_index_search_placeholder()}
          class="w-full rounded-md border border-paper-200 bg-paper-50 py-2 pl-9 pr-3 text-sm text-ink-900 placeholder:text-ink-500 focus:border-ink-700 focus:outline-none focus:ring-1 focus:ring-ink-700"
        />
      </div>
      <select
        bind:value={sortKey}
        class="rounded-md border border-paper-200 bg-paper-50 py-2 pl-3 pr-7 text-sm text-ink-700 focus:border-ink-700 focus:outline-none focus:ring-1 focus:ring-ink-700"
      >
        <option value="rank">{m.browse_sort_size()}</option>
        <option value="name">{m.browse_sort_name()}</option>
        <option value="population">{m.browse_sort_population_opt()}</option>
      </select>
    </div>

    <!-- Geo "jump to your state" banner — shows once client-side geo resolves to
         one of the rows below. Dismissible; self-heals per session via the
         shared geo cache. -->
    {#if detectedRow && !bannerDismissed}
      <div
        class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5"
        style="border-color: #BE6079; background: var(--color-paper-100);"
      >
        <p class="flex items-center gap-2 text-sm text-ink-700">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4 shrink-0 text-ink-500" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
          </svg>
          {m.states_index_detected_lead({ state: detectedRow.stateName })}
        </p>
        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            on:click={jumpToDetected}
            class="whitespace-nowrap rounded bg-ink-900 px-3 py-1.5 text-sm font-semibold text-paper-50 transition-colors hover:bg-ink-700"
          >
            {m.states_index_detected_jump()}
          </button>
          <button
            type="button"
            on:click={() => { bannerDismissed = true; track("states_index_detected_dismissed", { state: detectedRow?.abbr }); }}
            aria-label={m.states_index_detected_dismiss()}
            class="rounded-full p-3.5 text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-900"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    {/if}
  </header>

  <!-- ── State rows ──────────────────────────────────────────────────────────── -->
  {#if filteredRows.length === 0}
    <div class="mt-8 rounded-lg border border-paper-200 bg-paper-50 px-6 py-12 text-center">
      <p class="font-medium text-ink-700">{m.browse_no_results()}</p>
    </div>
  {/if}
  <div class="mt-8 divide-y overflow-hidden rounded-lg border" style="border-color: var(--color-paper-200);">
    {#each filteredRows as row (row.abbr)}
      {@const isExp = expandedRow === row.abbr}
      {@const canExpand = Boolean(row.news)}
      {@const leePct = leePctLabel(row.localLeAgencies, row.localParticipating)}
      <article id={`state-${row.abbr}`} class="scroll-mt-24" style="background: var(--color-paper-50);">
        <!-- Compact row: name + toggle on the left, dead-simple figures on the
             right, all on one line (wraps on mobile). This is the whole point
             of the redesign — 53 of these read as a scannable list, not the
             53 fully-expanded cards this page used to render regardless of
             whether anyone asked for the detail. -->
        <!-- The whole row navigates to the state's page on click — not just
             the name text. The chevron (when present) is a separate control
             that stops propagation, since it toggles the inline preview
             rather than navigating. -->
        <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
        <div
          class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-paper-100 sm:px-5"
          style="border-left: 3px solid {justJumped === row.abbr ? '#BE6079' : 'transparent'}; transition: border-color 300ms, background-color 150ms; cursor: pointer;"
          on:click={(e) => {
            if (e.target instanceof Element && e.target.closest("a, button")) return;
            if (window.getSelection()?.toString()) return;
            goto(localizeHref(`/state/${row.abbr.toLowerCase()}`));
          }}
        >
          {#if canExpand}
            <button
              type="button"
              on:click|stopPropagation={() => toggle(row.abbr)}
              aria-expanded={isExp}
              aria-controls={`exp-${row.abbr}`}
              aria-label={m.states_index_toggle_preview({ state: row.stateName })}
              class="shrink-0 rounded-full bg-transparent p-2 transition-colors hover:bg-paper-200"
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                class="h-3 w-3 text-ink-500 transition-transform"
                style="transform: rotate({isExp ? 90 : 0}deg);"
                aria-hidden="true"
              ><path d="M6 4l8 6-8 6V4z" /></svg>
            </button>
          {/if}
          <a
            href={localizeHref(`/state/${row.abbr.toLowerCase()}`)}
            class="min-w-0 truncate font-serif text-base font-bold text-ink-900 no-underline hover:underline sm:text-lg"
          >{row.stateName}</a>

          <div class="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-700 sm:text-sm">
            {#if SHOW_LEGISLATION_STANCE && row.legislation}
              <LegislationBadge legislation={row.legislation} />
            {/if}
            <span><span class="font-semibold text-ink-900">{intFmt.format(row.agencyCount)}</span> {row.agencyCount === 1 ? m.state_agency_one() : m.state_agency_other()}</span>
            {#if leePct !== null}
              <span class="hidden sm:inline"><span class="font-semibold text-ink-900">{leePct}%</span> {m.states_index_local_le_pct()}</span>
            {/if}
            <span class="hidden items-center gap-2 sm:flex">
              {#each MODEL_ORDER as model}
                {#if row.modelCounts[model]}
                  <span class="flex items-center gap-1" aria-label="{MODEL_SHORT[model]}: {row.modelCounts[model]}">
                    <span class="inline-block h-2 w-2 rounded-full" style="background: {MODEL_COLORS[model]};" aria-hidden="true"></span>
                    <span class="font-semibold text-ink-900">{row.modelCounts[model]}</span>
                  </span>
                {/if}
              {/each}
            </span>
            {#if row.populationServed}
              <span class="hidden sm:inline"><span class="font-semibold text-ink-900">{popFmt.format(row.populationServed)}</span> {m.state_covered()}</span>
            {/if}
          </div>
        </div>

        <!-- Short preview: TL;DR only, no full body/chart/agency list — those
             already live on the full state page, one click away. Keeps this
             index page cheap to render and quick to scan; the detail page is
             the destination, not a duplicate of it. -->
        {#if isExp}
          <div id={`exp-${row.abbr}`} class="border-t px-4 py-4 sm:px-5" style="border-color: var(--color-paper-200); background: var(--color-paper-100);">
            {#if row.news}
              <p class="text-xs italic text-ink-500">
                {m.news_updated({ date: builtDate(row.news.built_at) })} ·
                {m.news_generated_with()}
                <a
                  href="https://promptql.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="underline decoration-paper-200 underline-offset-2 hover:text-ink-900"
                >{m.news_ai_promptql()}</a>
              </p>
              <div class="news-prose news-tldr mt-2 max-w-prose">{@html row.news.tldr_html}</div>
            {/if}
            <a
              href={localizeHref(`/state/${row.abbr.toLowerCase()}`)}
              class="mt-3 inline-flex items-center gap-1 rounded bg-ink-900 px-3 py-1.5 text-sm font-semibold text-paper-50 no-underline transition-colors hover:bg-ink-700"
            >{m.states_index_explore_state({ state: row.stateName })} →</a>
          </div>
        {/if}
      </article>
    {/each}
  </div>
</main>

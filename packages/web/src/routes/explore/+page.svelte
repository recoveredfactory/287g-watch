<script lang="ts">
  import type { StatesPageData, StateRow, AgencyRow } from "./+page.server";
  import { page } from "$app/stores";
  import { browser } from "$app/environment";
  import { localizeHref, getLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import { MODEL_ORDER, MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_SHORT, MODEL_MINI } from "$lib/colors";
  import { ogImage } from "$lib/ogImage";
  import StateTrendMini from "$lib/components/StateTrendMini.svelte";
  import { VirtualList } from "svelte-virtuallists";

  export let data: StatesPageData;

  // Umami custom event (mirrors +layout's trackConversion; no-ops in dev where
  // the script isn't loaded).
  const track = (event: string, data?: Record<string, unknown>) => {
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      umami?: { track?: (e: string, d?: Record<string, unknown>) => void };
    };
    w.umami?.track?.(event, data);
  };

  // Rank is derived from the loader's existing sort order (states by
  // agencyCount desc, agencies by officerCt desc) — no extra sort needed.
  const stateRankByAbbr = new Map(data.states.map((s, i) => [s.abbr, i + 1]));
  const agencyRankBySlug = new Map(data.agencies.map((a, i) => [a.slug, i + 1]));

  // Synthetic aggregate rows, addable to the compare grid via the "compare
  // to national" toggle — not real, selectable rows (no rank, no
  // detail-page link), just the sum across the full dataset for scale.
  const NATIONAL_ID = "__national__";
  const nationalStateRow: StateRow = {
    abbr: NATIONAL_ID,
    stateName: "",
    agencyCount: data.states.reduce((sum, s) => sum + s.agencyCount, 0),
    modelCounts: data.states.reduce((acc, s) => {
      for (const [k, v] of Object.entries(s.modelCounts)) acc[k] = (acc[k] ?? 0) + v;
      return acc;
    }, {} as Record<string, number>),
    populationServed: data.states.reduce((sum, s) => sum + (s.populationServed ?? 0), 0) || null,
    localLeAgencies: data.states.reduce((sum, s) => sum + (s.localLeAgencies ?? 0), 0) || null,
    localParticipating: data.states.reduce((sum, s) => sum + (s.localParticipating ?? 0), 0) || null,
  };
  const nationalAgencyRow: AgencyRow = {
    slug: NATIONAL_ID,
    name: "",
    state: "",
    city: null,
    primary_model: "",
    models: [],
    officerCt: data.agencies.reduce((sum, a) => sum + (a.officerCt ?? 0), 0),
    population: data.agencies.reduce((sum, a) => sum + (a.population ?? 0), 0) || null,
    agencyType: "",
    signedDate: null,
    moaUrl: null,
  };
  // Split in two (rather than one shared flag) so removing one national card
  // from the compare grid doesn't also drop the other.
  let includeNationalStates = false;
  let includeNationalAgencies = false;
  function toggleNational() {
    const anyOn = includeNationalStates || includeNationalAgencies;
    includeNationalStates = !anyOn;
    includeNationalAgencies = !anyOn;
    track("browse_compare_national", { on: !anyOn });
  }

  // The URL already encodes the full selection (?sel=state:GA,agency:...,
  // kept in sync by the history.replaceState effect below), so "share this
  // comparison" is just copying the current address — no separate share
  // link to build or expire.
  let linkCopied = false;
  let linkCopiedTimer: ReturnType<typeof setTimeout>;
  async function copyCompareLink() {
    if (!browser) return;
    try {
      await navigator.clipboard.writeText(location.href);
    } catch {
      return; // clipboard permission denied or unavailable — fail silently
    }
    linkCopied = true;
    clearTimeout(linkCopiedTimer);
    linkCopiedTimer = setTimeout(() => (linkCopied = false), 2000);
    track("browse_copy_link", { count: selection.length });
  }

  // Top-of-page summary strip + default preview lists — shown unconditionally
  // so the page has real content on load instead of just empty controls
  // waiting for a search.
  const statesWithAgencies = data.states.filter((s) => s.agencyCount > 0).length;
  const totalAgencies = data.agencies.length;
  const nationalParticipationPct =
    nationalStateRow.localLeAgencies
      ? Math.round(((nationalStateRow.localParticipating ?? 0) / nationalStateRow.localLeAgencies) * 100)
      : null;
  const localeTag = getLocale() === "es" ? "es-MX" : "en-US";
  const intFmt = new Intl.NumberFormat(localeTag);
  const popFmt = new Intl.NumberFormat(localeTag, { notation: "compact", maximumFractionDigits: 1 });
  const dateFmt = new Intl.DateTimeFormat(localeTag, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const monthShortFmt = new Intl.DateTimeFormat(localeTag, { year: "numeric", month: "short", timeZone: "UTC" });
  const monthLabel = (ym: string) => monthShortFmt.format(new Date(`${ym}-01T00:00:00Z`));

  $: title = m.browse_meta_title();
  $: description = m.browse_meta_description();

  type SelItem = { kind: "state" | "agency"; id: string };

  // Compare tray holds a mix of states and agencies together — browsing
  // states or agencies is just search, not a mode switch, so there's only
  // ever one selection to track. Capped at SELECTION_MAX: high enough to be
  // useful, low enough that the compare grid still reads at a glance rather
  // than becoming a spreadsheet.
  const SELECTION_MAX = 5;

  // Read once from $page.url (correct on both SSR and hydration, unlike
  // onMount reading location.search — a shared ?sel=... link used to render
  // an empty tray first and flash to populated after hydration).
  const initialParams = $page.url.searchParams;
  const initialSel = initialParams.get("sel");
  const initialSelection: SelItem[] = (initialSel ?? "")
    .split(",")
    .filter(Boolean)
    .map((tok): SelItem => {
      const [kind, ...rest] = tok.split(":");
      return { kind: kind === "agency" ? "agency" : "state", id: rest.join(":") };
    })
    .slice(0, SELECTION_MAX);
  let selection: SelItem[] = initialSelection;

  let query = "";
  let mounted = false;
  let dropdownOpen = false;

  // Dropdown only opens once there's an actual query — focusing the empty
  // search box shouldn't dump the full 53-state/1,700-agency list; you
  // search first, then the matching results (and their checkboxes) appear.
  $: dropdownOpen = query.trim().length > 0;

  // Fires once per search "session" (query goes empty→non-empty), not on
  // every keystroke.
  let searchTracked = false;
  $: if (dropdownOpen && !searchTracked) {
    track("browse_search");
    searchTracked = true;
  } else if (!dropdownOpen) {
    searchTracked = false;
  }

  // Sort control for the search dropdown — a small icon-triggered popover,
  // not a persistent control row (mobile-first: nothing extra competing for
  // space next to the search box). Shares one key across both states and
  // agencies since "rank"/"name"/"population" mean the same thing for both.
  type SortKey = "rank" | "name" | "population";
  let sortKey: SortKey = "rank";
  let sortMenuOpen = false;

  // Agency-type filter — states don't have a type, so this only narrows the
  // agencies list. Lives in the same popover as sort since both are
  // "how the list is arranged" controls competing for the same bit of UI.
  type AgencyTypeFilter = "all" | "Municipality" | "County" | "State Agency";
  let agencyTypeFilter: AgencyTypeFilter = "all";
  function chooseAgencyTypeFilter(value: AgencyTypeFilter) {
    agencyTypeFilter = value;
    track("browse_type_filter", { value });
  }

  function chooseSortKey(key: SortKey) {
    sortKey = key;
    sortMenuOpen = false;
    track("browse_sort", { key });
  }

  function stateComparator(key: SortKey) {
    if (key === "name") return (a: StateRow, b: StateRow) => a.stateName.localeCompare(b.stateName);
    if (key === "population") return (a: StateRow, b: StateRow) => (b.populationServed ?? 0) - (a.populationServed ?? 0);
    return (a: StateRow, b: StateRow) => b.agencyCount - a.agencyCount;
  }
  function agencyComparator(key: SortKey) {
    if (key === "name") return (a: AgencyRow, b: AgencyRow) => a.name.localeCompare(b.name);
    if (key === "population") return (a: AgencyRow, b: AgencyRow) => (b.population ?? 0) - (a.population ?? 0);
    return (a: AgencyRow, b: AgencyRow) => (b.officerCt ?? 0) - (a.officerCt ?? 0);
  }

  const DISPLAY_CAP = 150;

  // ── Full agency search table ────────────────────────────────────────────
  // Restored from origin/main's homepage "Search agencies" section (dropped
  // in the redesign, brought back here per feedback — "the data isn't just
  // by state... the main search page should serve this"). Shares the same
  // text query as the compare-picker above; adds its own state/model/year
  // filters and a virtualized table, same as the old implementation
  // (svelte-virtuallists was never removed as a dependency).
  let filterModels: Set<string> = new Set();
  let filterStates: Set<string> = new Set();
  let filterYear = "";

  function toggleFilterModel(model: string) {
    const next = new Set(filterModels);
    if (next.has(model)) next.delete(model);
    else next.add(model);
    filterModels = next;
    track("browse_table_filter", { kind: "model", model });
  }
  function toggleFilterState(abbr: string) {
    const next = new Set(filterStates);
    if (next.has(abbr)) next.delete(abbr);
    else next.add(abbr);
    filterStates = next;
    track("browse_table_filter", { kind: "state", state: abbr });
  }
  function clearTableFilters() {
    filterModels = new Set();
    filterStates = new Set();
    filterYear = "";
    query = "";
  }

  $: allYears = [...new Set(data.agencies.map((a) => a.signedDate?.slice(0, 4)).filter((y): y is string => !!y))].sort();

  $: tableAgencies = data.agencies.filter((a) => {
    const matchesSearch =
      !q ||
      a.name.toLowerCase().includes(q) ||
      a.state.toLowerCase().includes(q) ||
      (a.city ?? "").toLowerCase().includes(q);
    const matchesModel = filterModels.size === 0 || a.models.some((mo) => filterModels.has(mo));
    const matchesState = filterStates.size === 0 || filterStates.has(a.state);
    const matchesYear = !filterYear || (a.signedDate?.startsWith(filterYear) ?? false);
    return matchesSearch && matchesModel && matchesState && matchesYear;
  });
  $: hasTableFilters = q !== "" || filterModels.size > 0 || filterStates.size > 0 || filterYear !== "";
  // The virtual list keeps scroll position when `items` changes, so a
  // narrowed filter would otherwise strand the reader mid-list — keying on
  // this signature remounts the list (and resets scroll to top) whenever any
  // filter changes, same as the original implementation.
  $: tableFilterKey = JSON.stringify([q, [...filterStates].sort(), filterYear, [...filterModels].sort()]);

  $: if (browser && !mounted) mounted = true;

  $: if (browser && mounted) {
    const params = new URLSearchParams();
    if (selection.length) params.set("sel", selection.map((s) => `${s.kind}:${s.id}`).join(","));
    const qs = params.toString();
    history.replaceState(history.state, "", qs ? `?${qs}` : location.pathname);
  }

  function toggleSelection(kind: "state" | "agency", id: string) {
    const idx = selection.findIndex((s) => s.kind === kind && s.id === id);
    if (idx >= 0) {
      selection = [...selection.slice(0, idx), ...selection.slice(idx + 1)];
      track("browse_compare_remove", { kind });
    } else if (selection.length < SELECTION_MAX) {
      selection = [...selection, { kind, id }];
      track("browse_compare_add", { kind });
    }
  }

  // Removes a single compare card without reopening the search dropdown.
  // National cards aren't part of `selection` (they're display-only
  // aggregates), so removing one just flips its own toggle back off.
  function removeEntry(entry: CompareEntry) {
    if (entry.national) {
      if (entry.kind === "state") includeNationalStates = false;
      else includeNationalAgencies = false;
      track("browse_compare_national", { on: false });
      return;
    }
    const id = entry.kind === "state" ? entry.row.abbr : entry.row.slug;
    toggleSelection(entry.kind, id);
  }

  $: q = query.trim().toLowerCase();

  // Abbr match is exact (not substring) — abbr is only 2 letters, so a
  // substring match against a short query matched almost every state
  // (e.g. "t" ⊂ "TX", "UT", "MT", "CT"...) and the States group showed up
  // for nearly any agency search, not just actual state searches.
  $: filteredStates = data.states
    .filter((s) => !q || s.stateName.toLowerCase().includes(q) || s.abbr.toLowerCase() === q)
    .slice()
    .sort(stateComparator(sortKey));
  $: filteredAgenciesAll = data.agencies
    .filter((a) => !q || a.name.toLowerCase().includes(q) || a.state.toLowerCase().includes(q))
    .filter((a) => agencyTypeFilter === "all" || a.agencyType === agencyTypeFilter)
    .slice()
    .sort(agencyComparator(sortKey));
  $: agenciesTotal = filteredAgenciesAll.length;
  $: filteredAgencies = filteredAgenciesAll.slice(0, DISPLAY_CAP);


  type CompareEntry =
    | { kind: "state"; row: StateRow; national: boolean }
    | { kind: "agency"; row: AgencyRow; national: boolean };

  $: compareResolved = selection
    .map((s): CompareEntry | null => {
      if (s.kind === "state") {
        const row = data.states.find((r) => r.abbr === s.id);
        return row ? { kind: "state", row, national: false } : null;
      }
      const row = data.agencies.find((r) => r.slug === s.id);
      return row ? { kind: "agency", row, national: false } : null;
    })
    .filter((e): e is CompareEntry => e !== null);

  $: compareDisplay = [
    ...compareResolved,
    ...(includeNationalStates ? [{ kind: "state", row: nationalStateRow, national: true } as CompareEntry] : []),
    ...(includeNationalAgencies ? [{ kind: "agency", row: nationalAgencyRow, national: true } as CompareEntry] : []),
  ];

  const barPct = (value: number, max: number) => Math.max(2, Math.round((value / max) * 100));

  const localLePctNum = (row: StateRow): number | null => {
    if (!row.localLeAgencies) return null;
    return Math.round(((row.localParticipating ?? 0) / row.localLeAgencies) * 100);
  };
  const localLePct = (row: StateRow): string | null => {
    const pct = localLePctNum(row);
    return pct === null ? null : `${pct}%`;
  };

  // Bar widths inside the compare cards are relative to the max among the
  // items of the same kind actually being compared, so magnitude reads as
  // "how do these stack up against each other" rather than an absolute
  // scale most viewers have no reference for.
  $: maxCompareAgencyCount = Math.max(1, ...compareDisplay.filter((e) => e.kind === "state").map((e) => (e as { row: StateRow }).row.agencyCount));
  $: maxComparePopulationServed = Math.max(1, ...compareDisplay.filter((e) => e.kind === "state").map((e) => (e as { row: StateRow }).row.populationServed ?? 0));
  $: maxCompareOfficerCt = Math.max(1, ...compareDisplay.filter((e) => e.kind === "agency").map((e) => (e as { row: AgencyRow }).row.officerCt ?? 0));
  $: maxComparePopulation = Math.max(1, ...compareDisplay.filter((e) => e.kind === "agency").map((e) => (e as { row: AgencyRow }).row.population ?? 0));
  $: maxCompareParticipationPct = Math.max(1, ...compareDisplay.filter((e) => e.kind === "state").map((e) => localLePctNum((e as { row: StateRow }).row) ?? 0));

  // Best-value highlighting is only meaningful once there's actually more
  // than one item of that kind to compare — with a single state or agency
  // in the tray, every stat is trivially "the leading one," which isn't
  // useful to call out.
  $: compareStateN = compareDisplay.filter((e) => e.kind === "state").length;
  $: compareAgencyN = compareDisplay.filter((e) => e.kind === "agency").length;
  const isLeading = (value: number, max: number, n: number) => n > 1 && value > 0 && value === max;

  function onOutsidePointer(e: PointerEvent) {
    if (!(e.target as HTMLElement).closest(".browse-search")) dropdownOpen = false;
    if (!(e.target as HTMLElement).closest(".browse-sort")) sortMenuOpen = false;
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      dropdownOpen = false;
      sortMenuOpen = false;
    }
  }
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:image" content={ogImage('explore.png')} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:image" content={ogImage('explore.png')} />
</svelte:head>

<svelte:window on:pointerdown={onOutsidePointer} on:keydown={onWindowKeydown} />

<main id="main-content" class="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
  <p class="text-xs font-semibold uppercase tracking-widest text-ink-500">{m.browse_eyebrow()}</p>
  <h1 class="mt-1 text-2xl font-black text-ink-900 sm:text-3xl">{m.browse_title()}</h1>
  {#if data.snapshotDate}
    <p class="mt-2 text-xs italic text-ink-500">{m.browse_as_of({ date: dateFmt.format(new Date(data.snapshotDate)) })}</p>
  {/if}

  <!-- Summary strip -->
  <dl class="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 border-y border-paper-200 py-6 sm:grid-cols-4">
    <div>
      <dt class="text-xs font-semibold uppercase tracking-widest text-ink-500">{m.browse_stat_states()}</dt>
      <dd class="mt-1 font-mono text-2xl font-bold tabular-nums text-ink-900">{intFmt.format(statesWithAgencies)}</dd>
    </div>
    <div>
      <dt class="text-xs font-semibold uppercase tracking-widest text-ink-500">{m.browse_stat_agencies()}</dt>
      <dd class="mt-1 font-mono text-2xl font-bold tabular-nums text-ink-900">{intFmt.format(totalAgencies)}</dd>
    </div>
    {#if nationalStateRow.populationServed}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-widest text-ink-500">{m.browse_stat_population()}</dt>
        <dd class="mt-1 font-mono text-2xl font-bold tabular-nums text-ink-900">{popFmt.format(nationalStateRow.populationServed)}</dd>
      </div>
    {/if}
    {#if nationalParticipationPct !== null}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-widest text-ink-500">{m.browse_stat_participation()}</dt>
        <dd class="mt-1 font-mono text-2xl font-bold tabular-nums text-ink-900">{nationalParticipationPct}%</dd>
      </div>
    {/if}
  </dl>

  <!-- Search + grouped inline checklist dropdown — one box searches both
       states and agencies at once (no States/Agencies mode switch: the
       compare tray already mixes both, so browsing shouldn't be split). -->
  <div class="mt-6 flex items-start gap-2">
  <div class="browse-search relative max-w-sm flex-1">
    <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
    </svg>
    <input
      type="search"
      bind:value={query}
      placeholder={m.browse_search_placeholder()}
      class="w-full rounded-md border border-paper-200 bg-paper-50 py-2 pl-9 pr-3 text-sm text-ink-900 placeholder:text-ink-500 focus:border-ink-700 focus:outline-none focus:ring-1 focus:ring-ink-700"
    />

    {#if dropdownOpen}
      <div class="absolute left-0 top-full z-20 mt-1.5 max-h-96 w-full overflow-y-auto rounded-md border border-paper-200 bg-paper-50 shadow-lg">
        {#if filteredStates.length === 0 && filteredAgencies.length === 0}
          <p class="py-6 text-center text-sm text-ink-500">{m.browse_no_results()}</p>
        {/if}

        {#if filteredStates.length > 0}
          <p class="border-b border-paper-100 bg-paper-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">{m.search_palette_group_states()}</p>
          <ol>
            {#each filteredStates as row (row.abbr)}
              {@const checked = selection.some((s) => s.kind === "state" && s.id === row.abbr)}
              <li>
                <label
                  class="flex flex-wrap cursor-pointer items-center gap-x-3 gap-y-1 border-b px-3 py-2.5 last:border-b-0"
                  style="border-color: var(--color-paper-100); background: {checked ? 'var(--color-paper-100)' : 'transparent'};"
                >
                  <input
                    type="checkbox"
                    {checked}
                    disabled={!checked && selection.length >= SELECTION_MAX}
                    on:change={() => toggleSelection("state", row.abbr)}
                    class="h-4 w-4 shrink-0 rounded"
                  />
                  <a
                    href={localizeHref(`/state/${row.abbr.toLowerCase()}`)}
                    class="min-w-0 flex-1 no-underline hover:underline"
                    on:click|stopPropagation
                  >
                    <p class="truncate text-sm font-semibold text-ink-900">{row.stateName}</p>
                  </a>
                  <span class="flex shrink-0 items-center gap-2">
                    {#each MODEL_ORDER as model}
                      {#if row.modelCounts[model]}
                        <span class="flex items-center gap-1 font-mono text-[11px] tabular-nums text-ink-700" aria-label="{MODEL_SHORT[model]}: {row.modelCounts[model]}">
                          <span class="inline-block h-2 w-2 rounded-full" style="background: {MODEL_COLORS[model]};" aria-hidden="true"></span>
                          {row.modelCounts[model]}
                        </span>
                      {/if}
                    {/each}
                  </span>
                  <span class="shrink-0 font-mono text-xs tabular-nums text-ink-500">
                    {m.browse_rank({ rank: stateRankByAbbr.get(row.abbr) ?? 0 })} · {intFmt.format(row.agencyCount)} {m.leaderboard_unit_agencies()}
                  </span>
                </label>
              </li>
            {/each}
          </ol>
        {/if}

        {#if filteredAgencies.length > 0}
          <p class="border-b border-t border-paper-100 bg-paper-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">{m.search_palette_group_agencies()}</p>
          <ol>
            {#each filteredAgencies as row (row.slug)}
              {@const checked = selection.some((s) => s.kind === "agency" && s.id === row.slug)}
              <li>
                <label
                  class="flex flex-wrap cursor-pointer items-center gap-x-3 gap-y-1 border-b px-3 py-2.5 last:border-b-0"
                  style="border-color: var(--color-paper-100); background: {checked ? 'var(--color-paper-100)' : 'transparent'};"
                >
                  <input
                    type="checkbox"
                    {checked}
                    disabled={!checked && selection.length >= SELECTION_MAX}
                    on:change={() => toggleSelection("agency", row.slug)}
                    class="h-4 w-4 shrink-0 rounded"
                  />
                  <a
                    href={localizeHref(`/agency/${row.slug}`)}
                    class="min-w-0 flex-1 no-underline hover:underline"
                    on:click|stopPropagation
                  >
                    <p class="truncate text-sm font-semibold text-ink-900">{row.name}</p>
                    <p class="truncate text-xs text-ink-500">{row.state}</p>
                  </a>
                  {#if row.primary_model}
                    <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style="background: {MODEL_COLORS[row.primary_model]}; color: {MODEL_TEXT_COLORS[row.primary_model]};">{MODEL_SHORT[row.primary_model]}</span>
                  {/if}
                  <span class="shrink-0 font-mono text-xs tabular-nums text-ink-500">
                    {m.browse_rank({ rank: agencyRankBySlug.get(row.slug) ?? 0 })} · {row.officerCt ? `${intFmt.format(row.officerCt)} ${m.leaderboard_unit_officers()}` : "—"}
                  </span>
                </label>
              </li>
            {/each}
            {#if agenciesTotal > DISPLAY_CAP}
              <li class="py-3 text-center text-xs italic text-ink-500">
                {m.browse_result_count_capped({ shown: DISPLAY_CAP, total: intFmt.format(agenciesTotal) })}
              </li>
            {/if}
          </ol>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Sort control — icon button + small popover, not a persistent row next
       to search (mobile-first: nothing extra competing for space there). -->
  <div class="browse-sort relative shrink-0">
    <button
      type="button"
      on:click={() => (sortMenuOpen = !sortMenuOpen)}
      aria-expanded={sortMenuOpen}
      aria-label={m.browse_sort_label()}
      class="flex h-[2.375rem] w-[2.375rem] items-center justify-center rounded-md border border-paper-200 bg-paper-50 text-ink-700 hover:border-ink-500 hover:text-ink-900"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 7h18M6 12h12M10 17h4" />
      </svg>
    </button>
    {#if sortMenuOpen}
      <div class="absolute right-0 top-full z-20 mt-1.5 w-48 overflow-hidden rounded-md border border-paper-200 bg-paper-50 shadow-lg">
        <p class="border-b border-paper-100 bg-paper-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">{m.browse_sort_label()}</p>
        {#each [["rank", m.browse_sort_size()], ["name", m.browse_sort_name()], ["population", m.browse_sort_population_opt()]] as [key, label]}
          <button
            type="button"
            on:click={() => chooseSortKey(key as SortKey)}
            class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-paper-100"
            class:font-semibold={sortKey === key}
            class:text-ink-900={sortKey === key}
            class:text-ink-700={sortKey !== key}
          >
            {label}
            {#if sortKey === key}<span aria-hidden="true">✓</span>{/if}
          </button>
        {/each}
        <p class="border-y border-paper-100 bg-paper-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">{m.browse_filter_type_label()}</p>
        {#each [["all", m.browse_filter_type_all()], ["Municipality", m.browse_filter_type_municipality()], ["County", m.browse_filter_type_county()], ["State Agency", m.browse_filter_type_state()]] as [value, label]}
          <button
            type="button"
            on:click={() => chooseAgencyTypeFilter(value as AgencyTypeFilter)}
            class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-paper-100"
            class:font-semibold={agencyTypeFilter === value}
            class:text-ink-900={agencyTypeFilter === value}
            class:text-ink-700={agencyTypeFilter !== value}
          >
            {label}
            {#if agencyTypeFilter === value}<span aria-hidden="true">✓</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
  </div>

  <!-- Selection bar -->
  {#if selection.length > 0}
    <div class="mt-3 flex items-center justify-between gap-3 rounded-md border px-3 py-2" style="border-color: #BE6079; background: var(--color-paper-100);">
      <span class="text-sm font-semibold text-ink-900">{m.browse_selected_count({ count: selection.length })}</span>
      <div class="flex items-center gap-3">
        <button
          type="button"
          on:click={toggleNational}
          class="text-xs font-semibold text-ink-700 underline underline-offset-2"
        >{(includeNationalStates || includeNationalAgencies) ? m.browse_remove_national() : m.browse_add_national()}</button>
        <button
          type="button"
          on:click={copyCompareLink}
          aria-live="polite"
          class="text-xs font-semibold text-ink-700 underline underline-offset-2"
        >{linkCopied ? m.browse_link_copied() : m.browse_copy_link()}</button>
        <button
          type="button"
          on:click={() => { selection = []; includeNationalStates = false; includeNationalAgencies = false; }}
          class="text-xs font-semibold text-ink-700 underline underline-offset-2"
        >{m.browse_clear_selection()}</button>
      </div>
    </div>
  {/if}

  <!-- Full agency search table — real content on the page without requiring
       a search first. Hidden once a compare is active (selection non-empty)
       so the compare grid isn't buried below it — reappears on Clear. -->
  {#if selection.length === 0}
  <div class="mt-8">

    <!-- Full agency search table — restored per feedback ("the main search
         page should serve this"), adapted from origin/main's homepage
         "Search agencies" section onto current paper/ink tokens. -->
    <section class="mt-12">
      <h2 class="font-serif text-lg font-bold text-ink-900">{m.browse_table_heading()}</h2>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <select
          class="max-w-[11rem] rounded-md border border-paper-200 bg-paper-50 py-2 pl-3 pr-7 text-sm text-ink-700 focus:border-ink-700 focus:outline-none focus:ring-1 focus:ring-ink-700 sm:max-w-none"
          on:change={(e) => { if (e.currentTarget.value) { toggleFilterState(e.currentTarget.value); e.currentTarget.value = ""; } }}
        >
          <option value="">{filterStates.size === 0 ? m.browse_table_all_states() : m.browse_table_add_state()}</option>
          {#each data.states.filter((s) => !filterStates.has(s.abbr)) as s}
            <option value={s.abbr}>{s.stateName}</option>
          {/each}
        </select>

        {#each [...filterStates].sort() as abbr}
          <button
            type="button"
            on:click={() => toggleFilterState(abbr)}
            class="flex items-center gap-1 rounded px-3 py-1.5 text-xs font-semibold text-white"
            style="background: var(--color-ink-900);"
          >
            {data.states.find((s) => s.abbr === abbr)?.stateName ?? abbr}
            <span aria-hidden="true" class="opacity-70">×</span>
          </button>
        {/each}

        <select bind:value={filterYear} class="rounded-md border border-paper-200 bg-paper-50 py-2 pl-3 pr-7 text-sm text-ink-700 focus:border-ink-700 focus:outline-none focus:ring-1 focus:ring-ink-700">
          <option value="">{m.browse_table_year_signed()}</option>
          {#each allYears as year}
            <option value={year}>{year}</option>
          {/each}
        </select>

        {#each MODEL_ORDER as model}
          {@const active = filterModels.has(model)}
          <button
            type="button"
            on:click={() => toggleFilterModel(model)}
            class="rounded border px-3 py-1.5 text-xs font-semibold transition-colors"
            style={active
              ? `background: ${MODEL_COLORS[model]}; border-color: ${MODEL_COLORS[model]}; color: ${MODEL_TEXT_COLORS[model] ?? '#191D21'};`
              : `background: ${MODEL_COLORS[model]}22; border-color: ${MODEL_COLORS[model]}88; color: var(--color-ink-700);`}
          >
            {MODEL_SHORT[model]}
          </button>
        {/each}
      </div>

      <p class="mt-4 text-sm text-ink-500">
        {#if hasTableFilters}
          {m.browse_table_match_count({ matched: intFmt.format(tableAgencies.length), total: intFmt.format(data.agencies.length) })} —
          <button type="button" on:click={clearTableFilters} class="underline underline-offset-2 text-ink-900">{m.browse_clear_selection()}</button>
        {:else}
          {m.browse_table_baseline({ rows: intFmt.format(data.agencies.length), states: String(data.states.length) })}
        {/if}
      </p>

      {#if tableAgencies.length === 0}
        <div class="mt-5 rounded-lg border border-paper-200 bg-paper-50 px-6 py-12 text-center">
          <p class="font-medium text-ink-700">{m.browse_table_no_match()}</p>
          <button type="button" on:click={clearTableFilters} class="mt-2 text-sm underline underline-offset-2 text-ink-900">{m.browse_clear_selection()}</button>
        </div>
      {:else}
        <div class="agency-table mt-4 overflow-hidden rounded-lg border border-paper-200 text-sm">
          <div class="agency-row agency-row--header border-b border-paper-200 bg-paper-100 text-xs font-bold uppercase tracking-wider text-ink-700">
            <div class="px-3 py-2 sm:px-4 sm:py-3">{m.browse_table_col_agency()}</div>
            <div class="px-2 py-2 sm:px-3 sm:py-3">{m.browse_table_col_type()}</div>
            <div class="px-2 py-2 sm:px-3 sm:py-3">{m.browse_table_col_signed()}</div>
            <div class="agency-col-pop px-2 py-2 sm:px-3 sm:py-3">{m.browse_table_col_population()}</div>
            <div class="px-2 py-2 sm:px-3 sm:py-3">{m.browse_table_col_moa()}</div>
            <div class="agency-col-foia px-2 py-2 sm:px-3 sm:py-3">{m.browse_table_col_foia()}</div>
          </div>
          {#key tableFilterKey}
          <VirtualList items={tableAgencies} style="height: min(70vh, 640px); scrollbar-gutter: stable;">
            {#snippet vl_slot({ item: agency })}
            <div class="agency-row border-b border-paper-100 hover:bg-paper-50">
              <div class="px-3 py-2 sm:px-4 sm:py-3">
                <a href={localizeHref(`/agency/${agency.slug}`)} class="font-semibold leading-snug text-ink-900 no-underline hover:underline">{agency.name}</a>
                <p class="text-xs text-ink-500">
                  {#if agency.city}{agency.city}{/if}{#if agency.city && agency.state}, {/if}<a href={localizeHref(`/state/${agency.state.toLowerCase()}`)} class="no-underline hover:underline">{agency.state}</a>
                </p>
              </div>
              <div class="px-2 py-2 sm:px-3 sm:py-3">
                <div class="flex flex-wrap gap-1">
                  {#each agency.models as model}
                    <span class="model-badge" class:model-badge--jail={model.includes("Jail")} class:model-badge--taskforce={model.includes("Task")} class:model-badge--wso={model.includes("Warrant")} title={model}>{MODEL_MINI[model] ?? model}</span>
                  {/each}
                </div>
              </div>
              <div class="px-2 py-2 tabular-nums text-ink-700 sm:px-3 sm:py-3">{agency.signedDate ? agency.signedDate.slice(0, 4) : "—"}</div>
              <div class="agency-col-pop px-2 py-2 tabular-nums text-ink-700 sm:px-3 sm:py-3">{agency.population ? popFmt.format(agency.population) : "—"}</div>
              <div class="px-2 py-2 text-xs font-semibold sm:px-3 sm:py-3">
                {#if agency.moaUrl}<a href={agency.moaUrl} target="_blank" rel="noreferrer" class="no-underline hover:underline">↗</a>{:else}<span class="text-ink-300">—</span>{/if}
              </div>
              <div class="agency-col-foia px-2 py-2 text-xs font-semibold sm:px-3 sm:py-3">
                <a href="https://www.muckrock.com/foi/create/" target="_blank" rel="noreferrer" class="no-underline hover:underline">→</a>
              </div>
            </div>
            {/snippet}
          </VirtualList>
          {/key}
        </div>
      {/if}
    </section>
  </div>
  {/if}

  <!-- Compare -->
  {#if compareDisplay.length > 0}
    <section class="mt-10 border-t border-paper-200 pt-8">
      <h2 class="font-serif text-lg font-bold text-ink-900">{m.browse_compare_heading({ count: compareResolved.length })}</h2>
      <div class="compare-grid mt-4 grid grid-cols-1 gap-4">
        {#each compareDisplay as entry}
          {@const entryName = entry.national ? m.browse_national_label() : entry.kind === "state" ? entry.row.stateName : entry.row.name}
          <div class="relative rounded-lg border p-4" style="border-color: {entry.national ? 'var(--color-ink-500)' : 'var(--color-paper-200)'}; background: var(--color-paper-50);">
            <button
              type="button"
              on:click={() => removeEntry(entry)}
              aria-label="{m.browse_remove_item()} {entryName}"
              class="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-ink-500 hover:bg-paper-100 hover:text-ink-900"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            {#if entry.kind === "state"}
              {@const row = entry.row}
              {@const leadAgencies = isLeading(row.agencyCount, maxCompareAgencyCount, compareStateN)}
              {#if entry.national}
                <p class="font-serif text-lg font-bold text-ink-900 pr-6">{m.browse_national_label()}</p>
              {:else}
                <a href={localizeHref(`/state/${row.abbr.toLowerCase()}`)} class="font-serif text-lg font-bold no-underline hover:underline text-ink-900 pr-6 block">{row.stateName}</a>
                <p class="mt-0.5 font-mono text-[11px] tabular-nums text-ink-500">{m.browse_rank({ rank: stateRankByAbbr.get(row.abbr) ?? 0 })}</p>
              {/if}
              <dl class="mt-4 space-y-4">
                <div>
                  <dt class="text-[10px] font-semibold uppercase tracking-wider text-ink-500">{m.compare_stat_agencies()}</dt>
                  <dd class="mt-0.5 flex items-baseline gap-1 font-mono text-xl font-bold tabular-nums" style="color: {leadAgencies ? '#BE6079' : 'var(--color-ink-900)'};">
                    {#if leadAgencies}<span aria-hidden="true">✓</span>{/if}{intFmt.format(row.agencyCount)}
                  </dd>
                  <div class="mt-1 h-1 w-full overflow-hidden rounded-full" style="background: var(--color-paper-200);">
                    <div class="h-full rounded-full" style="width: {barPct(row.agencyCount, maxCompareAgencyCount)}%; background: {leadAgencies ? '#BE6079' : 'var(--color-ink-700)'};"></div>
                  </div>
                </div>
                {#if row.populationServed}
                  {@const leadPop = isLeading(row.populationServed, maxComparePopulationServed, compareStateN)}
                  <div>
                    <dt class="text-[10px] font-semibold uppercase tracking-wider text-ink-500">{m.compare_stat_population()}</dt>
                    <dd class="mt-0.5 flex items-baseline gap-1 font-mono text-xl font-bold tabular-nums" style="color: {leadPop ? '#BE6079' : 'var(--color-ink-900)'};">
                      {#if leadPop}<span aria-hidden="true">✓</span>{/if}{popFmt.format(row.populationServed)}
                    </dd>
                    <div class="mt-1 h-1 w-full overflow-hidden rounded-full" style="background: var(--color-paper-200);">
                      <div class="h-full rounded-full" style="width: {barPct(row.populationServed, maxComparePopulationServed)}%; background: {leadPop ? '#BE6079' : 'var(--color-ink-700)'};"></div>
                    </div>
                  </div>
                {/if}
                {#if localLePct(row)}
                  {@const leadPct = isLeading(localLePctNum(row) ?? 0, maxCompareParticipationPct, compareStateN)}
                  <div>
                    <dt class="text-[10px] font-semibold uppercase tracking-wider text-ink-500">{m.compare_stat_participation()}</dt>
                    <dd class="mt-0.5 flex items-baseline gap-1 font-mono text-xl font-bold tabular-nums" style="color: {leadPct ? '#BE6079' : 'var(--color-ink-900)'};">
                      {#if leadPct}<span aria-hidden="true">✓</span>{/if}{localLePct(row)}
                    </dd>
                    <div class="mt-1 h-1 w-full overflow-hidden rounded-full" style="background: var(--color-paper-200);">
                      <div class="h-full rounded-full" style="width: {Math.max(2, Math.round(((row.localParticipating ?? 0) / (row.localLeAgencies || 1)) * 100))}%; background: {leadPct ? '#BE6079' : 'var(--color-ink-700)'};"></div>
                    </div>
                  </div>
                {/if}
                <div>
                  <dt class="text-[10px] font-semibold uppercase tracking-wider text-ink-500">{m.compare_stat_models()}</dt>
                  <dd class="mt-1.5 space-y-1">
                    {#each MODEL_ORDER as modelName}
                      {#if row.modelCounts[modelName]}
                        <div class="flex items-center justify-between gap-2 text-xs">
                          <span class="rounded px-1.5 py-0.5 font-semibold" style="background: {MODEL_COLORS[modelName]}; color: {MODEL_TEXT_COLORS[modelName]};">{MODEL_SHORT[modelName]}</span>
                          <span class="font-mono tabular-nums text-ink-700">{row.modelCounts[modelName]}</span>
                        </div>
                      {/if}
                    {/each}
                  </dd>
                </div>
                {#if !entry.national && data.stateSparkByAbbr[row.abbr]}
                  <div>
                    <dt class="text-[10px] font-semibold uppercase tracking-wider text-ink-500">{m.browse_spark_heading()}</dt>
                    <dd class="mt-1 h-16 w-full">
                      <StateTrendMini
                        series={data.stateSparkByAbbr[row.abbr]}
                        startLabel={monthLabel(data.trendMonths[0])}
                        endLabel={monthLabel(data.trendMonths[data.trendMonths.length - 1])}
                        label={m.browse_spark_aria({ state: row.stateName })}
                      />
                    </dd>
                  </div>
                {/if}
              </dl>
            {:else}
              {@const row = entry.row}
              {@const leadOfficers = isLeading(row.officerCt ?? 0, maxCompareOfficerCt, compareAgencyN)}
              {#if entry.national}
                <p class="font-serif text-base font-bold leading-tight text-ink-900 pr-6">{m.browse_national_label()}</p>
              {:else}
                <a href={localizeHref(`/agency/${row.slug}`)} class="font-serif text-base font-bold leading-tight no-underline hover:underline text-ink-900 pr-6 block">{row.name}</a>
                <p class="mt-0.5 text-xs text-ink-500">{row.state}</p>
                <p class="mt-0.5 font-mono text-[11px] tabular-nums text-ink-500">{m.browse_rank({ rank: agencyRankBySlug.get(row.slug) ?? 0 })}</p>
              {/if}
              <dl class="mt-4 space-y-4">
                <div>
                  <dt class="text-[10px] font-semibold uppercase tracking-wider text-ink-500">{m.leaderboard_unit_officers()}</dt>
                  <dd class="mt-0.5 flex items-baseline gap-1 font-mono text-xl font-bold tabular-nums" style="color: {leadOfficers ? '#BE6079' : 'var(--color-ink-900)'};">
                    {#if leadOfficers}<span aria-hidden="true">✓</span>{/if}{row.officerCt ? intFmt.format(row.officerCt) : "—"}
                  </dd>
                  {#if row.officerCt}
                    <div class="mt-1 h-1 w-full overflow-hidden rounded-full" style="background: var(--color-paper-200);">
                      <div class="h-full rounded-full" style="width: {barPct(row.officerCt, maxCompareOfficerCt)}%; background: {leadOfficers ? '#BE6079' : 'var(--color-ink-700)'};"></div>
                    </div>
                  {/if}
                </div>
                {#if row.population}
                  {@const leadAgencyPop = isLeading(row.population, maxComparePopulation, compareAgencyN)}
                  <div>
                    <dt class="text-[10px] font-semibold uppercase tracking-wider text-ink-500">{m.browse_agency_population()}</dt>
                    <dd class="mt-0.5 flex items-baseline gap-1 font-mono text-xl font-bold tabular-nums" style="color: {leadAgencyPop ? '#BE6079' : 'var(--color-ink-900)'};">
                      {#if leadAgencyPop}<span aria-hidden="true">✓</span>{/if}{popFmt.format(row.population)}
                    </dd>
                    <div class="mt-1 h-1 w-full overflow-hidden rounded-full" style="background: var(--color-paper-200);">
                      <div class="h-full rounded-full" style="width: {barPct(row.population, maxComparePopulation)}%; background: {leadAgencyPop ? '#BE6079' : 'var(--color-ink-700)'};"></div>
                    </div>
                  </div>
                {/if}
                {#if row.primary_model}
                  <div>
                    <dt class="text-[10px] font-semibold uppercase tracking-wider text-ink-500">{m.browse_agency_model_label()}</dt>
                    <dd class="mt-1">
                      <span class="rounded px-1.5 py-0.5 text-xs font-semibold" style="background: {MODEL_COLORS[row.primary_model]}; color: {MODEL_TEXT_COLORS[row.primary_model]};">{MODEL_SHORT[row.primary_model]}</span>
                    </dd>
                  </div>
                {/if}
              </dl>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}
</main>

<style>
  .compare-grid {
    grid-template-columns: repeat(1, minmax(0, 1fr));
  }
  @media (min-width: 640px) {
    .compare-grid {
      grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    }
  }

  /* Agency search table grid — fixed column tracks (not `auto`) so every row,
     header included, sizes its columns identically and they line up into a
     real table. minmax(0, …) lets the name column shrink/wrap instead of
     forcing the grid wider than its container. */
  .agency-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 7rem 3.25rem 2.5rem;
    align-items: center;
  }
  /* The virtualized rows live inside a scrolling viewport; on classic
     scrollbars that viewport is narrower than the header by the scrollbar's
     width, which would shift every column. Reserve the same gutter on the
     header so the two grids share an identical content width. */
  .agency-row--header {
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
  .agency-col-pop,
  .agency-col-foia {
    display: none;
  }
  @media (min-width: 640px) {
    .agency-row {
      grid-template-columns: minmax(0, 1fr) 8.5rem 4rem 5.5rem 3.5rem 3.5rem;
    }
    .agency-col-pop,
    .agency-col-foia {
      display: block;
    }
  }
  /* svelte-virtuallists' inner track — full width so each row spans the
     viewport and its columns line up with the header. */
  :global(.vtlist-inner) {
    width: 100%;
  }
</style>

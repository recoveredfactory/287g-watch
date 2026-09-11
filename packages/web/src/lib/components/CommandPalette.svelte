<script lang="ts">
  // Site-wide search — an always-visible inline search box in the header
  // (same pattern as AgencySearch.svelte's agency-jump bar: input + an
  // absolutely-positioned dropdown anchored right below it, no backdrop, no
  // centered modal card). Covers agencies, states, glossary terms, model
  // pages, and the static content pages. Agencies (the biggest dataset,
  // ~1,700 rows) are fetched lazily on first focus and cached at module
  // scope so repeat uses in the same session don't refetch.
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import { localizeHref } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import { STATE_NAMES, NAVIGABLE_STATES } from "$lib/states";
  import { GLOSSARY_TERMS, termSlug } from "$lib/glossary/terms";
  import { MODEL_SLUG, MODEL_SHORT, MODEL_COLORS, MODEL_TEXT_COLORS } from "$lib/colors";

  type Agency = {
    slug: string;
    name: string;
    state: string;
    city?: string | null;
    county?: string | null;
    primary_model: string | null;
    population?: number | null;
  };

  type ResultItem = {
    kind: "agency" | "state" | "glossary" | "model" | "page";
    key: string;
    title: string;
    subtitle?: string;
    href: string;
    badge?: { label: string; bg: string; fg: string };
  };

  let query = $state("");
  let dropdownOpen = $state(false);
  let activeIdx = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();
  let listEl: HTMLUListElement | undefined = $state();

  let agenciesCache: Agency[] | null = null;
  let agenciesLoading = false;
  let agencies = $state<Agency[]>([]);

  async function ensureAgenciesLoaded() {
    if (agenciesCache) {
      agencies = agenciesCache;
      return;
    }
    if (agenciesLoading) return;
    agenciesLoading = true;
    try {
      const res = await fetch("/data/dist/agency_index.json");
      if (res.ok) {
        agenciesCache = await res.json();
        agencies = agenciesCache ?? [];
      }
    } catch {
      // Silent — agency results just stay empty; states/glossary/models/pages
      // still work without this fetch succeeding.
    } finally {
      agenciesLoading = false;
    }
  }

  const PAGES: { key: string; label: () => string; href: string }[] = [
    { key: "home", label: () => m.search_palette_page_home(), href: "/" },
    { key: "states", label: () => m.search_palette_page_states(), href: "/states" },
    { key: "glossary", label: () => m.search_palette_page_glossary(), href: "/glossary" },
    { key: "about", label: () => m.search_palette_page_about(), href: "/about" },
    { key: "methodology", label: () => m.search_palette_page_methodology(), href: "/methodology" },
    { key: "use-the-map", label: () => m.search_palette_page_use_the_map(), href: "/use-the-map" },
  ];

  const norm = (s: string) => s.toLowerCase();

  let groupedResults = $derived.by(() => {
    const q = norm(query.trim());
    if (q.length < 1) {
      return { agencies: [], states: [], glossary: [], models: [], pages: [] } as Record<string, ResultItem[]>;
    }

    const agencyResults: ResultItem[] = agencies
      .filter((a) =>
        norm(a.name).includes(q) ||
        norm(a.city ?? "").includes(q) ||
        norm(a.county ?? "").includes(q) ||
        norm(a.state).includes(q) ||
        norm(STATE_NAMES[a.state] ?? "").includes(q),
      )
      .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
      .slice(0, 6)
      .map((a) => ({
        kind: "agency" as const,
        key: `agency-${a.slug}`,
        title: a.name,
        subtitle: [a.city, STATE_NAMES[a.state] ?? a.state].filter(Boolean).join(", "),
        href: `/agency/${a.slug}`,
        badge: a.primary_model
          ? { label: MODEL_SHORT[a.primary_model] ?? a.primary_model, bg: MODEL_COLORS[a.primary_model] ?? "#e2e8f0", fg: MODEL_TEXT_COLORS[a.primary_model] ?? "#0f172a" }
          : undefined,
      }));

    const stateResults: ResultItem[] = Object.entries(NAVIGABLE_STATES)
      .filter(([abbr, name]) => norm(name).includes(q) || norm(abbr).includes(q))
      .slice(0, 5)
      .map(([abbr, name]) => ({
        kind: "state" as const,
        key: `state-${abbr}`,
        title: name,
        href: `/state/${abbr.toLowerCase()}`,
      }));

    const glossaryResults: ResultItem[] = GLOSSARY_TERMS
      .filter((t) => norm(t.term).includes(q) || norm(t.definition).includes(q))
      .slice(0, 5)
      .map((t) => ({
        kind: "glossary" as const,
        key: `glossary-${termSlug(t.term)}`,
        title: t.term,
        subtitle: t.definition,
        href: `/glossary#term-${termSlug(t.term)}`,
      }));

    const modelResults: ResultItem[] = Object.entries(MODEL_SLUG)
      .filter(([full]) => norm(full).includes(q) || norm(MODEL_SHORT[full] ?? "").includes(q))
      .slice(0, 3)
      .map(([full, slug]) => ({
        kind: "model" as const,
        key: `model-${slug}`,
        title: full,
        href: `/model/${slug}`,
      }));

    const pageResults: ResultItem[] = PAGES
      .filter((p) => norm(p.label()).includes(q))
      .slice(0, 5)
      .map((p) => ({
        kind: "page" as const,
        key: `page-${p.key}`,
        title: p.label(),
        href: p.href,
      }));

    return {
      agencies: agencyResults,
      states: stateResults,
      glossary: glossaryResults,
      models: modelResults,
      pages: pageResults,
    };
  });

  let flatResults = $derived([
    ...groupedResults.agencies,
    ...groupedResults.states,
    ...groupedResults.glossary,
    ...groupedResults.models,
    ...groupedResults.pages,
  ]);

  $effect(() => {
    flatResults;
    activeIdx = 0;
  });

  $effect(() => {
    dropdownOpen = query.trim().length > 0;
  });

  function select(item: ResultItem) {
    query = "";
    dropdownOpen = false;
    goto(localizeHref(item.href));
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      query = "";
      dropdownOpen = false;
      inputEl?.blur();
    } else if (e.key === "ArrowDown") {
      if (!dropdownOpen || !flatResults.length) return;
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, flatResults.length - 1);
      scrollActive();
    } else if (e.key === "ArrowUp") {
      if (!dropdownOpen || !flatResults.length) return;
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      scrollActive();
    } else if (e.key === "Enter") {
      if (flatResults[activeIdx]) select(flatResults[activeIdx]);
    }
  }

  function scrollActive() {
    listEl?.children[activeIdx]?.scrollIntoView({ block: "nearest" });
  }

  function onOutsidePointer(e: PointerEvent) {
    if (!(e.target as HTMLElement).closest(".command-palette")) {
      dropdownOpen = false;
    }
  }

  // Cmd/Ctrl+K focuses the box from anywhere on the page, same convention as
  // most site-search shortcuts — still useful without the modal.
  function onGlobalKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      inputEl?.focus();
    }
  }
</script>

<svelte:window onpointerdown={onOutsidePointer} onkeydown={onGlobalKeydown} />

<div class="command-palette relative ml-3 w-full max-w-[9rem] shrink-0 focus-within:max-w-[16rem] sm:ml-4 sm:max-w-[11rem] sm:focus-within:max-w-[18rem]" style="transition: max-width 160ms ease;">
  <div class="relative">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style="color: var(--color-ink-500);" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
    </svg>
    <input
      bind:this={inputEl}
      bind:value={query}
      type="search"
      placeholder={m.search_palette_placeholder_short()}
      autocomplete="off"
      autocapitalize="none"
      spellcheck="false"
      inputmode="search"
      role="combobox"
      aria-expanded={dropdownOpen}
      aria-controls="command-palette-list"
      aria-label={m.search_palette_trigger_aria()}
      aria-activedescendant={dropdownOpen && flatResults[activeIdx] ? `cp-opt-${flatResults[activeIdx].key}` : undefined}
      class="w-full rounded-md border py-1.5 pl-8 pr-2.5 text-xs focus:outline-none focus:ring-1 sm:text-sm"
      style="border-color: var(--color-paper-200); background: var(--color-paper-100); color: var(--color-ink-900);"
      onkeydown={onKeydown}
      onfocus={() => { if (query.trim()) dropdownOpen = true; ensureAgenciesLoaded(); }}
    />
  </div>

  {#if dropdownOpen}
    <ul
      bind:this={listEl}
      id="command-palette-list"
      role="listbox"
      class="absolute left-0 top-full z-50 mt-1.5 max-h-80 w-[min(22rem,90vw)] overflow-y-auto rounded-lg border py-1.5 shadow-lg"
      style="border-color: var(--color-paper-200); background: var(--color-paper-50);"
    >
      {#if flatResults.length === 0}
        <li class="px-3 py-4 text-center text-sm" style="color: var(--color-ink-500);">{m.search_palette_no_results()}</li>
      {/if}
      {#each [
        { key: "agencies", label: m.search_palette_group_agencies(), items: groupedResults.agencies },
        { key: "states", label: m.search_palette_group_states(), items: groupedResults.states },
        { key: "glossary", label: m.search_palette_group_glossary(), items: groupedResults.glossary },
        { key: "models", label: m.search_palette_group_models(), items: groupedResults.models },
        { key: "pages", label: m.search_palette_group_pages(), items: groupedResults.pages },
      ] as group}
        {#if group.items.length > 0}
          <li class="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider" style="color: var(--color-ink-500);">{group.label}</li>
          {#each group.items as item (item.key)}
            {@const idx = flatResults.indexOf(item)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <li
              id="cp-opt-{item.key}"
              role="option"
              aria-selected={idx === activeIdx}
              class="cursor-pointer px-3 py-2"
              style={idx === activeIdx ? "background: var(--color-paper-100);" : ""}
              onclick={() => select(item)}
              onmouseenter={() => (activeIdx = idx)}
            >
              <div class="flex items-center justify-between gap-2">
                <p class="truncate text-sm font-semibold" style="color: var(--color-ink-900);">{item.title}</p>
                {#if item.badge}
                  <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style="background: {item.badge.bg}; color: {item.badge.fg};">{item.badge.label}</span>
                {/if}
              </div>
              {#if item.subtitle}
                <p class="truncate text-xs" style="color: var(--color-ink-500);">{item.subtitle}</p>
              {/if}
            </li>
          {/each}
        {/if}
      {/each}
    </ul>
  {/if}
</div>

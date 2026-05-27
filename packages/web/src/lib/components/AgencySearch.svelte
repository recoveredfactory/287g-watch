<script lang="ts">
  import { goto } from "$app/navigation";
  import { localizeHref } from "$lib/paraglide/runtime";
  import { STATE_NAMES } from "$lib/states";
  import { MODEL_SHORT, MODEL_COLORS, MODEL_TEXT_COLORS } from "$lib/colors";
  import type { Agency } from "../../routes/+page.server";

  export let agencies: Agency[];
  export let currentSlug: string = "";
  export let currentAgencyName: string = "";
  export let placeholder: string = "Search agencies…";

  let query = "";
  let open = false;
  let activeIdx = -1;
  let inputEl: HTMLInputElement;
  let listEl: HTMLUListElement;

  // When the active agency changes (mount, or nav between agencies), reset the
  // input to display that agency's name as a passive "you are here" header.
  // Tracked separately so user typing isn't clobbered by reactive re-runs.
  let lastSeenAgencyName = "";
  $: if (currentAgencyName !== lastSeenAgencyName) {
    lastSeenAgencyName = currentAgencyName;
    query = currentAgencyName;
  }

  // Skip search results while the input is still displaying the current
  // agency name — don't surface the page-you're-on as a search result.
  // Sort by jurisdiction population descending so "Miami-Dade Sheriff" (FL,
  // 2.7M) beats "Miami" (OH, ~85K) for same-name disambiguation.
  $: results = (query.trim().length < 2 || query === currentAgencyName)
    ? []
    : agencies
        .filter((a) => {
          const q = query.trim().toLowerCase();
          return (
            a.name.toLowerCase().includes(q) ||
            (a.city ?? "").toLowerCase().includes(q) ||
            (a.county ?? "").toLowerCase().includes(q) ||
            a.state.toLowerCase().includes(q) ||
            (STATE_NAMES[a.state] ?? "").toLowerCase().includes(q)
          );
        })
        .sort((a, b) => (b.population ?? b.lee?.population ?? 0) - (a.population ?? a.lee?.population ?? 0))
        .slice(0, 8);

  // Auto-select the top result whenever the query changes so Enter "just
  // works" without pressing ArrowDown first. Also resets a stale highlight
  // when the result set shifts under the user.
  $: open = results.length > 0;
  $: activeIdx = results.length > 0 ? 0 : -1;

  function hl(text: string): string {
    const q = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!q) return text;
    return text.replace(new RegExp(`(${q})`, "gi"), "<mark>$1</mark>");
  }

  function select(agency: Agency) {
    query = "";
    open = false;
    activeIdx = -1;
    goto(localizeHref(`/agency/${agency.slug}`));
  }

  function onKeydown(e: KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" && results.length) { open = true; activeIdx = 0; e.preventDefault(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, results.length - 1); scrollActive(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); scrollActive(); }
    else if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); select(results[activeIdx]); }
    else if (e.key === "Escape") { open = false; activeIdx = -1; inputEl.blur(); }
  }

  function scrollActive() {
    if (!listEl || activeIdx < 0) return;
    listEl.children[activeIdx]?.scrollIntoView({ block: "nearest" });
  }

  function onOutsidePointer(e: PointerEvent) {
    if (!(e.target as HTMLElement).closest(".agency-search")) {
      open = false;
      activeIdx = -1;
    }
  }

  function onFocus() {
    // Clear the "you are here" header so the user can type freely.
    if (query === currentAgencyName) query = "";
  }

  function onBlur() {
    // If the user leaves the field without typing, restore the header so the
    // input keeps acting as a page indicator. Delayed so a click on a search
    // result (which blurs the input first) can run select() before this fires.
    setTimeout(() => {
      if (!query.trim() && currentAgencyName && document.activeElement !== inputEl) {
        query = currentAgencyName;
      }
    }, 150);
  }
</script>

<!-- pointerdown fires on first touch contact on iOS; click does not on non-interactive elements -->
<svelte:window on:pointerdown={onOutsidePointer} />

<div class="agency-search relative w-full sm:max-w-md">
  <div class="relative">
    <svg
      class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
      fill="none" stroke="currentColor" viewBox="0 0 24 24"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
    </svg>
    <input
      bind:this={inputEl}
      bind:value={query}
      type="search"
      {placeholder}
      autocomplete="off"
      autocapitalize="none"
      spellcheck="false"
      inputmode="search"
      role="combobox"
      aria-expanded={open}
      aria-autocomplete="list"
      aria-controls="agency-search-list"
      aria-activedescendant={activeIdx >= 0 ? `agency-opt-${activeIdx}` : undefined}
      class="w-full rounded-md border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-[#BE6079] focus:outline-none focus:ring-1 focus:ring-[#BE6079] sm:py-2 sm:text-sm"
      on:keydown={onKeydown}
      on:focus={onFocus}
      on:blur={onBlur}
    />
  </div>

  {#if open && results.length > 0}
    <ul
      bind:this={listEl}
      id="agency-search-list"
      role="listbox"
      class="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg"
    >
      {#each results as agency, i (agency.slug)}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <li
          id="agency-opt-{i}"
          role="option"
          aria-selected={i === activeIdx}
          class="cursor-pointer px-4 py-3 text-sm sm:py-2.5"
          class:bg-slate-50={i === activeIdx}
          class:border-l-2={agency.slug === currentSlug}
          style={agency.slug === currentSlug ? "border-color: #BE6079;" : ""}
          on:click={() => select(agency)}
          on:mouseenter={() => (activeIdx = i)}
        >
          <p class="font-semibold text-slate-900 leading-snug">
            {@html hl(agency.name)}
          </p>
          <p class="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
            <span>{@html hl([agency.city, STATE_NAMES[agency.state] ?? agency.state].filter(Boolean).join(", "))}</span>
            {#if agency.primary_model}
              <span
                class="rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none"
                style="background: {MODEL_COLORS[agency.primary_model] ?? '#e2e8f0'}; color: {MODEL_TEXT_COLORS[agency.primary_model] ?? '#0f172a'};"
              >{MODEL_SHORT[agency.primary_model] ?? agency.primary_model}</span>
            {/if}
          </p>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  :global(.agency-search mark) {
    background: #fef08a;
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
  }
</style>

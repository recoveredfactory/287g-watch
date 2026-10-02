<script lang="ts">
  // Shared virtualized list wrapper for record-per-row / field-per-column
  // data (agencies, primarily). Below `md:` (768px) it renders one stacked
  // card per record instead of a table row with hidden columns — the caller
  // owns the actual cell markup (agency rows, citation rows, etc. all look
  // very different), this component owns breakpoint detection + the
  // VirtualList wiring + the table/row semantic scaffolding.
  //
  // Accessibility contract for callers: the `row` snippet's root element
  // should carry `role="cell"` per field in table mode (or an equivalent
  // definition-list/label-value structure in card mode) so the record/field
  // structure survives for assistive tech even though the DOM shape changes
  // between modes — see the UI/UX revamp plan's accessibility section.
  import type { Snippet } from "svelte";
  import { VirtualList } from "svelte-virtuallists";
  import { mediaQuery } from "$lib/reactiveMedia";

  type T = $$Generic;

  export let items: T[];
  export let getKey: (item: T) => string | number;
  // Signature that should remount/rescroll-to-top the virtualized list when
  // it changes (e.g. a JSON-stringified active filter set) — mirrors the
  // pattern the homepage already used for its own VirtualList.
  export let remountKey: string = "";
  export let ariaLabel: string;
  // Fixed row heights per mode (svelte-virtuallists supports variable sizing
  // via a per-index calculator, but a real per-card measurement pass isn't
  // worth it here — agency cards are uniform enough that a fixed height per
  // mode covers the real content without the extra complexity).
  export let tableRowHeight = 52;
  export let cardRowHeight = 116;
  // Passed straight to the VirtualList's outer style (e.g. a viewport-relative
  // height) — page-layout-specific, so the caller owns it.
  export let listStyle = "height: 480px;";

  export let header: Snippet | undefined = undefined;
  export let row: Snippet<[T, boolean]>;

  // Card mode below md: (768px) — matches the design-system breakpoint set.
  const isCardStore = mediaQuery("(max-width: 767px)");
  $: isCard = $isCardStore;
  $: rowHeight = isCard ? cardRowHeight : tableRowHeight;
</script>

<div class="w-full" role="table" aria-label={ariaLabel}>
  {#if header && !isCard}
    <div role="row">{@render header()}</div>
  {/if}
  {#key remountKey + (isCard ? "card" : "table")}
    <VirtualList {items} sizingCalculator={() => rowHeight} style={listStyle}>
      {#snippet vl_slot({ item }: { item: T })}
        <div role="row" data-key={getKey(item)}>{@render row(item, isCard)}</div>
      {/snippet}
    </VirtualList>
  {/key}
</div>

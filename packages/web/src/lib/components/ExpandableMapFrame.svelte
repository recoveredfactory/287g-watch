<script lang="ts">
  // Wraps a map component in a modest-height box with a "tap to expand"
  // affordance that grows the SAME container to fill the viewport — the map
  // component inside never unmounts/remounts (no second WebGL context), it
  // just needs its own resize handling to notice the container changed size
  // (NationalMap.svelte already has this via ResizeObserver; AgencyMap.svelte
  // was given one for this purpose too).
  //
  // Used on /state/[abbr] (NationalMap, focus mode) and /agency/[slug]
  // (AgencyMap) — both previously sat in a cramped h-[260px]/h-[320px] fixed
  // box, cramped for pan/zoom gestures on a phone.
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { m } from "$lib/paraglide/messages.js";

  let { ariaLabel, children }: { ariaLabel: string; children: import("svelte").Snippet } = $props();

  let expanded = $state(false);
  let expandButton: HTMLButtonElement | undefined = $state();
  let closeButton: HTMLButtonElement | undefined = $state();

  function open() {
    expanded = true;
  }
  function close() {
    expanded = false;
    // Return focus to the trigger — standard modal-dismiss behavior.
    expandButton?.focus();
  }

  $effect(() => {
    if (expanded && browser) {
      // Move focus into the expanded view and stop background scroll while
      // it's open.
      closeButton?.focus();
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && expanded) close();
  }
</script>

<svelte:window on:keydown={onKeydown} />

<div
  class="map-frame relative overflow-hidden rounded-lg border shadow-sm"
  class:map-frame--expanded={expanded}
  style="border-color: var(--color-paper-200);"
  role={expanded ? "dialog" : "region"}
  aria-modal={expanded ? "true" : undefined}
  aria-label={ariaLabel}
>
  {@render children()}

  {#if !expanded}
    <button
      bind:this={expandButton}
      type="button"
      onclick={open}
      class="expand-btn absolute bottom-2 right-2 z-10 rounded-md px-2.5 py-1.5 text-xs font-semibold shadow-sm"
      style="background: rgba(253,253,253,0.92); color: var(--color-ink-900);"
    >
      {m.map_expand()}
    </button>
  {:else}
    <button
      bind:this={closeButton}
      type="button"
      onclick={close}
      aria-label={m.map_collapse()}
      class="expand-btn absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full shadow-sm"
      style="background: rgba(253,253,253,0.92); color: var(--color-ink-900);"
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l8 8M14 6l-8 8" />
      </svg>
    </button>
  {/if}
</div>

<style>
  .map-frame {
    height: 45vh;
    min-height: 280px;
    max-height: 420px;
  }
  .map-frame--expanded {
    position: fixed;
    inset: 0;
    z-index: 70;
    height: 100vh;
    width: 100vw;
    border-radius: 0;
  }
  .expand-btn:focus-visible {
    outline: 2px solid var(--color-ink-900);
    outline-offset: 2px;
  }
</style>

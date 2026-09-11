<script lang="ts">
  import { onDestroy } from "svelte";
  import { browser } from "$app/environment";
  import { getLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import { prefersReducedMotion } from "$lib/reducedMotion";

  // Range is fractional months relative to Jan 2025 (idx 0). minIdx is the
  // animation start (May 2025, idx 4); maxIdx includes a small headroom past today so the last batch of
  // signings can fully fade in. labelMaxIdx is the value used to format the
  // displayed month — clamped to today so the label never reads "Jun 2026"
  // for headroom that doesn't correspond to real data.
  export let minIdx: number;
  export let maxIdx: number;
  export let labelMaxIdx: number = maxIdx;
  // Continuous cursor — bind from parent.
  export let cursorIdx: number;
  // Count of agreements visible at the current cursor (baseline + matched).
  export let countAtCursor: number;

  // Constant playback DURATION rather than constant speed: the sweep always
  // takes ~PLAY_DURATION seconds regardless of how many months the range
  // spans, so the per-month step slows as the span shrinks (e.g. a May-2025
  // start covers fewer months than a Jan-2025 one but plays for the same time).
  // 8s to match the baked map video's runtime.
  const PLAY_DURATION = 8;
  $: playSpeed = maxIdx > minIdx ? (maxIdx - minIdx) / PLAY_DURATION : 1;

  // Exported so the parent can drive a map overlay (visible while playing).
  export let playing = false;
  let rafId: number | null = null;
  let lastTimestamp = 0;

  const stop = () => {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    playing = false;
  };

  const tick = (now: number) => {
    const dt = lastTimestamp ? (now - lastTimestamp) / 1000 : 0;
    lastTimestamp = now;
    const next = cursorIdx + playSpeed * dt;
    if (next >= maxIdx) {
      cursorIdx = maxIdx;
      stop();
      return;
    }
    cursorIdx = next;
    rafId = requestAnimationFrame(tick);
  };

  const play = () => {
    if (playing) { stop(); return; }
    if (!browser) return;
    // Respect prefers-reduced-motion: skip the multi-second sweep and land
    // directly on the end state rather than animating through it.
    if ($prefersReducedMotion) {
      cursorIdx = maxIdx;
      return;
    }
    if (cursorIdx >= maxIdx) cursorIdx = minIdx;
    playing = true;
    lastTimestamp = 0;
    rafId = requestAnimationFrame(tick);
  };

  const onSlide = (e: Event) => {
    stop();
    cursorIdx = Number((e.target as HTMLInputElement).value);
  };

  // Restart from the beginning. Exposed so the parent can wire this to the
  // map's counter card (tap-to-replay).
  export const restart = () => {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    cursorIdx = minIdx;
    if (!browser) return;
    if ($prefersReducedMotion) {
      cursorIdx = maxIdx;
      return;
    }
    playing = true;
    lastTimestamp = 0;
    rafId = requestAnimationFrame(tick);
  };

  onDestroy(stop);

  const monthLabel = (idx: number): string => {
    // idx is months relative to Jan 2025 (idx 0); it can go negative once the
    // timeline reaches the pre-2025 era (e.g. Dec 2024 ≈ -0.45). Use a real
    // floored-division month so negatives map back to the right year/month.
    const month = Math.floor(idx);
    const y = 2025 + Math.floor(month / 12);
    const m = (((month % 12) + 12) % 12) + 1;
    const localeTag = getLocale() === "es" ? "es-MX" : "en-US";
    return new Intl.DateTimeFormat(localeTag, { month: "short", year: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(y, m - 1, 1)));
  };

  const intFmt = new Intl.NumberFormat();
</script>

<div class="flex w-full flex-col gap-2 px-4 py-3 sm:px-6">
  <div class="flex items-center gap-3">
    <button
      type="button"
      on:click={play}
      aria-label={playing ? "Pause timeline" : "Play timeline"}
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-900 text-white hover:bg-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-500"
    >
      {#if playing}
        <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor" aria-hidden="true">
          <rect x="5" y="4" width="3" height="12" rx="0.5"/>
          <rect x="12" y="4" width="3" height="12" rx="0.5"/>
        </svg>
      {:else}
        <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor" aria-hidden="true">
          <path d="M6 4.5v11l9-5.5z"/>
        </svg>
      {/if}
    </button>

    <!-- Padding-block around the input pads the *tap target* to ~44px even
         though the visual track/thumb stay modest — see thumb sizing below. -->
    <div class="w-full py-2.5">
      <input
        type="range"
        min={minIdx}
        max={maxIdx}
        step="0.05"
        value={cursorIdx}
        on:input={onSlide}
        aria-label="Scrub to month"
        class="h-2.5 w-full cursor-pointer appearance-none rounded-full bg-paper-200 accent-ink-900"
      />
    </div>

    <div class="shrink-0 text-right font-mono text-xs tabular-nums text-ink-700 sm:text-sm">
      <div class="font-semibold text-ink-900">{monthLabel(Math.min(cursorIdx, labelMaxIdx))}</div>
      <div class="text-[10px] uppercase tracking-wider text-ink-500 sm:text-xs">
        {intFmt.format(countAtCursor)} active
      </div>
    </div>
  </div>

  <p class="text-[11px] italic leading-snug text-ink-500 sm:text-xs">
    {m.home_map_caveat()}
  </p>
</div>

<style>
  /* Visual thumb is 28px (up from 16px) — still modest relative to the
     track, but combined with the input's py-2.5 wrapper above, the full tap
     target (thumb + surrounding padding) clears the ~44px touch-target
     guidance without the thumb itself dominating the control visually. */
  input[type="range"]::-webkit-slider-thumb {
    appearance: none;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--color-ink-900);
    cursor: pointer;
    border: 2px solid #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  }
  input[type="range"]::-moz-range-thumb {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--color-ink-900);
    cursor: pointer;
    border: 2px solid #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  }
</style>

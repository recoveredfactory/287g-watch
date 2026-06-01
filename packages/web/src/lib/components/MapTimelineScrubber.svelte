<script lang="ts">
  import { onDestroy } from "svelte";
  import { browser } from "$app/environment";
  import { getLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";

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

  // 1.7 idx/sec → ~10s to play the full 17-month span. Tuned to give the busy
  // months breathing room without dragging.
  const PLAY_SPEED = 1.7;

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
    const next = cursorIdx + PLAY_SPEED * dt;
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
    playing = true;
    lastTimestamp = 0;
    rafId = requestAnimationFrame(tick);
  };

  onDestroy(stop);

  const monthLabel = (idx: number): string => {
    const month = Math.max(0, Math.floor(idx));
    const y = 2025 + Math.floor(month / 12);
    const m = (month % 12) + 1;
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
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
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

    <input
      type="range"
      min={minIdx}
      max={maxIdx}
      step="0.05"
      value={cursorIdx}
      on:input={onSlide}
      aria-label="Scrub to month"
      class="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-900"
    />

    <div class="shrink-0 text-right font-mono text-xs tabular-nums text-slate-700 sm:text-sm">
      <div class="font-semibold text-slate-900">{monthLabel(Math.min(cursorIdx, labelMaxIdx))}</div>
      <div class="text-[10px] uppercase tracking-wider text-slate-500 sm:text-xs">
        {intFmt.format(countAtCursor)} active
      </div>
    </div>
  </div>

  <p class="text-[11px] italic leading-snug text-slate-500 sm:text-xs">
    {m.home_map_caveat()}
  </p>
</div>

<style>
  input[type="range"]::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #0f172a;
    cursor: pointer;
    border: 2px solid #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  }
  input[type="range"]::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #0f172a;
    cursor: pointer;
    border: 2px solid #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  }
</style>

<script lang="ts">
  // ── /video/national — map + trend social-video composite (#167) ────────────
  // A fixed 1080×1920 (9:16) canvas: NationalMap on top, the dark VideoTrendChart
  // below it (both pushed toward the top), a big counter in the open lower band,
  // and a provenance watermark in the corner. The bake script
  // (scripts/bake-map-trend-video.mjs) frame-steps it via window.__bake; storyboard
  // timing lives in $lib/video/storyboard so preview + bake agree.
  //
  // Visit /<locale>/video/national?preview for on-screen play/scrub controls
  // (excluded from the bake), and the whole 1080×1920 frame is scaled to fit the
  // viewport height so you can eyeball it without baking.
  import type { PageData } from "./$types";
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { getLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import NationalMap from "$lib/components/NationalMap.svelte";
  import VideoTrendChart from "$lib/components/VideoTrendChart.svelte";
  import {
    buildTimelineModel,
    activeCountAt,
    coveredPopAt,
    overlayExactDate,
  } from "$lib/timelineCursor";
  import { monthsToIdx, interpAt } from "$lib/trendSample";
  import { frameState, sceneLabel, TOTAL_SECONDS } from "$lib/video/storyboard";

  export let data: PageData;

  const intFmt = new Intl.NumberFormat();
  // Always one decimal (e.g. "5.0M", "48.4M") so the figure doesn't change width
  // as it crosses whole numbers during the run — a bare "5M" vs "5.1M" made the
  // centered secondary line jump horizontally.
  const popFmt = new Intl.NumberFormat(undefined, { notation: "compact", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  $: localeTag = getLocale() === "es" ? "es-MX" : "en-US";

  // Cursor-independent timeline derivations. Anchor the end to the data's
  // snapshot date, NOT wall-clock today — the clip is a dated artifact and
  // shouldn't imply data we don't have (the roster is "as of" the snapshot).
  // Falls back to now if there's no snapshot date.
  $: refDate = data.snapshotDate ? new Date(data.snapshotDate) : new Date();
  $: model = buildTimelineModel(data.agencies, data.terminatedAgencies, refDate);
  $: minIdx = model.minIdx;
  $: maxIdx = model.maxIdx;
  $: todayIdx = model.todayIdx;

  // Visual state, driven by the storyboard. Defaults are the "today" hold, so a
  // plain visit (no ?preview, not baking) shows the composed present-day frame.
  let cursorIdx = NaN;
  $: if (Number.isNaN(cursorIdx) && Number.isFinite(maxIdx)) cursorIdx = maxIdx;
  let veilOpacity = 0;

  $: countAtCursor = activeCountAt(model, cursorIdx);
  $: popAtCursor = coveredPopAt(model, cursorIdx);
  $: exactDate = Number.isFinite(cursorIdx) ? overlayExactDate(cursorIdx, todayIdx, localeTag) : "";

  // Total active agreements at the cursor = sum of the national model series,
  // interpolated the same way the chart's labels are (shared $lib/trendSample),
  // so the counter and the chart agree. Agreements ≥ agencies (multi-model).
  $: trendIdx = monthsToIdx(data.trendMonths);
  $: nat = data.trend[""] ?? { jail: [], taskforce: [], wso: [] };
  $: agreementsAtCursor =
    interpAt(nat.jail, trendIdx, cursorIdx) +
    interpAt(nat.taskforce, trendIdx, cursorIdx) +
    interpAt(nat.wso, trendIdx, cursorIdx);

  // Watermark data-freshness stamp (falls back to nothing if no snapshot).
  $: asOf = data.snapshotDate
    ? new Intl.DateTimeFormat(localeTag, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(data.snapshotDate))
    : "";

  // Apply the full visual state for a clip-time (seconds). Count/date recompute
  // synchronously from cursorIdx — no tween, so a frame-stepped bake never lags.
  function applyFrame(timeSeconds: number) {
    const fs = frameState(timeSeconds, minIdx, maxIdx);
    cursorIdx = fs.cursorIdx;
    veilOpacity = fs.veilOpacity;
  }

  // Bake hook: the script waits on ready(), reads bounds(), then seek()s each
  // frame. chartW>0 means VideoTrendChart has measured (its viewBox is width-driven).
  let chartW = 0;
  onMount(() => {
    (window as any).__bake = {
      ready: () =>
        (window as any).__mapReady === true && chartW > 0 && Number.isFinite(maxIdx),
      bounds: () => ({ minIdx, maxIdx, totalSeconds: TOTAL_SECONDS }),
      seek: (timeSeconds: number) => applyFrame(timeSeconds),
    };
    return () => {
      delete (window as any).__bake;
    };
  });

  // ── ?preview: scale-to-fit stage + play/scrub controls (never in the bake) ──
  $: previewMode = $page.url.searchParams.has("preview");
  let innerWidth = 0;
  let innerHeight = 0;
  // Fit the 1080×1920 canvas into the viewport for preview.
  $: previewScale = previewMode && innerWidth && innerHeight
    ? Math.min(innerWidth / 1080, innerHeight / 1920)
    : 1;

  let t = 0; // storyboard time, seconds
  let playing = false;
  let rafId = 0;
  let lastTs: number | null = null;

  function frame(ts: number) {
    if (lastTs == null) lastTs = ts;
    t = Math.min(TOTAL_SECONDS, t + (ts - lastTs) / 1000);
    lastTs = ts;
    applyFrame(t);
    if (t >= TOTAL_SECONDS) { playing = false; return; }
    rafId = requestAnimationFrame(frame);
  }
  function play() {
    if (t >= TOTAL_SECONDS) t = 0;
    playing = true;
    lastTs = null;
    rafId = requestAnimationFrame(frame);
  }
  function pause() {
    playing = false;
    cancelAnimationFrame(rafId);
  }
  function onScrub() {
    pause();
    applyFrame(t);
  }
</script>

<svelte:head>
  <title>287(g) Watch — national video frame</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<svelte:window bind:innerWidth bind:innerHeight />

<div class="vid-stage" class:vid-stage--preview={previewMode}>
  <div
    class="vid-canvas"
    data-video-canvas
    style:transform={previewMode ? `scale(${previewScale})` : "none"}
  >
    <!-- Title bar: brand lockup — 287(g) WATCH | ACTIVE AGREEMENTS -->
    <div class="vid-titlebar">
      <span class="vid-brand">287(g) Watch</span>
      <span class="vid-divider" aria-hidden="true">|</span>
      <span class="vid-headline">{m.video_title()}</span>
    </div>

    <!-- Map + chart, pushed to the top, with the date ticker between them -->
    <div class="vid-top">
      <div class="vid-map">
        <NationalMap agencies={data.agencies} terminatedAgencies={data.terminatedAgencies} {cursorIdx} lower48 />
      </div>
      <div class="vid-datestrip">{exactDate}</div>
      <div class="vid-chart" bind:clientWidth={chartW}>
        <VideoTrendChart trendMonths={data.trendMonths} trend={data.trend} {cursorIdx} height={520} />
      </div>
    </div>

    <!-- Counter: agencies as the hero, agreements + pop as secondary lines -->
    <div class="vid-counter">
      <div class="vid-hero-num">{intFmt.format(Math.round(countAtCursor))} <span class="vid-hero-unit">{m.video_agencies()}</span></div>
      <div class="vid-hero-sub">{m.video_agencies_sub()}</div>
      <div class="vid-secondary">
        {intFmt.format(Math.round(agreementsAtCursor))} <span class="vid-sec-unit">{m.video_agreements()}</span>
        <span class="vid-sec-div" aria-hidden="true">⁘</span>
        {popFmt.format(Math.max(0, popAtCursor))} <span class="vid-sec-unit">{m.video_pop_sub()}</span>
      </div>
    </div>

    <!-- Source, lower-left corner -->
    <div class="vid-source">{m.video_source()}</div>

    <!-- Provenance, lower-right corner (brand now lives in the title lockup) -->
    <div class="vid-watermark">
      <div class="vid-wm-url">287g.recoveredfactory.net</div>
      {#if asOf}<div class="vid-wm-meta">{m.video_data_as_of()} {asOf} · CC BY 4.0</div>{/if}
    </div>

    <!-- Vignette so the plain lower area reads less flat -->
    <div class="vid-vignette"></div>

    <!-- Crossfade veil for the fade transitions -->
    <div class="vid-veil" style:opacity={veilOpacity}></div>

    <!-- Preview controls (only with ?preview; excluded from the bake) -->
    {#if previewMode}
      <div class="vid-controls">
        <button type="button" class="vid-btn" on:click={() => (playing ? pause() : play())}>
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <input
          type="range"
          min="0"
          max={TOTAL_SECONDS}
          step="0.02"
          bind:value={t}
          on:input={onScrub}
          aria-label="Storyboard time"
        />
        <span class="vid-scene">{sceneLabel(t)} · {t.toFixed(1)}s / {TOTAL_SECONDS.toFixed(1)}s</span>
      </div>
    {/if}
  </div>
</div>

<style>
  /* Stage: invisible in the bake (display:contents), a scale-to-fit viewport in
     preview so the whole 1080×1920 frame is visible without scrolling. */
  .vid-stage {
    display: contents;
  }
  .vid-stage--preview {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: #000;
  }

  .vid-canvas {
    position: relative;
    width: 1080px;
    height: 1920px;
    overflow: hidden;
    background: #0c1117;
    color: #ffffff;
    display: flex;
    flex-direction: column;
    font-family: "Inter", system-ui, sans-serif;
    transform-origin: center center;
  }

  /* Title bar */
  .vid-titlebar {
    flex: 0 0 auto;
    display: flex;
    align-items: baseline;
    gap: 18px;
    padding: 30px 40px 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    font-family: "Inter", system-ui, sans-serif;
    font-size: 44px;
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .vid-brand {
    color: #be6079;
  }
  .vid-divider {
    color: rgba(255, 255, 255, 0.28);
    font-weight: 400;
  }
  .vid-headline {
    color: #ffffff;
  }

  /* Map + chart, pushed to the top */
  .vid-top {
    flex: 0 0 auto;
  }
  .vid-map {
    position: relative;
    height: 620px;
  }
  /* Hide MapLibre's on-canvas controls + attribution — the watermark carries
     attribution, and the zoom/nav chrome shouldn't bake into the video. */
  .vid-map :global(.maplibregl-ctrl-top-left),
  .vid-map :global(.maplibregl-ctrl-top-right),
  .vid-map :global(.maplibregl-ctrl-bottom-left),
  .vid-map :global(.maplibregl-ctrl-bottom-right) {
    display: none !important;
  }
  /* Date ticker, centered between the map and the chart */
  .vid-datestrip {
    text-align: center;
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 40px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #e2e8f0;
    padding: 18px 0 4px;
  }
  /* "A smidge narrower" than the map via horizontal padding */
  .vid-chart {
    padding: 6px 40px 0;
  }

  /* Counter: agencies is the hero; agreements + pop are secondary lines */
  .vid-counter {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding-bottom: 70px;
  }
  .vid-hero-num {
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 200px;
    font-weight: 800;
    line-height: 0.92;
    letter-spacing: -0.03em;
    color: #ffffff;
  }
  .vid-hero-unit {
    font-family: "Inter", system-ui, sans-serif;
    font-size: 42px;
    font-weight: 700;
    letter-spacing: 0;
    color: #cbd5e1;
  }
  .vid-hero-sub {
    margin-top: 4px;
    font-size: 32px;
    font-weight: 600;
    color: #94a3b8;
  }
  /* Agreements + pop, one line with a ⁘ separator */
  .vid-secondary {
    margin-top: 34px;
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 50px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #ffffff;
  }
  .vid-sec-unit {
    font-family: "Inter", system-ui, sans-serif;
    font-size: 32px;
    font-weight: 600;
    color: #cbd5e1;
  }
  .vid-sec-div {
    color: #64748b;
    margin: 0 0.5em;
    font-weight: 400;
  }

  /* Source credit, lower-left corner */
  .vid-source {
    position: absolute;
    left: 40px;
    bottom: 34px;
    z-index: 10;
    max-width: 540px;
    font-size: 20px;
    font-weight: 500;
    color: #94a3b8;
    line-height: 1.35;
    pointer-events: none;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
  }

  /* Watermark, lower-right corner of the canvas */
  .vid-watermark {
    position: absolute;
    right: 40px;
    bottom: 32px;
    text-align: right;
    line-height: 1.35;
    pointer-events: none;
    z-index: 10;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
  }
  .vid-wm-url {
    font-size: 22px;
    font-weight: 600;
    color: #cbd5e1;
  }
  .vid-wm-meta {
    font-size: 18px;
    color: #94a3b8;
  }

  /* Vignette — darkens the frame edges (esp. the plain lower band) so the
     composition focuses on the map + chart and the bottom doesn't read flat. */
  .vid-vignette {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 30;
    background: radial-gradient(ellipse 132% 104% at 50% 40%, transparent 56%, rgba(0, 0, 0, 0.55) 100%);
  }

  /* Crossfade veil */
  .vid-veil {
    position: absolute;
    inset: 0;
    background: #0c1117;
    pointer-events: none;
    z-index: 40;
  }

  /* Preview-only controls */
  .vid-controls {
    position: absolute;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 16px;
    width: 88%;
    padding: 14px 20px;
    border-radius: 14px;
    background: rgba(12, 17, 23, 0.92);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
  }
  .vid-controls input[type="range"] {
    flex: 1 1 auto;
  }
  .vid-btn {
    flex: 0 0 auto;
    padding: 10px 18px;
    border-radius: 10px;
    border: 0;
    background: #be6079;
    color: #ffffff;
    font-size: 22px;
    font-weight: 700;
    cursor: pointer;
  }
  .vid-scene {
    flex: 0 0 auto;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 20px;
    color: #e2e8f0;
    white-space: nowrap;
  }
</style>

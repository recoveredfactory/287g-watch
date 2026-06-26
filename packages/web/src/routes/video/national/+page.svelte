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
    signedIdx,
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

  // Distinct U.S. STATES with an active agency at the cursor — earliest signing
  // per state, counted in as the cursor passes it. Territories (Guam, N.
  // Mariana, etc.) are excluded from the count and called out in a footnote.
  const TERRITORY_CODES = new Set(["GU", "MP", "PR", "VI", "AS"]);
  $: earliestByState = (() => {
    const m: Record<string, number> = {};
    for (const a of data.agencies) {
      if (!a.state || TERRITORY_CODES.has(a.state)) continue;
      const idx = signedIdx(a.signed_date);
      if (!(a.state in m) || idx < m[a.state]) m[a.state] = idx;
    }
    return m;
  })();
  $: statesAtCursor = Object.values(earliestByState).filter((idx) => idx <= cursorIdx).length;

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

  // ── ?preview: phone-framed stage + side play/scrub controls (never in the
  // bake) ─────────────────────────────────────────────────────────────────────
  // The 1080×1920 canvas is scaled to fit and dropped inside a handset bezel,
  // with the controls in a panel beside it. Reserve room for the bezel and the
  // controls column so the phone never overlaps them.
  $: previewMode = $page.url.searchParams.has("preview");
  let innerWidth = 0;
  let innerHeight = 0;
  const BEZEL = 14; // handset bezel thickness around the screen (px)
  const PANEL_W = 300; // side controls column width (px)
  const STAGE_PAD = 32; // breathing room at the stage edges + gap (px)
  // Fit the 1080×1920 canvas into the space left after the bezel + controls.
  $: previewScale = previewMode && innerWidth && innerHeight
    ? Math.max(
        0.1,
        Math.min(
          (innerWidth - PANEL_W - STAGE_PAD * 3 - BEZEL * 2) / 1080,
          (innerHeight - STAGE_PAD * 2 - BEZEL * 2) / 1920,
        ),
      )
    : 1;
  // Pixel size of the scaled screen, so the bezel can wrap it tightly (a
  // transform: scale() leaves the layout box at 1080×1920, so we size the
  // wrapper ourselves and scale from the top-left corner).
  $: screenW = 1080 * previewScale;
  $: screenH = 1920 * previewScale;

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
  <!-- Phone frame: a thin handset bezel that wraps the scaled screen. Outside
       preview both wrappers collapse to display:contents so the bake sees the
       bare 1080×1920 canvas exactly as before. -->
  <div class="vid-phone" style:padding={previewMode ? `${BEZEL}px` : null}>
    <div
      class="vid-screen"
      style:width={previewMode ? `${screenW}px` : null}
      style:height={previewMode ? `${screenH}px` : null}
    >
      <div
        class="vid-canvas"
        data-video-canvas
        style:transform={previewMode ? `scale(${previewScale})` : "none"}
      >
    <!-- Title bar: centered brand wordmark -->
    <div class="vid-titlebar">
      <span class="vid-brand">287(g) Watch</span>
    </div>

    <!-- Hero: agencies is the headline number (ticks up to 1,616). The
         growth/delta line will slot in directly under the unit later. -->
    <div class="vid-hero">
      <div class="vid-hero-num">{intFmt.format(Math.round(countAtCursor))}</div>
      <div class="vid-hero-unit">{m.video_hero_unit()}</div>
    </div>

    <!-- Stat row: agreements · states · population covered (all tick) -->
    <div class="vid-statrow">
      <div class="vid-stat">
        <div class="vid-stat-num">{intFmt.format(Math.round(agreementsAtCursor))}</div>
        <div class="vid-stat-label">{m.video_agreements()}</div>
      </div>
      <div class="vid-stat-div" aria-hidden="true"></div>
      <div class="vid-stat">
        <div class="vid-stat-num">{statesAtCursor}</div>
        <div class="vid-stat-label">{m.video_states()}<span class="vid-ast">*</span></div>
      </div>
      <div class="vid-stat-div" aria-hidden="true"></div>
      <div class="vid-stat">
        <div class="vid-stat-num">{popFmt.format(Math.max(0, popAtCursor))}</div>
        <div class="vid-stat-label">{m.video_pop_sub()}</div>
      </div>
    </div>

    <!-- Territories footnote, keyed to the states asterisk -->
    <div class="vid-territories">*{m.video_territories_note()}</div>

    <!-- Date ticker -->
    <div class="vid-datestrip">{exactDate}</div>

    <!-- Trend chart: the climb, broken out by model -->
    <div class="vid-chart" bind:clientWidth={chartW}>
      <VideoTrendChart trendMonths={data.trendMonths} trend={data.trend} {cursorIdx} height={460} />
    </div>

    <!-- Map: supporting "where", a real beat in the bottom band -->
    <div class="vid-map">
      <NationalMap agencies={data.agencies} terminatedAgencies={data.terminatedAgencies} {cursorIdx} lower48 dotScale={1.3} />
    </div>

    <!-- Source, lower-left corner (over the map) -->
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
      </div>
    </div>
  </div>

  <!-- Preview controls (only with ?preview; excluded from the bake). A panel
       beside the phone rather than a bar over the frame. -->
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
      <div class="vid-readout">
        <span class="vid-scene">{sceneLabel(t)}</span>
        <span class="vid-time">{t.toFixed(1)}s / {TOTAL_SECONDS.toFixed(1)}s</span>
      </div>
    </div>
  {/if}
</div>

<style>
  /* Stage: invisible in the bake (display:contents), a centered desktop layout
     in preview — phone on the left, controls panel on the right. */
  .vid-stage {
    display: contents;
  }
  .vid-stage--preview {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 32px;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: radial-gradient(ellipse 90% 90% at 50% 30%, #1a2330, #0a0d12 70%);
  }

  /* Phone frame + screen: pass-through (no layout) outside preview so the bake
     captures the bare canvas. In preview, .vid-phone is the handset bezel and
     .vid-screen is the rounded, clipped viewport sized to the scaled canvas. */
  .vid-phone,
  .vid-screen {
    display: contents;
  }
  .vid-stage--preview .vid-phone {
    display: block;
    flex: 0 0 auto;
    border-radius: 44px;
    background: linear-gradient(160deg, #2a2f37, #14171c);
    box-shadow:
      0 0 0 2px rgba(255, 255, 255, 0.06) inset,
      0 24px 60px rgba(0, 0, 0, 0.6);
  }
  .vid-stage--preview .vid-screen {
    display: block;
    position: relative;
    overflow: hidden;
    border-radius: 32px;
    background: #0c1117;
  }
  /* In preview the screen sizes itself, so scale the canvas from the top-left
     corner to fill it exactly (no centering offset). */
  .vid-stage--preview .vid-canvas {
    transform-origin: top left;
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

  /* Title bar: centered brand wordmark */
  .vid-titlebar {
    flex: 0 0 auto;
    display: flex;
    align-items: baseline;
    justify-content: center;
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

  /* Map: the supporting bottom beat — flex-fills the height left under the
     numbers + chart, so the country still reads at a real size (not a
     thumbnail), with the source/watermark sitting over its lower corners. */
  .vid-map {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    /* Match the chart's left/right gutter so the two columns align, and the
       country reads a smidge smaller — less full-bleed-tight against the
       frame edges. MapLibre re-fits to the narrower width automatically. */
    padding: 0 40px;
  }
  /* Hide MapLibre's on-canvas controls + attribution — the watermark carries
     attribution, and the zoom/nav chrome shouldn't bake into the video. */
  .vid-map :global(.maplibregl-ctrl-top-left),
  .vid-map :global(.maplibregl-ctrl-top-right),
  .vid-map :global(.maplibregl-ctrl-bottom-left),
  .vid-map :global(.maplibregl-ctrl-bottom-right) {
    display: none !important;
  }
  /* Date ticker, centered above the chart */
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

  /* Hero: the agreements headline number, with its unit stacked tight below
     (no inline gap — the unit hugs the number). */
  .vid-hero {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 30px 40px 6px;
  }
  .vid-hero-num {
    /* Reserve room for the widest value (mono → 1ch is exact) so the number
       grows in place as it ticks past a digit instead of jolting the frame. */
    display: inline-block;
    min-width: 5ch;
    text-align: center;
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 172px;
    font-weight: 800;
    line-height: 0.9;
    letter-spacing: -0.03em;
    color: #ffffff;
  }
  .vid-hero-unit {
    margin-top: 10px;
    font-family: "Inter", system-ui, sans-serif;
    font-size: 42px;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: #cbd5e1;
  }

  /* Stat row: agencies · states · pop, thin dividers between */
  .vid-statrow {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 44px;
    padding: 18px 40px 0;
  }
  .vid-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .vid-stat-num {
    /* Same digit-width reservation as the hero, so the divider columns hold
       still as the stats tick past a digit (e.g. agreements 895 → 1,954). */
    display: inline-block;
    min-width: 5ch;
    text-align: center;
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 66px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.02em;
    color: #ffffff;
  }
  .vid-stat-label {
    margin-top: 6px;
    font-family: "Inter", system-ui, sans-serif;
    font-size: 28px;
    font-weight: 600;
    color: #94a3b8;
  }
  /* Footnote marker on the "states" label, keyed to the territories note */
  .vid-ast {
    vertical-align: super;
    font-size: 0.65em;
    color: #cbd5e1;
  }
  .vid-stat-div {
    width: 1px;
    align-self: stretch;
    margin: 6px 0;
    background: rgba(255, 255, 255, 0.12);
  }

  /* Territories footnote under the stat row (the +2 beyond the 38 states) */
  .vid-territories {
    flex: 0 0 auto;
    text-align: center;
    font-family: "Inter", system-ui, sans-serif;
    font-size: 24px;
    font-weight: 500;
    color: #64748b;
    padding: 14px 40px 0;
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

  /* Preview-only controls — a panel beside the phone */
  .vid-controls {
    flex: 0 0 auto;
    align-self: center;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 18px;
    width: 300px;
    padding: 22px;
    border-radius: 18px;
    background: rgba(12, 17, 23, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
  }
  .vid-controls input[type="range"] {
    width: 100%;
    accent-color: #be6079;
    cursor: pointer;
  }
  .vid-btn {
    padding: 12px 18px;
    border-radius: 10px;
    border: 0;
    background: #be6079;
    color: #ffffff;
    font-size: 22px;
    font-weight: 700;
    cursor: pointer;
  }
  .vid-readout {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    color: #e2e8f0;
  }
  .vid-scene {
    font-size: 18px;
    font-weight: 600;
  }
  .vid-time {
    font-size: 16px;
    color: #94a3b8;
    font-variant-numeric: tabular-nums;
  }
</style>

#!/usr/bin/env node
// Bake the homepage timeline animation to a high-quality .mp4 and .gif, plus
// the final frame as a standalone .png (the peak-data static image).
//
// Pipeline:
//   playwright   → load the live homepage, strip chrome, inject a title bar
//                  and swap the count-overlay label so the clip reads as
//                  "active 287(g) agreements" when shared standalone
//   frame-step   → drive cursorIdx via window.__setCursor(idx), screenshot
//                  the map section once per frame (rAF is not used; we don't
//                  rely on wall-clock to pace frames)
//   ffmpeg       → encode the PNG sequence to map.mp4 (h264) + map.gif
//                  (palettegen + paletteuse for size and quality)
//
// Usage:
//   pnpm bake:map-video
//   pnpm bake:map-video --url=http://localhost:5173/en
//   pnpm bake:map-video --fps=30 --duration=10
//   pnpm bake:map-video --skip-frames     # re-encode existing frames only
//   pnpm bake:map-video --keep-frames     # keep static/video/frames/ around
//   pnpm bake:map-video --as-of="May 28, 2026"  # pin the watermark date

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, rm, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { launchOptions, FRAME_EXT, frameShotOpts, assertRenderer } from "./bake-common.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Output to .assets/ (NOT static/) — these are big and belong in the asset
// bucket, not the site deploy. publish:map-assets uploads them. See #118.
const OUT_DIR = path.resolve(__dirname, "..", ".assets", "video");

// ---------- args ----------

const args = process.argv.slice(2);
const argValue = (flag) => {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

// Language of the cut. Controls the baked-in title/label/watermark text and the
// output filename suffix (map-en.*, map-es.*) — the video text is injected by
// this script, not read from the localized page, so each language is a separate
// bake. Point --url at the matching locale (…/en or …/es).
const LANG = argValue("--lang") ?? "en";
const STRINGS_BY_LANG = {
  en: { title: "Active 287(g) agreements", countLabel: "active 287(g) agreements", popLabel: "Pop. covered", dataAsOf: "Data as of", cardWidth: "32rem" },
  es: { title: "Acuerdos 287(g) activos", countLabel: "acuerdos 287(g) activos", popLabel: "Pob. cubierta", dataAsOf: "Datos al", cardWidth: "37rem" },
};
const STRINGS = STRINGS_BY_LANG[LANG] ?? STRINGS_BY_LANG.en;

// Per-language temp dirs/files so `en` and `es` bakes can run simultaneously
// without clobbering each other's frames or palette. Output files are already
// map-<lang>.{mp4,gif,png}.
const FRAMES_DIR = path.join(OUT_DIR, `frames-${LANG}`);

const URL = argValue("--url") ?? `https://287g.recoveredfactory.net/${LANG}`;
const FPS = Number(argValue("--fps") ?? 24);
const DURATION = Number(argValue("--duration") ?? 8);
// Defaults give a roughly square output (good for social): 1080 viewport
// width × map-height 1010 + title bar ~70 = ~1080 tall. Override either to
// push toward portrait (e.g. --map-height=1350) or landscape (--width=1440).
const VIEWPORT_W = Number(argValue("--width") ?? 1080);
// 750 keeps the US filling the frame vertically — its continental aspect is
// roughly 1.65:1, so 1080×750 has only a thin band of dark above/below for
// the count card and the legend's breathing room.
const MAP_HEIGHT = Number(argValue("--map-height") ?? 780);
const VIEWPORT_H = Number(argValue("--height") ?? MAP_HEIGHT + 200);
const KEEP_FRAMES = args.includes("--keep-frames");
const SKIP_FRAMES = args.includes("--skip-frames");
// --still: snapshot just the final frame to map-<lang>.png and skip the video
// encode entirely — a fast loop for checking composition.
const STILL = args.includes("--still");
const GIF_FPS = Math.min(FPS, 15);
const GIF_WIDTH = Number(argValue("--gif-width") ?? 800);
// Hold the final frame for this many seconds before the gif loops — gives
// readers a beat to absorb the final state instead of restarting instantly.
const GIF_HOLD = Number(argValue("--gif-hold") ?? 2);
// Static provenance watermark baked into every frame (bottom-right, over the
// Atlantic). Carries what the title bar doesn't: a findable source URL, the
// data as-of date, and the license — so the clip stays attributable when it
// circulates detached from the page. The count card's month label is the
// animated timeline cursor, NOT this; the two are independent on purpose.
// --as-of defaults to today (re-cuts follow an ingest), override to pin it.
const AS_OF =
  argValue("--as-of") ??
  new Date().toLocaleDateString(LANG === "es" ? "es-MX" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

const TOTAL_FRAMES = Math.round(FPS * DURATION);

await mkdir(OUT_DIR, { recursive: true });

const exists = async (p) => {
  try { await access(p); return true; } catch { return false; }
};

// ---------- bail check: ffmpeg ----------

await new Promise((resolve, reject) => {
  const p = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
  p.on("error", () => reject(new Error("ffmpeg not found on PATH — install ffmpeg first")));
  p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg -version exited ${code}`))));
});

// ---------- frames ----------

if (!SKIP_FRAMES) {
  await rm(FRAMES_DIR, { recursive: true, force: true });
  await mkdir(FRAMES_DIR, { recursive: true });

  console.log(`[snap] launching chromium…`);
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  console.log(`[snap] loading ${URL}…`);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60_000 });

  console.log(`[snap] waiting for map…`);
  try {
    await page.waitForFunction(() => window.__mapReady === true, { timeout: 30_000 });
  } catch {
    console.log(`[snap] no map-ready signal in 30s; pressing on anyway`);
  }
  await page.waitForFunction(
    () => typeof window.__setCursor === "function" && typeof window.__getTimelineBounds === "function",
    { timeout: 15_000 },
  );

  // Strip chrome, scrubber, supporting banners; swap label; inject title bar
  // with legend; widen count card so the longer label fits.
  // Runs after the map mounts so .maplibregl-canvas and the scrubber DOM exist.
  await page.evaluate(({ mapHeight, asOf, strings }) => {
    (window).__BAKE_MAP_HEIGHT__ = mapHeight;
    const kill = (sel) =>
      document.querySelectorAll(sel).forEach((el) => el.remove());
    kill(".maplibregl-ctrl-attrib");
    kill(".maplibregl-ctrl-bottom-right");
    kill(".maplibregl-ctrl-bottom-left");
    kill(".maplibregl-ctrl-top-right");
    kill(".maplibregl-ctrl-top-left");
    kill('[aria-label="Support Recovered Factory"]');
    kill('[role="complementary"].fixed');
    kill(".fixed.bottom-0.left-0.right-0.z-50");
    kill("header"); // site nav
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      const fixedOrSticky = cs.position === "fixed" || cs.position === "sticky";
      if (fixedOrSticky && (cs.top === "0px" || cs.bottom === "0px")) el.remove();
    }

    const mapSection = [...document.querySelectorAll("section")].find((s) =>
      s.querySelector(".maplibregl-canvas"),
    );
    if (!mapSection) return;

    // Kill everything above the map section so the bar lands at y=0.
    let prev = mapSection.previousElementSibling;
    while (prev) { const p = prev.previousElementSibling; prev.remove(); prev = p; }
    let next = mapSection.nextElementSibling;
    while (next) { const n = next.nextElementSibling; next.remove(); next = n; }

    // The clipping wrapper that owns the map canvas + count overlay — this
    // is what we crop to (no white margins around it). It's a direct child
    // of the section. We can't use `closest("div.relative")` from the canvas
    // because that would match MapLibre's own .maplibregl-map first.
    const mapDiv = [...mapSection.children].find(
      (c) =>
        c.tagName === "DIV" &&
        c.classList.contains("relative") &&
        c.classList.contains("overflow-hidden"),
    );
    if (!mapDiv) return;
    mapDiv.setAttribute("data-bake-map", "");

    // Drop the scrubber subtree (input[type=range] sits inside <div class="bg-white">).
    mapSection.querySelectorAll('input[type="range"]').forEach((input) => {
      const wrap = input.closest("div.bg-white") ?? input.closest("div");
      if (wrap && wrap !== mapSection) wrap.remove();
    });

    // Pull the legend out of the heading row so we can re-mount it inside the
    // dark title bar (right-aligned). The heading row has the h2 in one child
    // div and the legend in the sibling — detach the legend, then drop the
    // whole heading wrapper (mx-auto.max-w-6xl div, NOT the section).
    const headingFlexRow =
      mapSection.querySelector("h2")?.parentElement?.parentElement;
    const headingBlock = mapSection.querySelector("h2")?.parentElement;
    const legendBlock =
      headingFlexRow && headingBlock
        ? [...headingFlexRow.children].find((c) => c !== headingBlock) ?? null
        : null;
    if (legendBlock?.parentElement) legendBlock.parentElement.removeChild(legendBlock);
    const headerWrapper = headingFlexRow?.parentElement;
    if (headerWrapper && headerWrapper !== mapSection) headerWrapper.remove();

    // Recolor the legend for the dark bar.
    if (legendBlock) {
      legendBlock.style.color = "#e2e8f0";
      legendBlock.style.alignItems = "flex-end";
      legendBlock.style.textAlign = "right";
      // Push each legend row (model swatches, size circles) hard to the right
      // edge so the wrapped rows stack cleanly under the title bar's right side.
      legendBlock.querySelectorAll(":scope > div").forEach((row) => {
        row.style.justifyContent = "flex-end";
      });
      legendBlock.querySelectorAll("span").forEach((s) => {
        // Don't touch the colored swatches (they have inline background style).
        if (!s.style.background) {
          s.style.color = "#e2e8f0";
        }
      });
      // The size-circles use bg-slate-400 — bump to a lighter shade so the
      // circles read on black.
      legendBlock.querySelectorAll("span.bg-slate-400").forEach((s) => {
        s.style.background = "#94a3b8";
      });
    }

    // Swap count overlay label so the running counter is self-explanatory,
    // and widen / wrap the card so "active 287(g) agreements" doesn't
    // overflow on top of "Pop. covered". Bump type sizes for video legibility.
    // Move the counter/month block to the lower-LEFT (over Alaska's inset —
    // fine for now); brand + watermark stay lower-right, so no collision. Month
    // goes ABOVE the card — count-date is a sibling AFTER the card in the
    // overlay, so reorder it to the front.
    mapSection.querySelectorAll(".count-overlay").forEach((el) => {
      el.style.top = "auto";
      el.style.right = "auto";
      el.style.left = "1.6rem";
      el.style.bottom = "14px"; // baseline-align with the watermark (bottom:14px)
      el.style.alignItems = "flex-start";
      const date = el.querySelector(".count-date");
      const card = el.querySelector(".count-card");
      if (date && card) el.insertBefore(date, card);
    });
    mapSection.querySelectorAll(".count-card").forEach((el) => {
      el.style.width = strings.cardWidth; // wider for es so the label stays 2 lines
      el.style.padding = "1.4rem 1.8rem 1.5rem";
      el.style.borderRadius = "0.9rem";
    });
    mapSection.querySelectorAll(".count-number").forEach((el) => {
      el.style.fontSize = "4.2rem";
    });
    mapSection.querySelectorAll(".count-label").forEach((el) => {
      const txt = (el.textContent ?? "").trim();
      if (txt === "agencies") {
        el.textContent = strings.countLabel;
      } else if (txt === "Pop. covered") {
        el.textContent = strings.popLabel;
      }
      el.style.whiteSpace = "normal";
      el.style.lineHeight = "1.15";
      el.style.minHeight = "2em"; // keep both stats vertically aligned
      el.style.fontSize = "1.35rem";
      el.style.marginTop = "0.5rem";
    });
    // Month, now above the counter.
    mapSection.querySelectorAll(".count-date").forEach((el) => {
      el.style.fontSize = "1.7rem";
      el.style.fontWeight = "700";
      el.style.margin = "0 0 0.55rem";
    });

    // Build the title bar: 287(g) Watch eyebrow + headline on the left,
    // legend on the right. Inserted as a sibling above the map div so the
    // MapLibre container doesn't get reparented (and resize-observer doesn't
    // freak out). The bar matches the map div's width.
    const bar = document.createElement("div");
    bar.setAttribute("data-bake-title", "");
    bar.style.cssText = [
      "background: #0c1117",
      "color: #ffffff",
      "padding: 14px 30px 12px",
      "display: flex",
      "align-items: center",
      "justify-content: space-between",
      "gap: 32px",
      "font-family: 'Inter', system-ui, sans-serif",
      "box-sizing: border-box",
    ].join(";");
    const titleCol = document.createElement("div");
    titleCol.style.cssText = "display:flex;flex-direction:column;gap:3px;";
    // No eyebrow — the "287(g) Watch" brand moves to the lower-right (above the
    // watermark). Headline ~25% bigger.
    titleCol.innerHTML = `
      <div style="font-family:'Bitter',Georgia,serif;font-size:65px;font-weight:700;line-height:1.06;color:#ffffff;">${strings.title}</div>
    `;
    bar.appendChild(titleCol);
    if (legendBlock) {
      legendBlock.setAttribute("data-bake-legend", "");
      bar.appendChild(legendBlock);
    }

    // Force legend text up to 15px (Tailwind class text-sm = 14px would
    // otherwise win over an inline style on the wrapper).
    const styleTag = document.createElement("style");
    styleTag.textContent = `
      [data-bake-legend], [data-bake-legend] span { font-size: 26px !important; }
    `;
    document.head.appendChild(styleTag);

    mapDiv.parentNode.insertBefore(bar, mapDiv);
    // Strip the map div's top margin/border so the bar sits flush.
    mapDiv.style.marginTop = "0";
    mapDiv.style.borderTopWidth = "0";
    mapDiv.style.borderBottomWidth = "0";
    // Strip the section's top padding so the bar starts at y=0.
    mapSection.style.paddingTop = "0";
    // Override the responsive Tailwind height so the output can be square /
    // portrait. Use !important to beat any class-level rule. MapLibre's
    // ResizeObserver picks up the new container height.
    const targetH = window.__BAKE_MAP_HEIGHT__ ?? 1010;
    mapDiv.style.setProperty("height", `${targetH}px`, "important");

    // Provenance watermark, anchored to the map div's bottom-right corner
    // (mapDiv is position:relative). Two muted lines with a soft shadow so
    // they hold up over both dark ocean and the lighter landmass as the
    // cursor sweeps. pointer-events:none keeps it inert.
    const wm = document.createElement("div");
    wm.setAttribute("data-bake-watermark", "");
    wm.style.cssText = [
      "position: absolute",
      "right: 18px",
      "bottom: 14px",
      "z-index: 30",
      "text-align: right",
      "line-height: 1.4",
      "pointer-events: none",
      "font-family: 'Inter', system-ui, sans-serif",
      "text-shadow: 0 1px 3px rgba(0,0,0,0.9)",
    ].join(";");
    wm.innerHTML = `
      <div style="font-size:40px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#BE6079;text-shadow:0 2px 7px rgba(0,0,0,0.95),0 0 2px rgba(0,0,0,0.8);margin-bottom:6px;line-height:1;">287(g) Watch</div>
      <div style="font-size:20px;font-weight:600;color:#cbd5e1;letter-spacing:0.01em;">287g.recoveredfactory.net</div>
      <div style="font-size:16px;font-weight:400;color:#94a3b8;letter-spacing:0.02em;">${strings.dataAsOf} ${asOf} &middot; CC BY 4.0</div>
    `;
    mapDiv.appendChild(wm);

    document.body.style.background = "#ffffff";
  }, { mapHeight: MAP_HEIGHT, asOf: AS_OF, strings: STRINGS });

  // Wait for MapLibre to reflow into the new container height. ResizeObserver
  // fires, the canvas resizes, then we need a paint before measuring.
  await page.waitForTimeout(800);
  const debug = await page.evaluate(() => {
    const d = document.querySelector("[data-bake-map]");
    return { styleH: d?.style.height, rectH: Math.round(d?.getBoundingClientRect().height ?? 0) };
  });
  console.log(`[debug] mapDiv style.height=${debug.styleH} rect.height=${debug.rectH}`);

  const bounds = await page.evaluate(() => window.__getTimelineBounds());
  console.log(`[bounds] minIdx=${bounds.minIdx} maxIdx=${bounds.maxIdx.toFixed(2)} todayIdx=${bounds.todayIdx.toFixed(2)}`);

  // Crop the screenshot to bar+map only — no surrounding white margins.
  // Locator returns the bounding box; we union the title bar with the map div.
  // First scroll the bar to the top of the viewport so the clip rect fits
  // inside the viewport (page.screenshot clips against the viewport, not the
  // full page).
  const bar = page.locator("[data-bake-title]").first();
  const mapBox = page.locator("[data-bake-map]").first();
  await bar.waitFor({ state: "visible" });
  await mapBox.waitFor({ state: "visible" });
  await page.evaluate(() => {
    const b = document.querySelector("[data-bake-title]");
    b?.scrollIntoView({ block: "start", behavior: "instant" });
    window.scrollBy(0, -8); // shave a hair so anti-aliasing edge isn't clipped
  });
  await page.waitForTimeout(200);
  const barRect = await bar.boundingBox();
  const mapRect = await mapBox.boundingBox();
  if (!barRect || !mapRect) throw new Error("title bar or map div not visible");
  const clip = {
    x: Math.round(Math.min(barRect.x, mapRect.x)),
    y: Math.round(Math.min(barRect.y, mapRect.y)),
    width: Math.round(Math.max(barRect.x + barRect.width, mapRect.x + mapRect.width)
      - Math.min(barRect.x, mapRect.x)),
    height: Math.round(Math.max(barRect.y + barRect.height, mapRect.y + mapRect.height)
      - Math.min(barRect.y, mapRect.y)),
  };
  console.log(`[snap] clip ${clip.width}x${clip.height} at (${clip.x},${clip.y})`);

  await assertRenderer(page);

  // --still: just the final state (cursor at maxIdx) → PNG, then bail. Fast
  // composition check without the frame sweep + encode.
  if (STILL) {
    await page.evaluate((v) => window.__setCursor(v), bounds.maxIdx);
    await page.waitForTimeout(300);
    const stillPath = path.join(OUT_DIR, `map-${LANG}.png`);
    await page.screenshot({ path: stillPath, clip });
    await browser.close();
    await rm(FRAMES_DIR, { recursive: true, force: true });
    console.log(`\n✓ ${stillPath} (still)`);
    process.exit(0);
  }

  // Frame-step. We sweep from minIdx to maxIdx evenly across TOTAL_FRAMES.
  // A small post-set delay lets the map repaint before we screenshot.
  const t0 = Date.now();
  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const t = TOTAL_FRAMES === 1 ? 1 : i / (TOTAL_FRAMES - 1);
    const idx = bounds.minIdx + (bounds.maxIdx - bounds.minIdx) * t;
    await page.evaluate((v) => window.__setCursor(v), idx);
    await page.waitForTimeout(20);
    const frameName = `frame_${String(i).padStart(5, "0")}.${FRAME_EXT}`;
    await page.screenshot({ path: path.join(FRAMES_DIR, frameName), clip, ...frameShotOpts() });
    if ((i + 1) % 30 === 0 || i === TOTAL_FRAMES - 1) {
      const elapsed = (Date.now() - t0) / 1000;
      process.stdout.write(`  ${i + 1}/${TOTAL_FRAMES} (${elapsed.toFixed(1)}s)\r`);
    }
  }
  console.log(`\n[snap] ${TOTAL_FRAMES} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  // Lossless final still (PNG, peak state) — the sweep frames are JPEG now, so
  // capture this straight from the live canvas. Cursor is already at maxIdx.
  await page.screenshot({ path: path.join(OUT_DIR, `map-${LANG}.png`), clip });
  await browser.close();
} else {
  if (!(await exists(FRAMES_DIR))) {
    throw new Error(`--skip-frames: ${FRAMES_DIR} doesn't exist; run without --skip-frames first`);
  }
  console.log(`[snap] --skip-frames: reusing ${FRAMES_DIR}`);
}

// ---------- encode ----------

const run = (cmd, argv) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });

const FRAME_GLOB = path.join(FRAMES_DIR, `frame_%05d.${FRAME_EXT}`);
const MP4_PATH = path.join(OUT_DIR, `map-${LANG}.mp4`);
const GIF_PATH = path.join(OUT_DIR, `map-${LANG}.gif`);
const PALETTE_PATH = path.join(OUT_DIR, `_palette-${LANG}.png`);

console.log(`[mp4] encoding ${MP4_PATH}…`);
await run("ffmpeg", [
  "-y",
  "-framerate", String(FPS),
  "-i", FRAME_GLOB,
  "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-crf", "18",
  "-preset", "slow",
  "-movflags", "+faststart",
  MP4_PATH,
]);

// tpad clones the last frame for GIF_HOLD seconds, so the gif holds on the
// final state before looping. Applied to both palettegen and paletteuse so
// the palette includes the hold frame and the output actually contains it.
const TAIL_HOLD = `tpad=stop_duration=${GIF_HOLD}:stop_mode=clone`;

console.log(`[gif] palettegen…`);
await run("ffmpeg", [
  "-y",
  "-framerate", String(FPS),
  "-i", FRAME_GLOB,
  "-vf", `${TAIL_HOLD},fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff`,
  PALETTE_PATH,
]);

console.log(`[gif] paletteuse → ${GIF_PATH}…`);
await run("ffmpeg", [
  "-y",
  "-framerate", String(FPS),
  "-i", FRAME_GLOB,
  "-i", PALETTE_PATH,
  "-lavfi",
  `${TAIL_HOLD},fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5`,
  GIF_PATH,
]);

// The final static image (peak data) is captured losslessly from the live
// canvas during the sweep (above). With --skip-frames there was no live capture,
// so derive it from the last (JPEG) frame instead.
const PNG_PATH = path.join(OUT_DIR, `map-${LANG}.png`);
if (!(await exists(PNG_PATH))) {
  const lastFrame = path.join(FRAMES_DIR, `frame_${String(TOTAL_FRAMES - 1).padStart(5, "0")}.${FRAME_EXT}`);
  await run("ffmpeg", ["-y", "-i", lastFrame, PNG_PATH]);
}

await rm(PALETTE_PATH, { force: true });
if (!KEEP_FRAMES) await rm(FRAMES_DIR, { recursive: true, force: true });

console.log(`\n✓ ${MP4_PATH}`);
console.log(`✓ ${GIF_PATH}`);
console.log(`✓ ${PNG_PATH}`);
process.exit(0);

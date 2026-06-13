#!/usr/bin/env node
// Bake the vertical (9:16, 1080×1920) map + trend "dream video" (#167) to a
// high-quality .mp4, plus the final frame as a standalone .png.
//
// Unlike bake-map-video.mjs (the square, map-only cut), this loads a DEDICATED
// route — /<lang>/video/national — that already renders the exact composition
// (NationalMap on top, TrendCharts with a synced playhead below, big-numbers
// overlay, watermark). No DOM surgery: the route is WYSIWYG and the layout
// chrome is suppressed for it in +layout.svelte.
//
// Pipeline:
//   playwright   → load the route, wait for window.__bake.ready()
//   frame-step   → window.__bake.seek(tSeconds) per frame, screenshot the
//                  [data-video-canvas] element (rAF is not used; we don't pace
//                  frames against wall-clock)
//   ffmpeg       → encode the PNG sequence to map-trend-<lang>.mp4 (h264)
//
// Storyboard timing comes from the page (window.__bake.bounds().totalSeconds,
// defined in src/lib/video/storyboard.ts) — there is no --duration flag.
//
// Usage:
//   pnpm bake:map-trend-video
//   pnpm bake:map-trend-video --url=http://localhost:5173/en/video/national
//   pnpm bake:map-trend-video --lang=es
//   pnpm bake:map-trend-video --fps=30
//   pnpm bake:map-trend-video --skip-frames   # re-encode existing frames only
//   pnpm bake:map-trend-video --keep-frames   # keep .assets/video/frames-* around
//   pnpm bake:map-trend-video --still         # just the final frame → .png

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, rm, access, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Output to .assets/ (NOT static/) — big files belong in the asset bucket, not
// the site deploy. publish-map-assets uploads them. See #118.
const OUT_DIR = path.resolve(__dirname, "..", ".assets", "video");

// ---------- args ----------

const args = process.argv.slice(2);
const argValue = (flag) => {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

// Language of the cut — controls the output filename suffix (map-trend-en.*,
// map-trend-es.*) and which locale URL we load. The route is fully localized,
// so point --url at the matching locale (…/en/video/national or …/es/…).
const LANG = argValue("--lang") ?? "en";
const FRAMES_DIR = path.join(OUT_DIR, `frames-trend-${LANG}`);

const URL = argValue("--url") ?? `https://287g.recoveredfactory.net/${LANG}/video/national`;
const FPS = Number(argValue("--fps") ?? 30);
// 9:16, the format for Reels / Shorts / TikTok.
const VIEWPORT_W = Number(argValue("--width") ?? 1080);
const VIEWPORT_H = Number(argValue("--height") ?? 1920);
const KEEP_FRAMES = args.includes("--keep-frames");
const SKIP_FRAMES = args.includes("--skip-frames");
// --still: snapshot a single representative frame (the intro "today" hold) to
// map-trend-<lang>.png and skip the encode — a fast composition check.
const STILL = args.includes("--still");

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

// TOTAL_FRAMES is derived from the page's storyboard once we know totalSeconds.
let TOTAL_FRAMES = 0;

// ---------- frames ----------

if (!SKIP_FRAMES) {
  await rm(FRAMES_DIR, { recursive: true, force: true });
  await mkdir(FRAMES_DIR, { recursive: true });

  console.log(`[snap] launching chromium…`);
  const browser = await chromium.launch({
    args: [
      "--use-angle=swiftshader",
      "--use-gl=angle",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      // Headless Chromium (esp. WSL/containers) gives /dev/shm only ~64MB; the
      // WebGL map + per-frame screenshots overrun it and the renderer dies with
      // "Target crashed". Route shared memory to /tmp instead.
      "--disable-dev-shm-usage",
      "--no-sandbox",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  console.log(`[snap] loading ${URL}…`);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60_000 });

  console.log(`[snap] waiting for map + chart (window.__bake.ready)…`);
  try {
    await page.waitForFunction(() => window.__mapReady === true, { timeout: 30_000 });
  } catch {
    console.log(`[snap] no map-ready signal in 30s; pressing on anyway`);
  }
  await page.waitForFunction(
    () => typeof window.__bake?.seek === "function" && typeof window.__bake?.bounds === "function",
    { timeout: 15_000 },
  );
  // Wait until the page reports everything measured + ready (chart width, map).
  try {
    await page.waitForFunction(() => window.__bake.ready() === true, { timeout: 15_000 });
  } catch {
    console.log(`[snap] __bake.ready() never went true in 15s; pressing on anyway`);
  }
  // One extra settle so MapLibre's first idle paint and the chart's width-driven
  // viewBox are committed before the first capture.
  await page.waitForTimeout(600);

  const bounds = await page.evaluate(() => window.__bake.bounds());
  const totalSeconds = Number(bounds.totalSeconds);
  TOTAL_FRAMES = Math.max(1, Math.round(FPS * totalSeconds));
  console.log(
    `[bounds] minIdx=${bounds.minIdx.toFixed(2)} maxIdx=${bounds.maxIdx.toFixed(2)} ` +
      `totalSeconds=${totalSeconds} → ${TOTAL_FRAMES} frames @ ${FPS}fps`,
  );

  const canvas = page.locator("[data-video-canvas]").first();
  await canvas.waitFor({ state: "visible" });

  // --still: a single representative frame → PNG, then bail. Fast composition
  // check without the sweep + encode. --at=<seconds> picks the storyboard time
  // (default 0 = intro hold = today); e.g. --at=6 lands mid-run.
  if (STILL) {
    const at = Number(argValue("--at") ?? 0);
    await page.evaluate((v) => window.__bake.seek(v), at);
    await page.waitForTimeout(300);
    const stillPath = path.join(OUT_DIR, `map-trend-${LANG}.png`);
    await canvas.screenshot({ path: stillPath });
    await browser.close();
    await rm(FRAMES_DIR, { recursive: true, force: true });
    console.log(`\n✓ ${stillPath} (still)`);
    process.exit(0);
  }

  // Frame-step across the whole storyboard. A small post-seek delay lets Svelte
  // commit the DOM update and MapLibre repaint before the screenshot.
  const t0 = Date.now();
  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const t = TOTAL_FRAMES === 1 ? 0 : (i / (TOTAL_FRAMES - 1)) * totalSeconds;
    await page.evaluate((v) => window.__bake.seek(v), t);
    await page.waitForTimeout(30);
    const frameName = `frame_${String(i).padStart(5, "0")}.png`;
    await canvas.screenshot({ path: path.join(FRAMES_DIR, frameName) });
    if ((i + 1) % 30 === 0 || i === TOTAL_FRAMES - 1) {
      const elapsed = (Date.now() - t0) / 1000;
      process.stdout.write(`  ${i + 1}/${TOTAL_FRAMES} (${elapsed.toFixed(1)}s)\r`);
    }
  }
  console.log(`\n[snap] ${TOTAL_FRAMES} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await browser.close();
} else {
  if (!(await exists(FRAMES_DIR))) {
    throw new Error(`--skip-frames: ${FRAMES_DIR} doesn't exist; run without --skip-frames first`);
  }
  console.log(`[snap] --skip-frames: reusing ${FRAMES_DIR}`);
  // Count existing frames so the encoder's glob and the final-frame copy line up.
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(FRAMES_DIR)).filter((f) => /^frame_\d+\.png$/.test(f));
  TOTAL_FRAMES = files.length;
  if (!TOTAL_FRAMES) throw new Error(`--skip-frames: no frames in ${FRAMES_DIR}`);
}

// ---------- encode ----------

const run = (cmd, argv) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });

const FRAME_GLOB = path.join(FRAMES_DIR, "frame_%05d.png");
const MP4_PATH = path.join(OUT_DIR, `map-trend-${LANG}.mp4`);

console.log(`[mp4] encoding ${MP4_PATH}…`);
await run("ffmpeg", [
  "-y",
  "-framerate", String(FPS),
  "-i", FRAME_GLOB,
  // 1080×1920 are already even; the filter is a no-op safeguard for h264.
  "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-crf", "18",
  "-preset", "slow",
  "-movflags", "+faststart",
  MP4_PATH,
]);

// Also emit the final frame as a standalone static image — the "today" hold
// (full data). Copied straight from the captured PNG so it stays lossless.
const PNG_PATH = path.join(OUT_DIR, `map-trend-${LANG}.png`);
const lastFramePath = path.join(
  FRAMES_DIR,
  `frame_${String(TOTAL_FRAMES - 1).padStart(5, "0")}.png`,
);
await copyFile(lastFramePath, PNG_PATH);

if (!KEEP_FRAMES) await rm(FRAMES_DIR, { recursive: true, force: true });

console.log(`\n✓ ${MP4_PATH}`);
console.log(`✓ ${PNG_PATH}`);
process.exit(0);

#!/usr/bin/env node
// Bake the "287(g) network keeps expanding" graphic (feat/surge-map-graphic) to
// email/social assets, in FOUR variants of the dedicated route
// /<lang>/video/surge?variant=…:
//
//   card              9:16 (1080×1920) full composition   → GIF + MP4
//   states-portrait   2×3  (1080×1440) state mini-maps     → GIF
//   states-landscape  3×2  (1500×1000) state mini-maps     → GIF
//   nation            8:5  (1280×800)  national map + band → GIF
//
// For each variant the script frame-steps window.__bake.seek(progress 0..1) to
// reveal the new (orange) dots over the old (slate) baseline in signing order —
// synced to the on-canvas Apr→Jul timeline — screenshots [data-surge-canvas] per
// frame, then encodes a palette-quantized GIF (+ an h264 MP4 for the card), with
// a short tail-hold before the loop. It also captures three review stills per
// variant (progress 0 / 0.5 / 1).
//
// Deliverables (copied to --scratch, if given) are named 287g-expansion-*:
//   287g-expansion-card.gif / .mp4
//   287g-expansion-states-portrait.gif
//   287g-expansion-states-landscape.gif
//   287g-expansion-nation.gif
//   review-<variant>-{old,mid,final}.png
//
// Usage:
//   pnpm bake:surge
//   pnpm bake:surge --base=http://localhost:5185 --scratch=/path/to/scratch
//   pnpm bake:surge --only=card
//   pnpm bake:surge --lang=es --fps=15 --duration=2.6

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, rm, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { launchOptions, FRAME_EXT, frameShotOpts, assertRenderer } from "./bake-common.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", ".assets", "video");

const args = process.argv.slice(2);
const argValue = (flag) => {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

const LANG = argValue("--lang") ?? "en";
const BASE = argValue("--base") ?? "http://localhost:5185";
const FPS = Number(argValue("--fps") ?? 15);
const DURATION = Number(argValue("--duration") ?? 2.6); // reveal sweep, seconds
const GIF_HOLD = Number(argValue("--gif-hold") ?? 2); // tail-hold before loop, seconds
const KEEP_FRAMES = args.includes("--keep-frames");
const ONLY = argValue("--only"); // bake a single variant
const SCRATCH = argValue("--scratch");
const TOTAL_FRAMES = Math.max(2, Math.round(FPS * DURATION));
const DELIVER = "287g-expansion"; // deliverable filename stem (no "surge")

// Per-variant canvas size + output plan. The old ≤800px GIF cap is lifted —
// deliverables may run up to ~2 MB — so GIF widths are bumped for crispness and
// tuned per variant to stay under that ceiling (the card, a tall 9:16, is the
// pixel-heaviest so it gets the smallest downscale). MP4 carries full quality.
// The map variants get a longer per-frame settle for MapLibre's software
// (swiftshader) repaint.
const VARIANTS = {
  card: { w: 1080, h: 1920, gifWidth: 640, mp4: true, map: true },
  "states-portrait": { w: 1080, h: 1440, gifWidth: 900, mp4: false, map: false },
  "states-landscape": { w: 1500, h: 1000, gifWidth: 1080, mp4: false, map: false },
  nation: { w: 1280, h: 800, gifWidth: 1000, mp4: false, map: true },
};
const VARIANT_LIST = ONLY ? [ONLY] : Object.keys(VARIANTS);

await mkdir(OUT_DIR, { recursive: true });
if (SCRATCH) await mkdir(SCRATCH, { recursive: true });

// ── ffmpeg presence ───────────────────────────────────────────────────────────
await new Promise((resolve, reject) => {
  const p = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
  p.on("error", () => reject(new Error("ffmpeg not found on PATH — install ffmpeg first")));
  p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg -version exited ${code}`))));
});

const run = (cmd, argv) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });

console.log(`[snap] launching chromium…`);
const browser = await chromium.launch(launchOptions());

let rendererChecked = false;

for (const variant of VARIANT_LIST) {
  const V = VARIANTS[variant];
  if (!V) throw new Error(`unknown variant "${variant}"`);
  const url = `${BASE}/${LANG}/video/surge?variant=${variant}`;
  const settleMs = V.map ? 140 : 60;
  console.log(`\n[${variant}] ${V.w}×${V.h} — ${url}`);

  const context = await browser.newContext({
    viewport: { width: V.w + 40, height: V.h + 40 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });

  await page.waitForFunction(
    () => typeof window.__bake?.seek === "function" && typeof window.__bake?.ready === "function",
    { timeout: 15_000 },
  );
  try {
    await page.waitForFunction(() => window.__bake.ready() === true, { timeout: 25_000 });
  } catch {
    console.log(`[${variant}] __bake.ready() never went true; pressing on`);
  }
  await page.waitForTimeout(V.map ? 800 : 250);

  if (!rendererChecked) {
    await assertRenderer(page);
    rendererChecked = true;
  }

  const canvas = page.locator("[data-surge-canvas]").first();
  await canvas.waitFor({ state: "visible" });

  const seek = async (p) => {
    await page.evaluate((v) => window.__bake.seek(v), p);
    await page.waitForTimeout(settleMs);
  };

  const FRAMES_DIR = path.join(OUT_DIR, `frames-expansion-${variant}`);
  await rm(FRAMES_DIR, { recursive: true, force: true });
  await mkdir(FRAMES_DIR, { recursive: true });

  // ── review stills (progress 0 / 0.5 / 1) ────────────────────────────────────
  for (const [p, name] of [
    [0, `review-${variant}-old.png`],
    [0.5, `review-${variant}-mid.png`],
    [1, `review-${variant}-final.png`],
  ]) {
    await seek(p);
    await page.waitForTimeout(120);
    await canvas.screenshot({ path: path.join(OUT_DIR, name) });
  }

  // ── frame sweep ─────────────────────────────────────────────────────────────
  console.log(`[${variant}] ${TOTAL_FRAMES} frames @ ${FPS}fps (${DURATION}s reveal)…`);
  const t0 = Date.now();
  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const p = i / (TOTAL_FRAMES - 1);
    await seek(p);
    const frameName = `frame_${String(i).padStart(5, "0")}.${FRAME_EXT}`;
    await canvas.screenshot({ path: path.join(FRAMES_DIR, frameName), ...frameShotOpts() });
  }
  console.log(`[${variant}] frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await context.close();

  // ── encode ──────────────────────────────────────────────────────────────────
  const FRAME_GLOB = path.join(FRAMES_DIR, `frame_%05d.${FRAME_EXT}`);
  const TAIL_HOLD = `tpad=stop_duration=${GIF_HOLD}:stop_mode=clone`;
  const GIF_PATH = path.join(OUT_DIR, `${DELIVER}-${variant}.gif`);
  const PALETTE_PATH = path.join(OUT_DIR, `_palette-${variant}.png`);

  console.log(`[${variant}] gif palettegen…`);
  await run("ffmpeg", [
    "-y",
    "-framerate", String(FPS),
    "-i", FRAME_GLOB,
    "-vf", `${TAIL_HOLD},scale=${V.gifWidth}:-1:flags=lanczos,palettegen=stats_mode=diff`,
    PALETTE_PATH,
  ]);
  console.log(`[${variant}] gif paletteuse → ${path.basename(GIF_PATH)}…`);
  await run("ffmpeg", [
    "-y",
    "-framerate", String(FPS),
    "-i", FRAME_GLOB,
    "-i", PALETTE_PATH,
    "-lavfi",
    `${TAIL_HOLD},scale=${V.gifWidth}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5`,
    GIF_PATH,
  ]);
  await rm(PALETTE_PATH, { force: true });

  let MP4_PATH = null;
  if (V.mp4) {
    MP4_PATH = path.join(OUT_DIR, `${DELIVER}-${variant}.mp4`);
    console.log(`[${variant}] mp4 encode → ${path.basename(MP4_PATH)}…`);
    await run("ffmpeg", [
      "-y",
      "-framerate", String(FPS),
      "-i", FRAME_GLOB,
      "-vf", `${TAIL_HOLD},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-crf", "18",
      "-preset", "slow",
      "-movflags", "+faststart",
      MP4_PATH,
    ]);
  }

  if (!KEEP_FRAMES) await rm(FRAMES_DIR, { recursive: true, force: true });

  // The card is the /downloads "network expansion" download cut. Emit it under
  // the asset-flow naming (`expansion-<lang>.<ext>` in OUT_DIR) so
  // publish-map-assets.mjs picks it up alongside map / map-trend. EN and ES
  // coexist because the name carries the lang; the variant-named
  // `287g-expansion-card.*` deliverables (post/ghost, EN) are left untouched.
  if (variant === "card") {
    await copyFile(GIF_PATH, path.join(OUT_DIR, `expansion-${LANG}.gif`));
    if (MP4_PATH) await copyFile(MP4_PATH, path.join(OUT_DIR, `expansion-${LANG}.mp4`));
    console.log(`[${variant}] asset-flow copies → expansion-${LANG}.{gif${V.mp4 ? ",mp4" : ""}}`);
  }

  // ── copy deliverables to the shared scratchpad ──────────────────────────────
  if (SCRATCH) {
    const files = [
      `${DELIVER}-${variant}.gif`,
      ...(V.mp4 ? [`${DELIVER}-${variant}.mp4`] : []),
      `review-${variant}-old.png`,
      `review-${variant}-mid.png`,
      `review-${variant}-final.png`,
    ];
    for (const f of files) await copyFile(path.join(OUT_DIR, f), path.join(SCRATCH, f));
    console.log(`[${variant}] copied ${files.length} files → ${SCRATCH}`);
  }
  console.log(`✓ ${GIF_PATH}`);
  if (MP4_PATH) console.log(`✓ ${MP4_PATH}`);
}

await browser.close();
console.log(`\n✓ done — ${VARIANT_LIST.join(", ")}`);
process.exit(0);

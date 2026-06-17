#!/usr/bin/env node
// Bake Open Graph cards.
//
// Templates baked (all share the homepage map snapshot as background):
//   static/og/home.png          launch tagline
//   static/og/glossary.png      "GLOSSARY" — 287(g) terms explained
//   static/og/about.png         "ABOUT" — About 287(g) Watch
//   static/og/methodology.png   "METHODOLOGY" — How we built this
//   static/og/model/{slug}.png  per-program-model (jail, taskforce, wso)
//   static/og/agency/{slug}.png per-agency (name + city/state + model accent)
//
// Pipeline:
//   playwright   → snapshot live homepage map element to PNG (once)
//   sharp        → resize + apply dark gradient → shared background
//   satori       → render per-template text overlay (Bitter + Inter)
//   resvg        → SVG → transparent PNG
//   sharp        → composite text PNG over the shared background
//
// Usage:
//   pnpm bake:og                          # snapshot + bake everything
//   pnpm bake:og --skip-snapshot          # reuse existing static/og-bg-map.png
//   pnpm bake:og --only=home              # bake just one template group
//   pnpm bake:og --only=agencies
//   pnpm bake:og --slug=lancaster-county-sheriffs-office-ne   # one agency
//   pnpm bake:og --limit=20               # cap agency count (for iteration)
//   pnpm bake:og --url=https://...        # custom snapshot source URL
//   pnpm bake:og --workers=8              # agency-bake parallelism (default CPUs−2; 1 = serial)
//
// The agency bake (the heavy part) auto-shards across child processes — satori +
// resvg are single-threaded per process, so one process can't use more than one
// core. --shard=i/N is the internal per-child flag; you won't pass it by hand.

import { chromium } from "playwright";
import satori from "satori";
import { html as htmlToVnode } from "satori-html";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(__dirname, "..", "static");
// OG cards + the shared map snapshot go to .assets/ (NOT static/) — ~487MB of
// per-agency cards must not ride the site deploy. publish:og uploads them to
// the bucket. STATIC_DIR is still used to READ the agency index below. See #118.
const ASSETS_DIR = path.resolve(__dirname, "..", ".assets");
const OG_DIR = path.join(ASSETS_DIR, "og");
const SNAP_PATH = path.join(ASSETS_DIR, "og-bg-map.png");
const AGENCY_INDEX_PATH = path.join(
  STATIC_DIR,
  "data",
  "dist",
  "agency_index.json",
);

// ---------- args ----------

const args = process.argv.slice(2);
const argValue = (flag) => {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const URL = argValue("--url") ?? "https://287g.recoveredfactory.net/en";
const SKIP_SNAPSHOT = args.includes("--skip-snapshot");
const ONLY = argValue("--only"); // home | pages | models | agencies
const SLUG_FILTER = argValue("--slug");
const LIMIT = Number(argValue("--limit"));

// Sharding. The agency loop's satori + resvg run synchronously on one JS thread,
// so a single process pegs exactly one core no matter the async pool size. The
// top-level run fans the agency bake out across WORKERS child processes; each is
// re-invoked with --shard=i/N and bakes every Nth agency (both locales). The
// children reuse the one snapshot the parent took (--skip-snapshot).
// --workers=1 forces the old single-process path.
const SHARD = argValue("--shard"); // "i/N" — set only on child processes
const [SHARD_I, SHARD_N] = SHARD ? SHARD.split("/").map(Number) : [null, null];
// Default to cores/2, not cores: each shard process already pegs ~2 cores (satori
// on the JS main thread + libvips on its own), so cores/2 processes saturate the
// machine. More just oversubscribe — measured flat from 8→16 workers on a 16-core
// box, with the agency bake ~5× faster than single-process either way.
const WORKERS = Math.max(
  1,
  Number(argValue("--workers")) ||
    Number(process.env.BAKE_OG_WORKERS) ||
    Math.max(2, Math.floor(os.cpus().length / 2)),
);

const SIZE = { width: 1200, height: 630 };
const CONCURRENCY = Math.max(2, Math.min(8, Number(process.env.BAKE_OG_CONCURRENCY) || 4));

// In a shard child, cap libvips to one thread per process — parallelism comes
// from the WORKERS processes, so letting each spin up a core's worth of libvips
// threads would just oversubscribe and thrash.
if (SHARD_N) sharp.concurrency(1);

// Cards are baked per locale into og/<locale>/… so /es pages get Spanish
// social cards. The page <head> picks the locale via $lib/ogImage.ts.
const LOCALES = ["en", "es"];
for (const locale of LOCALES) {
  await mkdir(path.join(OG_DIR, locale, "model"), { recursive: true });
  await mkdir(path.join(OG_DIR, locale, "agency"), { recursive: true });
}

// ---------- snapshot ----------

async function snapshotMap() {
  console.log(`[snap] launching chromium…`);
  const browser = await chromium.launch({
    args: [
      "--use-angle=swiftshader",
      "--use-gl=angle",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  console.log(`[snap] loading ${URL}…`);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60_000 });

  await page.evaluate(() => {
    const kill = (sel) =>
      document.querySelectorAll(sel).forEach((el) => el.remove());
    kill(".count-overlay");
    kill(".count-card");
    kill('[aria-label="Support Recovered Factory"]');
    kill('[role="complementary"].fixed');
    kill(".fixed.bottom-0.left-0.right-0.z-50");
    kill(".maplibregl-ctrl-attrib");
    kill(".maplibregl-ctrl-bottom-right");
    kill(".maplibregl-ctrl-bottom-left");
    kill(".maplibregl-ctrl-top-right");
    kill(".maplibregl-ctrl-top-left");
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" && cs.bottom === "0px") el.remove();
    }
  });

  try {
    await page.waitForFunction(() => window.__mapReady === true, {
      timeout: 8000,
    });
    console.log(`[snap] map ready (signal)`);
  } catch {
    console.log(`[snap] no ready signal; waiting 10s fallback`);
    await page.waitForTimeout(10_000);
  }

  const mapEl = page.locator("canvas.maplibregl-canvas").first();
  await mapEl.waitFor({ state: "visible" });
  await mapEl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  const box = await mapEl.boundingBox();
  if (!box) throw new Error("map canvas not visible");
  console.log(
    `[snap] map box ${Math.round(box.width)}x${Math.round(box.height)} @ y=${Math.round(box.y)}`,
  );

  const buf = await mapEl.screenshot({ type: "png" });
  await writeFile(SNAP_PATH, buf);
  console.log(
    `[snap] wrote ${SNAP_PATH} (${(buf.length / 1024).toFixed(0)} KB)`,
  );
  await browser.close();
  return buf;
}

const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

let mapPngBuf;
if (SKIP_SNAPSHOT && (await exists(SNAP_PATH))) {
  console.log(`[snap] --skip-snapshot: reusing ${SNAP_PATH}`);
  mapPngBuf = await readFile(SNAP_PATH);
} else {
  mapPngBuf = await snapshotMap();
}

// ---------- shared background ----------

console.log(`[bg] building shared background…`);
const tBg = Date.now();

// Top stops are kept light so the lifted map (below) shows through cleanly in
// the upper ~half of the card; from 50% down the wash crushes to near-opaque
// so the title still lands on solid dark and stays legible.
const gradientSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE.width}" height="${SIZE.height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#05080c" stop-opacity="0.10" />
      <stop offset="28%"  stop-color="#05080c" stop-opacity="0.22" />
      <stop offset="50%"  stop-color="#05080c" stop-opacity="0.70" />
      <stop offset="70%"  stop-color="#05080c" stop-opacity="0.93" />
      <stop offset="100%" stop-color="#05080c" stop-opacity="0.98" />
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)" />
</svg>
`);

const trimmed = await sharp(mapPngBuf)
  .metadata()
  .then(({ width, height }) =>
    sharp(mapPngBuf)
      .extract({
        left: 80,
        top: 40,
        width: width - 160,
        height: height - 80,
      })
      .toBuffer(),
  );

// Lift the map before compositing. The source map is a very dark theme, so
// over the (now lighter) top of the gradient it would otherwise collapse into
// the near-black fill. A contrast stretch raises the landmass to a readable
// slate and a saturation bump makes the data dots glow — the dots are the
// data, so we want them to carry color. (Treatment "D" from the contrast
// review; see git history.)
const mapBg = await sharp(trimmed)
  .linear(1.7, -8)
  .modulate({ saturation: 1.5 })
  .resize(SIZE.width, SIZE.height, { fit: "cover", position: "center" })
  .composite([{ input: gradientSvg, top: 0, left: 0 }])
  .png()
  .toBuffer();

console.log(`[bg]   ${Date.now() - tBg}ms`);

// ---------- fonts ----------

const loadFont = (file) => readFile(require.resolve(file));
const [bitterBold, bitterBlack, interRegular, interSemibold] = await Promise.all([
  loadFont("@fontsource/bitter/files/bitter-latin-700-normal.woff"),
  loadFont("@fontsource/bitter/files/bitter-latin-900-normal.woff"),
  loadFont("@fontsource/inter/files/inter-latin-400-normal.woff"),
  loadFont("@fontsource/inter/files/inter-latin-600-normal.woff"),
]);
const FONTS = [
  { name: "Bitter", data: bitterBold, weight: 700, style: "normal" },
  { name: "Bitter", data: bitterBlack, weight: 900, style: "normal" },
  { name: "Inter", data: interRegular, weight: 400, style: "normal" },
  { name: "Inter", data: interSemibold, weight: 600, style: "normal" },
];

// ---------- card factory ----------

const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Pick a title size that keeps the longest realistic title within ~3 lines
// of the 880px-wide centered block. Tuned empirically against agency names.
// Floor raised for legibility once messaging apps downscale the card to a
// thumbnail (#131).
const titleSize = (s) => {
  const n = String(s ?? "").length;
  if (n <= 22) return 104;
  if (n <= 34) return 92;
  if (n <= 48) return 78;
  if (n <= 64) return 68;
  return 60;
};

// Every card carries the "287(g) Watch" eyebrow as the constant brand
// signal. Title is the page/agency name; optional subtitle (model name on
// agency cards, with model-colored text) and meta (location/date) sit
// underneath. The bottom of the card has the dark gradient wash that
// the type lands on.
const BRAND = "287(g) Watch";
const BRAND_PINK = "#BE6079";

const cardHtml = ({ title, subtitle, subtitleAccent, subtitleSize, meta }) => `
<div style="
  display: flex;
  width: ${SIZE.width}px;
  height: ${SIZE.height}px;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 104px;
  font-family: 'Inter';
">
  <div style="
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 1040px;
    text-align: center;
  ">
    <div style="
      font-family: 'Inter';
      font-size: 30px;
      font-weight: 600;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: ${BRAND_PINK};
      margin-bottom: 22px;
      text-shadow: 0 1px 4px rgba(0,0,0,0.7);
    ">
      ${escapeHtml(BRAND)}
    </div>
    <div style="
      font-family: 'Bitter';
      font-size: ${titleSize(title)}px;
      font-weight: 700;
      line-height: 1.08;
      color: #ffffff;
      letter-spacing: -0.005em;
      text-shadow: 0 2px 10px rgba(0,0,0,0.85), 0 1px 3px rgba(0,0,0,0.9);
    ">
      ${escapeHtml(title)}
    </div>
    ${
      subtitle
        ? `
    <div style="
      font-family: 'Inter';
      font-size: ${subtitleSize ?? 34}px;
      font-weight: 600;
      line-height: 1.35;
      color: ${subtitleAccent ?? "rgba(255,255,255,0.82)"};
      margin-top: 18px;
      text-shadow: 0 1px 6px rgba(0,0,0,0.8);
    ">
      ${escapeHtml(subtitle)}
    </div>`
        : ""
    }
    ${
      meta
        ? `
    <div style="
      font-family: 'Inter';
      font-size: 25px;
      font-weight: 400;
      letter-spacing: 0.04em;
      line-height: 1.3;
      color: rgba(255,255,255,0.72);
      margin-top: 14px;
      text-shadow: 0 1px 4px rgba(0,0,0,0.75);
    ">
      ${escapeHtml(meta)}
    </div>`
        : ""
    }
  </div>
</div>
`;

async function bakeCard(outPath, fields) {
  const svg = await satori(htmlToVnode(cardHtml(fields)), {
    ...SIZE,
    fonts: FONTS,
  });
  const textPng = new Resvg(svg, {
    fitTo: { mode: "width", value: SIZE.width },
    background: "rgba(0,0,0,0)",
  })
    .render()
    .asPng();
  const final = await sharp(mapBg)
    .composite([{ input: textPng, top: 0, left: 0 }])
    .png()
    .toBuffer();
  await writeFile(outPath, final);
}

// ---------- model metadata ----------

const MODEL_COLORS = {
  "Jail Enforcement Model": "#BE6079",
  "Task Force Model": "#3C97E2",
  "Warrant Service Officer": "#5E9148",
};
const MODEL_SLUG = {
  "Jail Enforcement Model": "jail",
  "Task Force Model": "taskforce",
  "Warrant Service Officer": "wso",
};
const MODEL_SHORT = {
  "Jail Enforcement Model": "Jail Enforcement",
  "Task Force Model": "Task Force",
  "Warrant Service Officer": "Warrant Service",
};
const MODEL_DEFINITIONS = {
  "Jail Enforcement Model":
    "Officers investigate immigration status of people already booked into jail.",
  "Task Force Model":
    "Officers enforce immigration law during routine patrol duties.",
  "Warrant Service Officer":
    "Officers serve administrative immigration warrants on people in custody.",
};
const MODEL_DEFINITIONS_ES = {
  "Jail Enforcement Model":
    "Los oficiales investigan el estatus migratorio de personas ya ingresadas en la cárcel.",
  "Task Force Model":
    "Los oficiales aplican la ley migratoria durante el patrullaje rutinario.",
  "Warrant Service Officer":
    "Los oficiales entregan órdenes migratorias administrativas a personas bajo custodia.",
};

// Per-locale card copy. Model NAMES stay in English (program-specific terms,
// as elsewhere on the site); only the sentence/definition text is localized.
const STR = {
  en: {
    home: "Every active agreement between local police and ICE.",
    glossary: "287(g) terms, explained.",
    about: "Why we built 287(g) Watch.",
    methodology: "How we built this dataset.",
    "use-the-map": "Free videos and images about the growth of 287(g).",
    modelDef: MODEL_DEFINITIONS,
    signed: "Signed",
    also: "Also",
    months: ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"],
  },
  es: {
    home: "Cada acuerdo activo entre la policía local e ICE.",
    glossary: "Términos de 287(g), explicados.",
    about: "Por qué creamos 287(g) Watch.",
    methodology: "Cómo construimos estos datos.",
    "use-the-map": "Videos e imágenes gratuitos sobre el crecimiento de 287(g).",
    modelDef: MODEL_DEFINITIONS_ES,
    signed: "Firmado",
    also: "También",
    months: ["enero", "febrero", "marzo", "abril", "mayo", "junio",
      "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  },
};

// US state names (subset of $lib/states.ts — duplicated here so the bake
// script stays a plain .mjs without bringing in the SvelteKit module graph).
const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia", PR: "Puerto Rico",
};

// ---------- per-group bakes ----------

async function bakeHome(locale) {
  await bakeCard(path.join(OG_DIR, locale, "home.png"), { title: STR[locale].home });
  console.log(`✓ ${locale}/home.png`);
}

async function bakePages(locale) {
  for (const slug of ["glossary", "about", "methodology", "use-the-map"]) {
    await bakeCard(path.join(OG_DIR, locale, `${slug}.png`), { title: STR[locale][slug] });
    console.log(`✓ ${locale}/${slug}.png`);
  }
}

async function bakeModels(locale) {
  for (const [model, slug] of Object.entries(MODEL_SLUG)) {
    await bakeCard(path.join(OG_DIR, locale, "model", `${slug}.png`), {
      title: `${MODEL_SHORT[model]} Model`,
      subtitle: STR[locale].modelDef[model],
      subtitleSize: 38,
      subtitleAccent: MODEL_COLORS[model],
    });
    console.log(`✓ ${locale}/model/${slug}.png`);
  }
}

const formatSignedDate = (iso, locale) => {
  if (!iso || iso.length < 7) return null;
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  return `${STR[locale].signed} ${STR[locale].months[m - 1]} ${y}`;
};

// "#NA" creeps in for some agencies — treat it the same as null.
const cleanLoc = (s) => (s && s !== "#NA" ? s : null);

async function bakeAgencies(locale) {
  const raw = JSON.parse(await readFile(AGENCY_INDEX_PATH, "utf8"));
  let agencies = SLUG_FILTER ? raw.filter((a) => a.slug === SLUG_FILTER) : raw;
  if (Number.isFinite(LIMIT) && LIMIT > 0) agencies = agencies.slice(0, LIMIT);
  if (SHARD_N) agencies = agencies.filter((_, idx) => idx % SHARD_N === SHARD_I);
  const tag = SHARD_N ? `[shard ${SHARD_I}/${SHARD_N} ${locale}]` : `[agencies ${locale}]`;
  console.log(`${tag} baking ${agencies.length} cards (concurrency=${CONCURRENCY})…`);
  const tStart = Date.now();
  let done = 0;
  const queue = [...agencies];
  const worker = async () => {
    while (queue.length) {
      const a = queue.shift();
      if (!a) break;
      const stateName = STATE_NAMES[a.state] ?? a.state;
      const city = cleanLoc(a.city);
      const county = cleanLoc(a.county);
      const place = city
        ? `${city}, ${stateName}`
        : county
          ? `${county}, ${stateName}`
          : stateName;
      const model = a.primary_model ?? a.models?.[0];
      const subtitle = model
        ? `${MODEL_SHORT[model] ?? model} Model`
        : null;
      const subtitleAccent = MODEL_COLORS[model];

      // Meta line: "Place · Signed Feb 2025" — plus any additional models
      // beyond the primary, e.g. "· Also Task Force".
      const dateLabel = formatSignedDate(a.signed_date, locale);
      const extraModels = (a.models ?? [])
        .filter((m) => m !== model)
        .map((m) => MODEL_SHORT[m] ?? m);
      const metaParts = [place];
      if (dateLabel) metaParts.push(dateLabel);
      if (extraModels.length) {
        metaParts.push(`${STR[locale].also} ${extraModels.join(" + ")}`);
      }
      const meta = metaParts.join("  ·  ");

      await bakeCard(path.join(OG_DIR, locale, "agency", `${a.slug}.png`), {
        title: a.name,
        subtitle,
        subtitleAccent,
        meta,
      });
      done += 1;
      // Sharded children would garble each other's \r progress line, so only
      // the single-process path prints incremental progress.
      if (!SHARD_N && (done % 50 === 0 || done === agencies.length)) {
        const elapsed = (Date.now() - tStart) / 1000;
        process.stdout.write(
          `  ${done}/${agencies.length} (${elapsed.toFixed(1)}s)\r`,
        );
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, agencies.length) }, worker),
  );
  const elapsed = (Date.now() - tStart) / 1000;
  console.log(`${SHARD_N ? "" : "\n"}✓ ${tag} ${agencies.length} cards in ${elapsed.toFixed(1)}s`);
}

// ---------- run ----------

// Child shard: just bake this process's slice of the agencies (both locales),
// then exit. The snapshot + mapBg were already (re)built above from --skip-snapshot.
if (SHARD_N != null) {
  for (const locale of LOCALES) await bakeAgencies(locale);
  process.exit(0);
}

// Parent run. The non-agency cards are a handful (home/pages/models × 2 locales)
// — bake them here directly.
for (const locale of LOCALES) {
  if (!ONLY || ONLY === "home") await bakeHome(locale);
  if (!ONLY || ONLY === "pages") await bakePages(locale);
  if (!ONLY || ONLY === "models") await bakeModels(locale);
}

// Agencies — the heavy loop. Fan out across WORKERS child processes so the
// satori/resvg work (sync, one core per process) actually uses the machine.
// Single-process fallbacks: --workers=1, or a single-agency --slug run.
if (!ONLY || ONLY === "agencies") {
  if (WORKERS <= 1 || SLUG_FILTER) {
    for (const locale of LOCALES) await bakeAgencies(locale);
  } else {
    console.log(`[agencies] sharding across ${WORKERS} processes…`);
    const tShard = Date.now();
    const selfPath = fileURLToPath(import.meta.url);
    await Promise.all(
      Array.from(
        { length: WORKERS },
        (_, i) =>
          new Promise((resolve, reject) => {
            const childArgs = [
              selfPath,
              "--only=agencies",
              "--skip-snapshot",
              `--shard=${i}/${WORKERS}`,
              `--url=${URL}`,
            ];
            if (Number.isFinite(LIMIT) && LIMIT > 0) childArgs.push(`--limit=${LIMIT}`);
            const child = spawn(process.execPath, childArgs, {
              stdio: ["ignore", "inherit", "inherit"],
            });
            child.on("exit", (code) =>
              code === 0
                ? resolve()
                : reject(new Error(`agency shard ${i} exited with code ${code}`)),
            );
            child.on("error", reject);
          }),
      ),
    );
    console.log(`✓ all agency shards done in ${((Date.now() - tShard) / 1000).toFixed(1)}s`);
  }
}

console.log(`\nOutput: ${OG_DIR}`);
process.exit(0);

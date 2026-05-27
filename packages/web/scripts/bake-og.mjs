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

import { chromium } from "playwright";
import satori from "satori";
import { html as htmlToVnode } from "satori-html";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(__dirname, "..", "static");
const OG_DIR = path.join(STATIC_DIR, "og");
const SNAP_PATH = path.join(STATIC_DIR, "og-bg-map.png");
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

const SIZE = { width: 1200, height: 630 };
const CONCURRENCY = Math.max(2, Math.min(8, Number(process.env.BAKE_OG_CONCURRENCY) || 4));

await mkdir(OG_DIR, { recursive: true });
await mkdir(path.join(OG_DIR, "model"), { recursive: true });
await mkdir(path.join(OG_DIR, "agency"), { recursive: true });

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

const gradientSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE.width}" height="${SIZE.height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#0c1117" stop-opacity="0.00" />
      <stop offset="35%"  stop-color="#0c1117" stop-opacity="0.15" />
      <stop offset="55%"  stop-color="#0c1117" stop-opacity="0.68" />
      <stop offset="75%"  stop-color="#0c1117" stop-opacity="0.88" />
      <stop offset="100%" stop-color="#0c1117" stop-opacity="0.92" />
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

const mapBg = await sharp(trimmed)
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
// of the 600px-wide centered block. Tuned empirically against agency names.
const titleSize = (s) => {
  const n = String(s ?? "").length;
  if (n <= 22) return 64;
  if (n <= 34) return 56;
  if (n <= 48) return 48;
  if (n <= 64) return 42;
  return 36;
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
  padding-bottom: 48px;
  font-family: 'Inter';
">
  <div style="
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 880px;
    text-align: center;
  ">
    <div style="
      font-family: 'Inter';
      font-size: 20px;
      font-weight: 600;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: ${BRAND_PINK};
      margin-bottom: 20px;
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
    ">
      ${escapeHtml(title)}
    </div>
    ${
      subtitle
        ? `
    <div style="
      font-family: 'Inter';
      font-size: ${subtitleSize ?? 22}px;
      font-weight: 600;
      line-height: 1.35;
      color: ${subtitleAccent ?? "rgba(255,255,255,0.82)"};
      margin-top: 18px;
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
      font-size: 16px;
      font-weight: 400;
      letter-spacing: 0.04em;
      line-height: 1.3;
      color: rgba(255,255,255,0.55);
      margin-top: 12px;
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

async function bakeHome() {
  await bakeCard(path.join(OG_DIR, "home.png"), {
    title: "Every agreement between local police and ICE.",
  });
  console.log(`✓ home.png`);
}

async function bakePages() {
  const pages = [
    { slug: "glossary",    title: "287(g) terms, explained." },
    { slug: "about",       title: "Why we built 287(g) Watch." },
    { slug: "methodology", title: "How we built this dataset." },
  ];
  for (const p of pages) {
    await bakeCard(path.join(OG_DIR, `${p.slug}.png`), p);
    console.log(`✓ ${p.slug}.png`);
  }
}

async function bakeModels() {
  for (const [model, slug] of Object.entries(MODEL_SLUG)) {
    await bakeCard(path.join(OG_DIR, "model", `${slug}.png`), {
      title: `${MODEL_SHORT[model]} Model`,
      subtitle: MODEL_DEFINITIONS[model],
      subtitleSize: 28,
      subtitleAccent: MODEL_COLORS[model],
    });
    console.log(`✓ model/${slug}.png`);
  }
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const formatSignedDate = (iso) => {
  if (!iso || iso.length < 7) return null;
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  return `Signed ${MONTH_NAMES[m - 1]} ${y}`;
};

// "#NA" creeps in for some agencies — treat it the same as null.
const cleanLoc = (s) => (s && s !== "#NA" ? s : null);

async function bakeAgencies() {
  const raw = JSON.parse(await readFile(AGENCY_INDEX_PATH, "utf8"));
  let agencies = SLUG_FILTER ? raw.filter((a) => a.slug === SLUG_FILTER) : raw;
  if (Number.isFinite(LIMIT) && LIMIT > 0) agencies = agencies.slice(0, LIMIT);
  console.log(
    `[agencies] baking ${agencies.length} cards (concurrency=${CONCURRENCY})…`,
  );
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
      const dateLabel = formatSignedDate(a.signed_date);
      const extraModels = (a.models ?? [])
        .filter((m) => m !== model)
        .map((m) => MODEL_SHORT[m] ?? m);
      const metaParts = [place];
      if (dateLabel) metaParts.push(dateLabel);
      if (extraModels.length) {
        metaParts.push(`Also ${extraModels.join(" + ")}`);
      }
      const meta = metaParts.join("  ·  ");

      await bakeCard(path.join(OG_DIR, "agency", `${a.slug}.png`), {
        title: a.name,
        subtitle,
        subtitleAccent,
        meta,
      });
      done += 1;
      if (done % 50 === 0 || done === agencies.length) {
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
  console.log(`\n✓ ${agencies.length} agency cards in ${elapsed.toFixed(1)}s`);
}

// ---------- run ----------

if (!ONLY || ONLY === "home") await bakeHome();
if (!ONLY || ONLY === "pages") await bakePages();
if (!ONLY || ONLY === "models") await bakeModels();
if (!ONLY || ONLY === "agencies") await bakeAgencies();

console.log(`\nOutput: ${OG_DIR}`);
process.exit(0);

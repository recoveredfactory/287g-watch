#!/usr/bin/env tsx
/**
 * build-agreement-index.ts  (#2 — the data foundation)
 *
 * Unions agreement PDFs across ALL snapshots in appelson/Tracking_287g and emits
 * one entry per agency listing every distinct model-agreement on file.
 *
 * Why this is needed: the archive's snapshot folders are INCREMENTAL — each
 * `agreements/<snapshot>/` only holds the PDFs that were *new* in that capture.
 * A single folder (what build-moa-index.ts points at) is never the full picture.
 * Unioning across all ~83 snapshots lifts full coverage of multi-model agencies
 * from ~27% (one folder) to ~51%. See docs/AGREEMENTS_PER_AGREEMENT_PLAN.md.
 *
 * An agency can hold up to three agreements (one per model: JEM / TFM / WSO),
 * each with its own ICE signer, date, and public-affairs POC — which sometimes
 * diverge (e.g. Autauga County SO). This index is consumed by
 * extract-moa-signers.ts, which extracts EVERY PDF rather than a single pick.
 *
 * Output: packages/pipeline/data/moa_agreements.json
 *   { "<2-letter-state>|<normalized agency>": [
 *       { model, pdf_url, sha, snapshot, date_filename, filename }, … ] }
 *
 * The agency key matches build-moa-index.ts / ingest.ts (`<STATE>|moaNorm(name)`)
 * so downstream joins are trivial.
 *
 * Run:
 *   export GITHUB_TOKEN="$(grep -E '^GITHUB_TOKEN=' ../../.env | head -1 | cut -d= -f2-)"
 *   pnpm -F pipeline build:agreement-index
 *
 * Env:
 *   GITHUB_TOKEN / GH_TOKEN   raises the API rate limit 60→5000/hr (required —
 *                             the recursive-tree crawl is ~85 authenticated calls)
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "data/moa_agreements.json");
const AGENCY_INDEX = resolve(
  __dirname,
  "../web/static/data/dist/agency_index.json",
);

const REPO = "appelson/Tracking_287g";
const GH_TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const ghHeaders: Record<string, string> = {
  "User-Agent": "287g-explorer-pipeline",
  ...(GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {}),
};
if (!GH_TOKEN) {
  console.warn(
    "⚠  No GITHUB_TOKEN — unauthenticated API (60 req/hr) will not survive the crawl. Set GITHUB_TOKEN.\n",
  );
}

// Map full state directory name (ALABAMA) → 2-letter code (AL). Mirrors
// build-moa-index.ts so the agency key is identical across the pipeline.
const STATE_ABBREVS: Record<string, string> = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR",
  CALIFORNIA: "CA", COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE",
  FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI", IDAHO: "ID",
  ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA", KANSAS: "KS",
  KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD",
  MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS",
  MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV",
  NEW_HAMPSHIRE: "NH", NEW_JERSEY: "NJ", NEW_MEXICO: "NM", NEW_YORK: "NY",
  NORTH_CAROLINA: "NC", NORTH_DAKOTA: "ND", OHIO: "OH", OKLAHOMA: "OK",
  OREGON: "OR", PENNSYLVANIA: "PA", RHODE_ISLAND: "RI", SOUTH_CAROLINA: "SC",
  SOUTH_DAKOTA: "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT",
  VERMONT: "VT", VIRGINIA: "VA", WASHINGTON: "WA", WEST_VIRGINIA: "WV",
  WISCONSIN: "WI", WYOMING: "WY", DISTRICT_OF_COLUMBIA: "DC",
};

// Model tag (filename) → full model name used in agency_index `models`.
const MODEL_FULL: Record<string, string> = {
  JEM: "Jail Enforcement Model",
  TFM: "Task Force Model",
  WSO: "Warrant Service Officer",
};
const MODEL_PRIORITY = ["JEM", "TFM", "WSO"];

// Same normalizer build-moa-index.ts uses (note the `_`→` ` step — tree paths
// carry underscored dir names like `Autauga_County_Sheriff's_Office_`).
function moaNorm(name: string): string {
  return name
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Filename → model tag (JEM/TFM/WSO) or null.
function detectModel(filename: string): string | null {
  const m = filename.toUpperCase().match(/_(JEM|TFM|WSO)_/);
  return m ? m[1] : null;
}

// Filename → date digits as written (MMDDYY or MMDDYYYY); raw, for sort/dedupe.
function detectDate(filename: string): string | null {
  return (filename.match(/(\d{6,8})/) || [])[1] ?? null;
}

// Percent-encode each path segment so apostrophes/spaces produce a working URL.
function encodePath(...segments: string[]): string {
  return segments.map((s) => s.split("/").map(encodeURIComponent).join("/")).join("/");
}

type Agreement = {
  model: string | null;
  pdf_url: string;     // GitHub blob view URL (on main; all snapshots are committed)
  sha: string;         // blob SHA — extract-moa-signers downloads via the blob API
  snapshot: string;    // snapshot folder the PDF was found in
  date_filename: string | null;
  filename: string;
};

// ── 1. List snapshot directories (one Contents call yields all their tree SHAs) ─

console.log("Listing snapshot directories…");
const listRes = await fetch(
  `https://api.github.com/repos/${REPO}/contents/agreements`,
  { headers: ghHeaders },
);
if (!listRes.ok) {
  console.error(`Failed to list agreements/: HTTP ${listRes.status}`);
  process.exit(1);
}
const snaps = ((await listRes.json()) as Array<{ name: string; type: string; sha: string }>)
  .filter((e) => e.type === "dir" && /^agreements_\d/.test(e.name));
console.log(`Found ${snaps.length} snapshots — unioning PDFs across all of them…`);

// ── 2. Crawl each snapshot's recursive tree, collect every PDF ─────────────────
//
// agency key → dedupe key (`model|normFilename`) → Agreement. Deduping by
// (model, normalized filename) collapses a PDF that recurs verbatim across
// snapshots while preserving genuinely distinct (e.g. re-dated) versions.

const cover = new Map<string, Map<string, Agreement>>();
let totalPdfs = 0;
let cursor = 0;
let treeErrors = 0;

async function worker(): Promise<void> {
  while (cursor < snaps.length) {
    const s = snaps[cursor++];
    try {
      const tr = await fetch(
        `https://api.github.com/repos/${REPO}/git/trees/${s.sha}?recursive=1`,
        { headers: ghHeaders, signal: AbortSignal.timeout(30_000) },
      );
      if (!tr.ok) {
        treeErrors++;
        continue;
      }
      const { tree, truncated } = (await tr.json()) as {
        tree: Array<{ path: string; type: string; sha: string }>;
        truncated?: boolean;
      };
      if (truncated) console.warn(`  ⚠ tree truncated for ${s.name} — some PDFs may be missed`);
      for (const it of tree || []) {
        if (it.type !== "blob" || !it.path.toLowerCase().endsWith(".pdf")) continue;
        const parts = it.path.split("/"); // STATE_FULL / AGENCY_DIR / … / file.pdf
        if (parts.length < 3) continue;
        const state = STATE_ABBREVS[parts[0]];
        if (!state) continue; // non-state top-level dir (readme, .github, …)
        totalPdfs++;
        const filename = parts[parts.length - 1];
        const model = detectModel(filename);
        const key = `${state}|${moaNorm(parts[1])}`;
        const dedupeKey = `${model ?? "?"}|${moaNorm(filename)}`;
        if (!cover.has(key)) cover.set(key, new Map());
        const agency = cover.get(key)!;
        if (!agency.has(dedupeKey)) {
          agency.set(dedupeKey, {
            model,
            pdf_url: `https://github.com/${REPO}/blob/main/${encodePath("agreements", s.name, it.path)}`,
            sha: it.sha,
            snapshot: s.name,
            date_filename: detectDate(filename),
            filename,
          });
        }
      }
    } catch {
      treeErrors++;
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(
  `Indexed ${cover.size} agency folders, ${totalPdfs} total PDFs` +
    (treeErrors ? ` (${treeErrors} tree fetch errors)` : ""),
);

// ── 3. Sort each agency's agreements (model priority, then newest date) ────────

function sortKey(a: Agreement): [number, string] {
  const pri = a.model ? MODEL_PRIORITY.indexOf(a.model) : 99;
  return [pri < 0 ? 99 : pri, a.date_filename ?? ""];
}

const out: Record<string, Agreement[]> = {};
for (const [key, agency] of cover) {
  out[key] = [...agency.values()].sort((a, b) => {
    const [pa, da] = sortKey(a);
    const [pb, db] = sortKey(b);
    if (pa !== pb) return pa - pb;       // JEM, TFM, WSO, then untagged
    return db.localeCompare(da);          // newest filename date first
  });
}

// ── 4. Coverage report + sanity assert (joins against agency_index models) ─────

if (existsSync(AGENCY_INDEX)) {
  const agencies = JSON.parse(readFileSync(AGENCY_INDEX, "utf8")) as Array<{
    state: string;
    name: string;
    models?: string[];
  }>;
  let full = 0, partial = 0, none = 0, totalMulti = 0;
  for (const a of agencies) {
    const models = a.models ?? [];
    if (models.length <= 1) continue;
    totalMulti++;
    const key = `${a.state}|${moaNorm(a.name)}`;
    const onFile = new Set(
      (out[key] ?? []).map((g) => g.model && MODEL_FULL[g.model]).filter(Boolean) as string[],
    );
    const covered = models.filter((m) => onFile.has(m)).length;
    if (onFile.size === 0) none++;
    else if (covered >= models.length) full++;
    else partial++;
  }
  const pct = (n: number) => (totalMulti ? Math.round((100 * n) / totalMulti) : 0);
  console.log(
    `\nMulti-model agencies: ${totalMulti} | ` +
      `full ${full} (${pct(full)}%) | partial ${partial} (${pct(partial)}%) | none ${none} (${pct(none)}%)`,
  );
  // Guard: the spike measured ~51% full. A large drop means the crawl regressed
  // (truncated trees, key drift, rate-limit drops) — fail loudly rather than
  // silently shipping a thinner index.
  if (totalMulti > 0 && pct(full) < 40) {
    console.error(
      `\n✗ Full coverage ${pct(full)}% is well below the expected ~51%. ` +
        `Likely a crawl regression — NOT writing output.`,
    );
    process.exit(1);
  }
} else {
  console.warn(`\n(agency_index.json not found at ${AGENCY_INDEX} — skipping coverage check)`);
}

// ── 5. Write ───────────────────────────────────────────────────────────────────

mkdirSync(resolve(__dirname, "data"), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
const totalAgreements = Object.values(out).reduce((n, a) => n + a.length, 0);
console.log(`\nWrote ${Object.keys(out).length} agencies / ${totalAgreements} agreements → ${OUT_PATH}`);

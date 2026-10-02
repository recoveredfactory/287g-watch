#!/usr/bin/env tsx
/**
 * build-arrest-stats.ts
 *
 * Adds real per-agency ICE arrest counts from the Deportation Data Project
 * (UC Berkeley Law + UCLA), same source/license as build-detainer-stats.ts.
 * Source: github.com/deportationdata/ice, "arrests-latest.parquet", filtered
 * to rows where apprehension_method === "287(g) Program".
 *
 * event_landmark (the field naming the arresting agency/area) is much
 * noisier than detainers' facility_state/detention_facility pair — roughly
 * two-thirds of non-null values are vague area buckets ("DALLAS COUNTY
 * GENERAL AREA", "DO NOT USE") rather than a real agency name, and ~16% of
 * 287(g)-tagged rows have no landmark at all. Reuses the exact same
 * conservative matching approach as build-detainer-stats.ts (state-scoped,
 * token-based fuzzy match, tight relative distance + margin-over-runner-up)
 * rather than loosening the bar to compensate — a lower match rate here is
 * expected and fine; a wrong agency attached to a real arrest is not.
 *
 * by_criminality is apprehension_criminality, collapsed to 3 clean existing
 * values (Convicted Criminal / Pending Criminal Charges / Other Immigration
 * Violator — no grouping needed, the source field is already this shape).
 *
 * Usage:
 *   pnpm -F pipeline build:arrest-stats
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { editDistance } from "./lib/editDistance";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, "../web/static/data/dist");
const OUT_PATH = resolve(__dirname, "data/arrest_stats.json");

const PARQUET_URL = "https://media.githubusercontent.com/media/deportationdata/ice/main/data/arrests-latest.parquet";

type Agency = { slug: string; name: string; state: string; agency_type: string };
type ArrestRow = {
  apprehension_method: string | null;
  event_landmark: string | null;
  apprehension_state_filled_in: string | null;
  apprehension_date: Date | null;
  apprehension_criminality: string | null;
  citizenship_country: string | null;
};

type Criminality = "convicted" | "pending_charges" | "other";
function classifyCriminality(raw: string | null): Criminality {
  if (raw === "1 Convicted Criminal") return "convicted";
  if (raw === "2 Pending Criminal Charges") return "pending_charges";
  return "other"; // "3 Other Immigration Violator" and any unrecognized value
}

const STATE_NAME_TO_ABBR: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV",
  Wisconsin: "WI", Wyoming: "WY", "District of Columbia": "DC",
};

// Same normalization as build-detainer-stats.ts's distinctiveTokens().
// "county", "police" and "city" are deliberately NOT filler: they are what
// tells "Benton County Sheriff's Office" apart from "Benton Police
// Department". Stripping them made the two keys identical, the tie check
// rejected both, and every such county sheriff silently matched nothing.
const FILLER = new Set([
  "sheriff", "sheriffs", "office", "department", "dept", "jail",
  "detention", "center", "det", "cen", "facility", "correctional", "the",
  "of", "and",
]);
function distinctiveTokens(name: string): string {
  return name
    .toLowerCase()
    .replace(/'s\b/g, "")
    .replace(/[.',/]/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .map((w) => (w === "co" ? "county" : w))
    .filter((w) => w && !FILLER.has(w))
    .sort()
    .filter((w, i, ws) => w !== ws[i - 1])
    .join(" ");
}

// event_landmark-specific noise: vague area buckets and internal ICE
// placeholders carry no agency identity at all — drop them before matching
// rather than let them dilute/confuse the fuzzy match.
const NOISE_LANDMARK = /general area|non-specific|at large|do not use|^ero\b|sub-office|staging|holdroom/i;

// Verified false-positive: bare regional ICE AOR/sub-office codes like
// "STUART" (a Florida ICE sub-office designation, confirmed by neighboring
// values "STUART-PALM BEACH COUNTY JAIL", "STUART-FMI-FLORIDA") fuzzy-match
// against real agency names by pure coincidence (edit-distance to "Stuart
// Police Department" is small even though they're unrelated) and would
// silently misattribute hundreds of real arrests to the wrong agency. A
// landmark must contain a real institutional word — sheriff/police/jail/
// detention/correctional/dept/department, or an explicit "287(g)-" prefix
// (already a strong signal, stripped by cleanLandmark below) — to be
// eligible for matching at all. This is deliberately stricter than
// detainers' matcher because event_landmark, unlike detainers'
// detention_facility, regularly contains bare place names and ICE-internal
// codes with no facility/agency suffix to filter on.
const LOOKS_LIKE_AGENCY = /sheriff|police|jail|correctional|detention|dept|department|287\s*\(?g\)?/i;

// A minority of landmark values carry an explicit "287(g)-" or "287(G)-"
// prefix directly naming the agency (e.g. "287(G)-KNOX COUNTY SHERIFF'S
// OFFICE") — stripping it exposes the real agency name to the matcher
// instead of it becoming just more noise in the token set.
function cleanLandmark(raw: string): string {
  return raw.replace(/^287\s*\(?g\)?[\s-]+/i, "").trim();
}

async function fetchArrestRows(): Promise<ArrestRow[]> {
  console.log(`Downloading ${PARQUET_URL} ...`);
  const res = await fetch(PARQUET_URL);
  if (!res.ok) throw new Error(`Failed to download arrests parquet: HTTP ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  console.log(`Downloaded ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)} MB, parsing...`);

  const rows = (await parquetReadObjects({
    file: arrayBuffer,
    columns: [
      "apprehension_method",
      "event_landmark",
      "apprehension_state_filled_in",
      "apprehension_date",
      "apprehension_criminality",
      "citizenship_country",
    ],
    compressors,
  })) as ArrestRow[];

  return rows.filter((r) => r.apprehension_method === "287(g) Program");
}

function matchAgency(landmark: string, stateAbbr: string, agencies: Agency[]): Agency | null {
  const inState = agencies.filter((a) => a.state === stateAbbr);
  if (!inState.length) return null;

  const targetKey = distinctiveTokens(landmark);
  if (!targetKey) return null;

  let best: Agency | null = null;
  let bestDist = Infinity;
  let secondDist = Infinity;
  for (const a of inState) {
    const nameKey = distinctiveTokens(a.name);
    const dist = editDistance(targetKey, nameKey);
    if (dist < bestDist) {
      secondDist = bestDist;
      bestDist = dist;
      best = a;
    } else if (dist < secondDist) {
      secondDist = dist;
    }
  }

  if (!best) return null;
  const relDistance = bestDist / Math.max(targetKey.length, 1);
  const hasCloseSecond = secondDist - bestDist <= 1;
  if (relDistance <= 0.15 && !hasCloseSecond) return best;
  return null;
}

async function main() {
  const agencies: Agency[] = JSON.parse(readFileSync(resolve(DIST_DIR, "agency_index.json"), "utf8"));
  let terminated: Agency[] = [];
  try {
    terminated = JSON.parse(readFileSync(resolve(DIST_DIR, "terminated_agencies.json"), "utf8"));
  } catch {
    // optional
  }
  const allAgencies = [...agencies, ...terminated];

  const rows = await fetchArrestRows();
  console.log(`${rows.length} 287(g)-tagged arrest rows found.`);

  type AgencyStats = {
    total: number;
    by_year: Record<string, number>;
    by_criminality: Record<Criminality, number>;
    by_year_criminality: Record<string, Record<Criminality, number>>;
    by_country: Record<string, number>;
  };
  const emptyCriminality = (): Record<Criminality, number> => ({ convicted: 0, pending_charges: 0, other: 0 });
  const emptyStats = (): AgencyStats => ({
    total: 0,
    by_year: {},
    by_criminality: emptyCriminality(),
    by_year_criminality: {},
    by_country: {},
  });

  const statsBySlug = new Map<string, AgencyStats>();
  let matched = 0;
  let unmatched = 0;
  let noLandmark = 0;
  let noisyLandmark = 0;

  for (const row of rows) {
    const stateFull = row.apprehension_state_filled_in
      ? row.apprehension_state_filled_in
          .toLowerCase()
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")
      : null;
    const stateAbbr = stateFull ? STATE_NAME_TO_ABBR[stateFull] : null;

    if (!row.event_landmark) {
      noLandmark++;
      unmatched++;
      continue;
    }
    if (NOISE_LANDMARK.test(row.event_landmark) || !LOOKS_LIKE_AGENCY.test(row.event_landmark)) {
      noisyLandmark++;
      unmatched++;
      continue;
    }
    if (!stateAbbr) {
      unmatched++;
      continue;
    }

    const landmark = cleanLandmark(row.event_landmark);
    const agency = matchAgency(landmark, stateAbbr, allAgencies);
    if (!agency) {
      unmatched++;
      continue;
    }
    matched++;

    const year = row.apprehension_date ? String(row.apprehension_date.getUTCFullYear()) : "unknown";
    const criminality = classifyCriminality(row.apprehension_criminality);
    const country = row.citizenship_country
      ? row.citizenship_country
          .toLowerCase()
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")
      : "Unknown";

    const entry = statsBySlug.get(agency.slug) ?? emptyStats();
    entry.total++;
    entry.by_year[year] = (entry.by_year[year] ?? 0) + 1;
    entry.by_criminality[criminality]++;
    entry.by_year_criminality[year] = entry.by_year_criminality[year] ?? emptyCriminality();
    entry.by_year_criminality[year][criminality]++;
    entry.by_country[country] = (entry.by_country[country] ?? 0) + 1;
    statsBySlug.set(agency.slug, entry);
  }

  console.log(`Matched to an agency: ${matched} (${((matched / rows.length) * 100).toFixed(1)}%)`);
  console.log(`  of which no landmark at all: ${noLandmark}`);
  console.log(`  of which vague/noise landmark: ${noisyLandmark}`);
  console.log(`Unmatched total (incl. above): ${unmatched}`);
  console.log(`Agencies with at least one matched arrest: ${statsBySlug.size}`);

  const out = Object.fromEntries(statsBySlug);
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${statsBySlug.size} agencies' arrest stats → ${OUT_PATH}`);
}

main();

#!/usr/bin/env tsx
/**
 * build-detainer-stats.ts
 *
 * Adds real per-agency ICE detainer counts from the Deportation Data Project
 * (UC Berkeley Law + UCLA) — individual-level enforcement data obtained by
 * FOIA litigation, CC-0. Source: github.com/deportationdata/ice, the
 * "detainers-latest.parquet" file, filtered to rows where the program field
 * indicates a 287(g) agreement drove the detainer.
 *
 * Deliberately lean: no new pipeline stage beyond this one script, no
 * per-record display — just a small aggregated
 * {agency_slug: {total, by_year, by_outcome, by_country}} file, matched
 * against the CURRENT agency_index.json every time this runs (so a
 * newly-added agency or a fresh data pull is picked up automatically on
 * the next run, no manual step). Reuses the same matching approach as
 * match-success-stories.ts (token-based fuzzy match, state-scoped,
 * conservative — only confident matches ship) rather than inventing a new
 * one.
 *
 * by_outcome groups the raw detainer_lift_reason field (16 distinct
 * administrative values) into 5 reader-meaningful buckets — see
 * classifyOutcome() below. by_country is citizenship_country, uncapped (the
 * web side decides how many to show).
 *
 * Usage:
 *   pnpm -F pipeline build:detainer-stats
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { editDistance } from "./lib/editDistance";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, "../web/static/data/dist");
const OUT_PATH = resolve(__dirname, "data/detainer_stats.json");

const PARQUET_URL = "https://media.githubusercontent.com/media/deportationdata/ice/main/data/detainers-latest.parquet";

type Agency = { slug: string; name: string; state: string; agency_type: string };
type DetainerRow = {
  tod_final_program: string | null;
  facility_state: string | null;
  detention_facility: string | null;
  detainer_prepare_date: Date | null;
  detainer_lift_reason: string | null;
  citizenship_country: string | null;
};

// Outcome grouping for detainer_lift_reason — collapses the raw field's 16
// distinct values (mostly administrative variants) into a small set that's
// actually meaningful to a reader. See the dataset's codebook: "Detainer
// Lift Reason ... the key information here concerns whether the person was
// booked into immigration detention as a result of the detainer or the
// detainer was lifted for a different reason."
type Outcome = "booked" | "released" | "declined_by_agency" | "pending" | "other";
function classifyOutcome(reason: string | null): Outcome {
  if (!reason) return "pending"; // no outcome recorded yet as of the data pull
  if (reason === "Booked into Detention") return "booked";
  if (reason === "Detainer Declined by LEA") return "declined_by_agency";
  if (
    [
      "Prosecutorial Discretion",
      "Not Amenable to Removal",
      "Noncitizen Not Amenable to Removal",
      "USC or Presumptive Claim to US Citizenship",
      "Case Closed",
      "Judicial Review",
      "Early Release",
      "No longer in State, Local, or Federal Custody",
    ].includes(reason)
  ) {
    return "released";
  }
  return "other"; // administrative noise: superseding forms, duplicates, resource constraints, etc.
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

// Same normalization technique as match-success-stories.ts's canonName —
// lowercase, strip punctuation/suffixes so "TULSA COUNTY JAIL" and "Tulsa
// County Sheriff's Office" compare on their distinctive tokens.
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
    // Drop a trailing possessive 's as a unit ("sheriff's" -> "sheriff")
    // BEFORE the general punctuation strip below, which would otherwise
    // split it into a spurious standalone "s" token (verified bug:
    // "Tulsa County Sheriff's Office" -> tokens included a stray "s").
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

async function fetchDetainerRows(): Promise<DetainerRow[]> {
  console.log(`Downloading ${PARQUET_URL} ...`);
  const res = await fetch(PARQUET_URL);
  if (!res.ok) throw new Error(`Failed to download detainers parquet: HTTP ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  console.log(`Downloaded ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)} MB, parsing...`);

  const rows = (await parquetReadObjects({
    file: arrayBuffer,
    columns: [
      "tod_final_program",
      "facility_state",
      "detention_facility",
      "detainer_prepare_date",
      "detainer_lift_reason",
      "citizenship_country",
    ],
    compressors,
  })) as DetainerRow[];

  return rows.filter((r) => /287\s*g/i.test(r.tod_final_program ?? ""));
}

function matchAgency(facilityName: string, stateAbbr: string, agencies: Agency[]): Agency | null {
  const inState = agencies.filter((a) => a.state === stateAbbr);
  if (!inState.length) return null;

  const targetKey = distinctiveTokens(facilityName);
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

  // Conservative: require a tight relative distance AND a clear margin over
  // the runner-up, same spirit as match-success-stories.ts's "high"
  // confidence tier. A wrong agency attached to a real detainer count is a
  // real factual error, so this only accepts confident matches.
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

  const rows = await fetchDetainerRows();
  console.log(`${rows.length} 287(g)-tagged detainer rows found.`);

  type AgencyStats = {
    total: number;
    by_year: Record<string, number>;
    by_outcome: Record<Outcome, number>;
    by_year_outcome: Record<string, Record<Outcome, number>>;
    by_country: Record<string, number>;
  };
  const emptyOutcomes = (): Record<Outcome, number> => ({
    booked: 0, released: 0, declined_by_agency: 0, pending: 0, other: 0,
  });
  const emptyStats = (): AgencyStats => ({
    total: 0,
    by_year: {},
    by_outcome: emptyOutcomes(),
    by_year_outcome: {},
    by_country: {},
  });

  const statsBySlug = new Map<string, AgencyStats>();
  let matched = 0;
  let unmatched = 0;

  for (const row of rows) {
    // facility_state arrives all-caps ("NEW JERSEY") — title-case each word,
    // not just the first character of the whole string, or multi-word
    // states never resolve against STATE_NAME_TO_ABBR.
    const stateFull = row.facility_state
      ? row.facility_state
          .toLowerCase()
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")
      : null;
    const stateAbbr = stateFull ? STATE_NAME_TO_ABBR[stateFull] : null;
    const facility = row.detention_facility;
    if (!stateAbbr || !facility) {
      unmatched++;
      continue;
    }

    const agency = matchAgency(facility, stateAbbr, allAgencies);
    if (!agency) {
      unmatched++;
      continue;
    }
    matched++;

    const year = row.detainer_prepare_date ? String(row.detainer_prepare_date.getUTCFullYear()) : "unknown";
    const outcome = classifyOutcome(row.detainer_lift_reason);
    // Country names arrive all-caps ("EL SALVADOR", "CHINA, PEOPLES
    // REPUBLIC OF") — title-case each word, not just the first character of
    // the whole string, same fix as the facility-state title-casing above.
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
    entry.by_outcome[outcome]++;
    entry.by_year_outcome[year] = entry.by_year_outcome[year] ?? emptyOutcomes();
    entry.by_year_outcome[year][outcome]++;
    entry.by_country[country] = (entry.by_country[country] ?? 0) + 1;
    statsBySlug.set(agency.slug, entry);
  }

  console.log(`Matched to an agency: ${matched} (${((matched / rows.length) * 100).toFixed(0)}%)`);
  console.log(`Unmatched (state unresolved or no confident agency match): ${unmatched}`);
  console.log(`Agencies with at least one matched detainer: ${statsBySlug.size}`);

  const out = Object.fromEntries(statsBySlug);
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${statsBySlug.size} agencies' detainer stats → ${OUT_PATH}`);
}

main();

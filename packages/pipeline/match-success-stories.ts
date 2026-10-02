#!/usr/bin/env tsx
/**
 * match-success-stories.ts
 *
 * Matches each extracted story's free-text agency description
 * (success_stories_raw.json's agency_text_raw) to a real agency_slug in the
 * live agency_index.json. Writes agency_slug/match_confidence/match_candidates
 * back into success_stories_raw.json — nothing here ever reaches the web app
 * directly (see build-success-stories.ts for that; it applies overrides and
 * confidence-tier filtering).
 *
 * Confidence tiers:
 *   exact — normalized candidate string exact-matches exactly one row in the
 *           resolved state+type bucket.
 *   high  — a close fuzzy match, unambiguous (no near-tied second candidate).
 *   low   — a fuzzy match outside the tight threshold, or an ambiguous tie,
 *           or the type bucket had to fall back through more than one guess.
 *   none  — nothing cleared even the low threshold, or the state couldn't be
 *           resolved (state_header/agency_state_hint conflict or missing).
 *
 * Mismatching a real conviction narrative to the wrong sheriff's office is a
 * more serious error than getting a state law's classification wrong, so
 * this matcher is deliberately MORE conservative than ingest.ts's own
 * matchAgency() (which matches against the FBI LEE dataset, not this). Only
 * exact/high confidence — or a human override — ever reach the public file.
 *
 * Usage:
 *   pnpm -F pipeline match:success-stories
 *   pnpm -F pipeline match:success-stories -- --report   # print the review queue, write nothing
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { editDistance } from "./lib/editDistance";
import type { Story } from "./extract-success-stories";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORIES_PATH = resolve(__dirname, "data/success_stories_raw.json");
const DIST_DIR = resolve(__dirname, "../web/static/data/dist");
const AGENCY_INDEX_PATH = resolve(DIST_DIR, "agency_index.json");
const TERMINATED_PATH = resolve(DIST_DIR, "terminated_agencies.json");
const PENDING_PATH = resolve(DIST_DIR, "pending_agencies.json");

const args = process.argv.slice(2);
const REPORT_ONLY = args.includes("--report");

// ── Types ─────────────────────────────────────────────────────────────────
type Agency = {
  slug: string;
  name: string;
  state: string;
  county?: string;
  city?: string;
  agency_type: string; // "County" | "Municipality" | "State Agency"
};

type MatchConfidence = "exact" | "high" | "low" | "none";
type MatchCandidate = { slug: string; name: string; distance: number };
type MatchedStory = Story & {
  agency_slug: string | null;
  match_confidence: MatchConfidence;
  match_candidates: MatchCandidate[];
};

// ── Normalization (adapted from ingest.ts's canonName — not imported since
// that's module-private there; same technique, applied to both story text
// and agency-index names for consistent comparison) ─────────────────────
function canonName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.',/]/g, " ")
    .replace(/-/g, " ")
    .replace(/&/g, " and ")
    .replace(/\bft\b/g, "fort")
    .replace(/\bst\b/g, "saint")
    .replace(/\bdept\b/g, "department")
    .replace(/\bdoc\b/g, "department of corrections")
    .replace(/\bpd\b/g, "police department")
    .replace(/\bso\b/g, "sheriffs office")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Words safe to drop when comparing County/Municipal agency names — a
// county's own organizational-structure wording varies ("Sheriff's Office"
// vs "Sheriff's Department") without it being a different agency.
const LOCAL_FILLER = new Set([
  "police", "department", "sheriffs", "sheriff", "office", "of", "the", "county",
  "city", "town", "village", "borough", "services", "service",
  "board", "commissioners", "detention", "center", "authority", "and",
  "district", "program", "reentry", "rehabilitation", "287", "g",
]);
// State agencies need a much narrower filler list: words like "corrections",
// "public", "safety" are exactly what distinguishes one state department
// from another (verified bug: "Georgia Department of Corrections" vs
// "Georgia Department of Public Safety" both collapsed to just {"georgia"}
// under the local-agency filler list, making two different real agencies
// indistinguishable).
const STATE_FILLER = new Set([
  "department", "of", "the", "and", "program", "287", "g",
  // Descriptive sub-program wording some states append to their DOC's name
  // in story text (e.g. "Arizona Department of Corrections, Rehabilitation
  // and Reentry") that isn't part of the agency's actual registered name.
  "rehabilitation", "reentry",
]);

function distinctiveTokens(name: string, agencyType?: Agency["agency_type"]): Set<string> {
  const filler = agencyType === "State Agency" ? STATE_FILLER : LOCAL_FILLER;
  return new Set(canonName(name).split(" ").filter((w) => w && !filler.has(w)));
}

// ── Agency-type classification from free text (cheap keyword signals) ──────
function classifyLikelyType(text: string): Agency["agency_type"][] {
  const t = text.toLowerCase();
  if (/\bdepartment of corrections\b|\bstate police\b|\bhighway patrol\b|\bstate patrol\b/.test(t)) {
    return ["State Agency", "County", "Municipality"];
  }
  if (/\bsheriff|(?:^|\s)county\b/.test(t)) {
    return ["County", "Municipality", "State Agency"];
  }
  if (/\bpolice department\b|\bpd\b/.test(t)) {
    return ["Municipality", "County", "State Agency"];
  }
  // Ambiguous — try all three, County first (the most common 287(g) type).
  return ["County", "Municipality", "State Agency"];
}

// ── Candidate generation against the agency index ───────────────────────────
// Distance is computed on the DISTINCTIVE-TOKEN string (place name only,
// sorted so word order doesn't matter), not the full normalized name —
// generic words like "Office" vs "Department" or "Sheriff's" vs "Sheriff"
// otherwise dominate the edit distance even though they're not what
// distinguishes one agency from another. Verified case: "Lexington County
// Sheriff's Office" (story text) vs the real agency "Lexington County
// Sheriff's Department" — full-string distance is 9 (mostly "office" vs
// "department"), but the distinctive place-name token "lexington" is an
// exact match, which is what should actually drive the score.
function findCandidates(agencyText: string, state: string, agencies: Agency[]): MatchCandidate[] {
  const inState = agencies.filter((a) => a.state === state);
  if (!inState.length) return [];

  const typeOrder = classifyLikelyType(agencyText);
  // Each candidate is compared using ITS OWN type's filler set (a state
  // agency's key keeps "corrections"/"public safety"; a county/municipal
  // candidate's key drops "office"/"department"/"sheriff") — the story
  // text's key is recomputed per-candidate to match, since the right
  // filler set depends on what's actually being compared against, not
  // just a guess about the story's own phrasing.
  const scored: MatchCandidate[] = inState.map((a) => {
    const targetKey = [...distinctiveTokens(agencyText, a.agency_type)].sort().join(" ");
    const nameKey = [...distinctiveTokens(a.name, a.agency_type)].sort().join(" ");
    const dist = editDistance(targetKey, nameKey);
    return { slug: a.slug, name: a.name, distance: dist, _agency: a } as MatchCandidate & { _agency: Agency };
  });

  // Sort by distance, but prefer the classified-likely type order on ties.
  scored.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    const aType = (a as any)._agency.agency_type as string;
    const bType = (b as any)._agency.agency_type as string;
    return typeOrder.indexOf(aType) - typeOrder.indexOf(bType);
  });

  return scored.slice(0, 5).map(({ slug, name, distance }) => ({ slug, name, distance }));
}

// ── Confidence classification ───────────────────────────────────────────────
function classifyMatch(candidates: MatchCandidate[], targetKeyLength: number): { agency_slug: string | null; confidence: MatchConfidence } {
  if (!candidates.length) return { agency_slug: null, confidence: "none" };

  const [best, second] = candidates;

  if (best.distance === 0) {
    return { agency_slug: best.slug, confidence: "exact" };
  }

  // "high" requires: tight distance relative to string length, AND a clear
  // margin over the second-place candidate (no near-tie).
  const relDistance = best.distance / Math.max(targetKeyLength, 1);
  const hasCloseSecond = second != null && second.distance - best.distance <= 1;

  if (relDistance <= 0.12 && !hasCloseSecond) {
    return { agency_slug: best.slug, confidence: "high" };
  }
  if (relDistance <= 0.35) {
    return { agency_slug: best.slug, confidence: "low" };
  }
  return { agency_slug: null, confidence: "none" };
}

// ── State resolution ─────────────────────────────────────────────────────
// A story's agency_state_hint (explicit in-text state signal) is more
// trustworthy than state_header — confirmed during extraction review: ICE's
// own documents place at least 7 stories under the wrong state heading.
// Prefer agency_state_hint when present; fall back to state_header's
// abbreviation otherwise.
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

function resolveState(story: Story): string | null {
  if (story.agency_state_hint) return story.agency_state_hint;
  return STATE_NAME_TO_ABBR[story.state_header] ?? null;
}

// ── Main ─────────────────────────────────────────────────────────────────
function main() {
  const stories: Record<string, Story> = JSON.parse(readFileSync(STORIES_PATH, "utf8"));
  // Match against the active roster PLUS terminated/pending agencies — a
  // story from an older PDF may reference an agency that has since left the
  // 287(g) program, and the site already renders a page for those (agency
  // page loader resolves slugs across all three lists). Without this, a
  // historically-accurate story about a real, once-participating agency
  // would incorrectly land in the "none" review queue.
  const readAgencies = (path: string): Agency[] => {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return [];
    }
  };
  const agenciesRaw: Agency[] = [
    ...readAgencies(AGENCY_INDEX_PATH),
    ...readAgencies(TERMINATED_PATH),
    ...readAgencies(PENDING_PATH),
  ];
  // Dedupe by slug in case an agency is (transiently) listed in more than
  // one file — keep the active-roster copy when there's a conflict.
  const bySlug = new Map<string, Agency>();
  for (const a of agenciesRaw) if (!bySlug.has(a.slug)) bySlug.set(a.slug, a);
  const agencies: Agency[] = [...bySlug.values()];

  const matched: Record<string, MatchedStory> = {};
  const tierCounts: Record<MatchConfidence, number> = { exact: 0, high: 0, low: 0, none: 0 };

  for (const [id, story] of Object.entries(stories)) {
    const state = resolveState(story);
    if (!state || !story.agency_text_raw) {
      matched[id] = { ...story, agency_slug: null, match_confidence: "none", match_candidates: [] };
      tierCounts.none++;
      continue;
    }
    const candidates = findCandidates(story.agency_text_raw, state, agencies);
    // Recompute the key length using the SAME filler set findCandidates used
    // for the winning (lowest-distance) candidate, so the relative-distance
    // threshold in classifyMatch is measured against the right baseline.
    const winningType = candidates[0]
      ? agencies.find((a) => a.slug === candidates[0].slug)?.agency_type
      : undefined;
    const targetKeyLength = [...distinctiveTokens(story.agency_text_raw, winningType)].sort().join(" ").length;
    const { agency_slug, confidence } = classifyMatch(candidates, targetKeyLength);
    matched[id] = { ...story, agency_slug, match_confidence: confidence, match_candidates: candidates };
    tierCounts[confidence]++;
  }

  console.log("Match confidence tiers:");
  console.log(`  exact: ${tierCounts.exact}`);
  console.log(`  high:  ${tierCounts.high}`);
  console.log(`  low:   ${tierCounts.low}`);
  console.log(`  none:  ${tierCounts.none}`);
  console.log(`  total: ${Object.keys(matched).length}`);

  if (REPORT_ONLY) {
    console.log("\n--report: reviewing low/none confidence stories (nothing written)\n");
    for (const s of Object.values(matched)) {
      if (s.match_confidence !== "low" && s.match_confidence !== "none") continue;
      console.log(`--- ${s.id} | ${s.match_confidence} | state_header=${s.state_header} hint=${s.agency_state_hint ?? "—"} ---`);
      console.log(`  agency_text_raw: "${s.agency_text_raw}"`);
      for (const c of s.match_candidates.slice(0, 3)) {
        console.log(`    candidate: ${c.slug} ("${c.name}") distance=${c.distance}`);
      }
      if (!s.match_candidates.length) console.log("    (no candidates found — state unresolved or no agencies in state)");
      console.log();
    }
    return;
  }

  writeFileSync(STORIES_PATH, JSON.stringify(matched, null, 2));
  console.log(`\nWrote ${Object.keys(matched).length} matched stories → ${STORIES_PATH}`);
}

main();

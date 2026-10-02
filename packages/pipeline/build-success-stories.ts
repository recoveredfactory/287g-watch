#!/usr/bin/env tsx
/**
 * build-success-stories.ts
 *
 * Final stage: reads success_stories_raw.json (extracted + matched, see
 * extract-success-stories.ts / match-success-stories.ts) and
 * success_stories_overrides.yaml (hand-reviewed corrections), applies
 * overrides, and writes the tracked, committed
 * packages/pipeline/data/success_stories.json — the file the web app
 * actually reads (via copy-static-data.mjs → static/data/dist/).
 *
 * Publish policy, following the legislation_stance.yaml precedent: only
 * exact/high-confidence matches — or a story a human has explicitly
 * corrected via the overrides file — ever reach this output. A low/none
 * confidence story with no override stays out of the public file entirely
 * (it's still visible in success_stories_raw.json for review). Getting the
 * WRONG agency attached to a real conviction narrative is a more serious
 * error than shipping a state law's classification wrong, so this stays
 * conservative by default.
 *
 * Usage:
 *   pnpm -F pipeline build:success-stories
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_PATH = resolve(__dirname, "data/success_stories_raw.json");
const OVERRIDES_PATH = resolve(__dirname, "data/success_stories_overrides.yaml");
const OUT_PATH = resolve(__dirname, "data/success_stories.json");

type MatchConfidence = "exact" | "high" | "low" | "none";
type MatchedStory = {
  id: string;
  source_pdf: string;
  source_period: string;
  page_number: number | null;
  state_header: string;
  raw_text: string;
  date_encountered: string | null;
  model_type: string | null;
  agency_slug: string | null;
  match_confidence: MatchConfidence;
};

type Override = {
  agency_slug?: string;
  reviewed_by?: string;
  reviewed_date?: string;
  note?: string;
  exclude?: boolean;
};

// What the web app actually reads — kept slim. Fields only useful for
// matching/review (match_candidates, agency_text_raw, parse_warnings, etc.)
// stay in the raw file and don't ship.
type PublicStory = {
  id: string;
  agency_slug: string;
  date_encountered: string | null;
  model_type: string | null;
  raw_text: string;
  source_pdf: string;
  source_period: string;
  page_number: number | null;
};

function main() {
  const raw: Record<string, MatchedStory> = JSON.parse(readFileSync(RAW_PATH, "utf8"));
  const overrides: Record<string, Override> = existsSync(OVERRIDES_PATH)
    ? (parseYaml(readFileSync(OVERRIDES_PATH, "utf8")) ?? {})
    : {};

  const orphanedOverrideIds = Object.keys(overrides).filter((id) => !(id in raw));
  if (orphanedOverrideIds.length) {
    console.warn(`⚠ ${orphanedOverrideIds.length} override(s) reference a story id that no longer exists (extraction likely re-ran): ${orphanedOverrideIds.join(", ")}`);
  }

  const published: PublicStory[] = [];
  let excludedByOverride = 0;
  let publishedByOverride = 0;
  let publishedByConfidence = 0;
  let heldBack = 0;

  for (const story of Object.values(raw)) {
    const override = overrides[story.id];

    if (override?.exclude) {
      excludedByOverride++;
      continue;
    }

    const effectiveSlug = override?.agency_slug ?? story.agency_slug;
    const isConfidentMatch = story.match_confidence === "exact" || story.match_confidence === "high";
    const isHumanCorrected = Boolean(override?.agency_slug);

    if (!effectiveSlug || (!isConfidentMatch && !isHumanCorrected)) {
      heldBack++;
      continue;
    }

    if (isHumanCorrected) publishedByOverride++;
    else publishedByConfidence++;

    published.push({
      id: story.id,
      agency_slug: effectiveSlug,
      date_encountered: story.date_encountered,
      model_type: story.model_type,
      raw_text: story.raw_text,
      source_pdf: story.source_pdf,
      source_period: story.source_period,
      page_number: story.page_number,
    });
  }

  console.log(`Published: ${published.length}`);
  console.log(`  by confidence (exact/high): ${publishedByConfidence}`);
  console.log(`  by human override: ${publishedByOverride}`);
  console.log(`Held back (low/none, uncorrected): ${heldBack}`);
  console.log(`Excluded by override: ${excludedByOverride}`);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(published, null, 2));
  console.log(`\nWrote ${published.length} stories → ${OUT_PATH}`);
}

main();

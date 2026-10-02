#!/usr/bin/env tsx
/**
 * Build the per-state legislative-stance dataset the web app reads.
 *
 * Source of truth is data/legislation_stance.yaml — a HAND-MAINTAINED file, not
 * something this script generates or re-classifies. A previous AI-driven
 * version of this data (the retired `news_287g_state_summary` program) got at
 * least one state backwards — Iowa has a law that COMPELS ICE cooperation but
 * was labeled "anti" — so classification stays a human editorial decision. See
 * PR #275 review §4.4 and the header comment in the yaml source for the full
 * story.
 *
 * This script does three things, all mechanical:
 *   1. Validate the source file (every state+DC present, valid stance values,
 *      no missing required fields).
 *   2. Flag entries that are stale (verified_date older than STALE_DAYS) or
 *      still carry a review_note (an unresolved uncertainty from the initial
 *      research pass) — printed as warnings, not build failures, so a
 *      known-uncertain entry doesn't block a deploy but also doesn't go
 *      unnoticed.
 *   3. Write the slim shape the web app's StateIndexLegislation type expects.
 *
 * Run:
 *   pnpm tsx build-legislation-stance.ts
 *
 * Output: packages/web/static/data/dist/legislation_stance.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { STATE_NAMES } from './states'

// Legislative stance is a state-legislature concept — Guam and the Northern
// Mariana Islands (present in STATE_NAMES for the news/roster pipelines,
// which cover every agency's jurisdiction) don't have the same structure and
// aren't in scope here.
const TERRITORIES = new Set(['GU', 'MP'])

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(__dirname, 'data/legislation_stance.yaml')
const OUT_DIR = resolve(__dirname, '../web/static/data/dist')
const OUT = resolve(OUT_DIR, 'legislation_stance.json')

// How long a hand-verified entry is trusted before the build calls it out as
// due for a re-check. This area moves fast — 5+ states changed posture in the
// 2025-2026 session alone — so six months is a deliberately tight cadence,
// not a formality.
const STALE_DAYS = 180

type SourceType = 'statute' | 'executive_order' | 'case_law' | 'ag_opinion' | 'court_order' | 'none'
type Stance = 'pro' | 'anti' | 'none'

type SourceEntry = {
  stance: Stance
  source_type: SourceType
  common_name: string | null
  description: string
  source_url: string
  verified_date: string
  verified_by: string
  review_note?: string
}

type SourceFile = { states: Record<string, SourceEntry> }

// What the web app actually reads (routes/states/+page.server.ts's
// StateIndexLegislation, routes/state/[abbr]/+page.server.ts's
// NewsLegislation) — kept deliberately slim; the richer fields above
// (source_type, common_name, verified_date/_by, review_note) are editorial
// metadata for whoever maintains this file, not something the page renders.
type OutEntry = {
  stance: Stance
  active: boolean
  description: string
}

const VALID_STANCES: Stance[] = ['pro', 'anti', 'none']
const VALID_SOURCE_TYPES: SourceType[] = [
  'statute', 'executive_order', 'case_law', 'ag_opinion', 'court_order', 'none',
]

const raw = readFileSync(SRC, 'utf8')
const doc = parseYaml(raw) as SourceFile
const entries = doc.states ?? {}

const errors: string[] = []
const warnings: string[] = []

// 1. Coverage: every state + DC (excluding territories, out of scope — see
// above) must have an entry, and there should be no stray/misspelled
// abbreviations that silently never render.
const expected = new Set(Object.keys(STATE_NAMES).filter((abbr) => !TERRITORIES.has(abbr)))
const present = new Set(Object.keys(entries))
for (const abbr of expected) {
  if (!present.has(abbr)) errors.push(`missing entry for ${abbr}`)
}
for (const abbr of present) {
  if (!expected.has(abbr)) errors.push(`unexpected abbreviation "${abbr}" — not a state/DC, or a territory out of scope`)
}

// 2. Per-entry shape + staleness/review-note flags.
const now = Date.now()
for (const [abbr, e] of Object.entries(entries)) {
  if (!VALID_STANCES.includes(e.stance)) {
    errors.push(`${abbr}: invalid stance "${e.stance}"`)
  }
  if (!VALID_SOURCE_TYPES.includes(e.source_type)) {
    errors.push(`${abbr}: invalid source_type "${e.source_type}"`)
  }
  if (!e.description?.trim()) {
    errors.push(`${abbr}: empty description`)
  }
  if (e.stance !== 'none' && !e.source_url?.trim()) {
    errors.push(`${abbr}: stance is "${e.stance}" but source_url is empty`)
  }
  if (!e.verified_date || Number.isNaN(Date.parse(e.verified_date))) {
    errors.push(`${abbr}: missing/invalid verified_date`)
    continue
  }
  const ageDays = (now - Date.parse(e.verified_date)) / 86_400_000
  if (ageDays > STALE_DAYS) {
    warnings.push(`${abbr}: verified_date ${e.verified_date} is ${Math.round(ageDays)} days old (>${STALE_DAYS}) — due for a re-check`)
  }
  if (e.review_note) {
    warnings.push(`${abbr}: has an open review_note — ${e.review_note.trim().split('\n')[0]}`)
  }
}

if (errors.length) {
  console.error(`✗ ${errors.length} error(s) in ${SRC}:`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

if (warnings.length) {
  console.warn(`⚠ ${warnings.length} item(s) worth a look in ${SRC}:`)
  for (const w of warnings) console.warn(`  - ${w}`)
}

// 3. Write the slim per-state map the web app reads. `active` mirrors the
// original NewsLegislation shape (a placeholder for "there's a live bill
// pending," not surfaced in the UI yet per LegislationBadge.svelte's own
// comment) — always false here since this file only tracks enacted,
// verified law, not pending bills.
const out: Record<string, OutEntry> = {}
for (const [abbr, e] of Object.entries(entries)) {
  out[abbr] = { stance: e.stance, active: false, description: e.description.trim() }
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`\nWrote ${Object.keys(out).length} states → ${OUT}`)

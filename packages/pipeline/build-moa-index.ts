#!/usr/bin/env tsx
/**
 * build-moa-index.ts
 *
 * Crawls the appelson/Tracking_287g agreements/ directory on GitHub and
 * builds a lookup of state+agency → GitHub tree URL for MOA PDFs.
 *
 * Designed to stay well within GitHub API rate limits (unauthenticated: 60/hr).
 * Set GH_TOKEN env var to increase to 5000/hr if you want the full PDF URLs.
 *
 * Run once (or when new MOAs are added to the archive):
 *   pnpm -F pipeline build:moa-index
 *
 * Output: packages/pipeline/data/moa_index.json
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = resolve(__dirname, 'data/moa_index.json')

const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const ghHeaders: Record<string, string> = {
  'User-Agent': '287g-explorer-pipeline',
  ...(GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {}),
}

if (!GH_TOKEN) {
  console.warn('⚠  No GH_TOKEN set. Using unauthenticated API (60 req/hr). Set GH_TOKEN for faster runs.')
}

const BASE_API = 'https://api.github.com/repos/appelson/Tracking_287g/contents'
const BASE_RAW = 'https://raw.githubusercontent.com/appelson/Tracking_287g/main'

const STATE_ABBREVS: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR',
  CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE',
  FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID',
  ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS',
  KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
  MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS',
  MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV',
  NEW_HAMPSHIRE: 'NH', NEW_JERSEY: 'NJ', NEW_MEXICO: 'NM', NEW_YORK: 'NY',
  NORTH_CAROLINA: 'NC', NORTH_DAKOTA: 'ND', OHIO: 'OH', OKLAHOMA: 'OK',
  OREGON: 'OR', PENNSYLVANIA: 'PA', RHODE_ISLAND: 'RI', SOUTH_CAROLINA: 'SC',
  SOUTH_DAKOTA: 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
  VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', WEST_VIRGINIA: 'WV',
  WISCONSIN: 'WI', WYOMING: 'WY', DISTRICT_OF_COLUMBIA: 'DC',
}

type GHEntry = { name: string; type: string }

async function ghGet(path: string): Promise<GHEntry[]> {
  const url = `${BASE_API}/${path}`
  const r = await fetch(url, { headers: ghHeaders })
  if (!r.ok) {
    console.warn(`  ⚠ API ${r.status} for ${path} — skipping`)
    return []
  }
  return r.json() as Promise<GHEntry[]>
}

function moaNorm(name: string): string {
  return name
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── 1. Find snapshots that actually contain state directories ─────────────────

console.log('Fetching agreements directory listing...')
const allEntries = await ghGet('agreements')
const snapshots = allEntries
  .filter((e) => e.type === 'dir' && !e.name.startsWith('.'))
  .map((e) => e.name)
  .sort() // oldest first; newer overwrites on collision

console.log(`Found ${snapshots.length} snapshot directories`)

// ── 2. For each snapshot, check top-level for state dirs then crawl agencies ──

// Key: "STATE_ABBR|normalizedName" → GitHub tree URL
const index = new Map<string, string>()

let apiCalls = 0

for (const snap of snapshots) {
  const stateDirs = (await ghGet(`agreements/${snap}`))
    .filter((e) => e.type === 'dir' && !e.name.startsWith('.'))
  apiCalls++

  if (stateDirs.length === 0) continue

  const stateCount = stateDirs.filter(e => STATE_ABBREVS[e.name]).length
  if (stateCount === 0) continue

  process.stdout.write(`  ${snap}: ${stateDirs.length} states — crawling...`)

  let added = 0
  for (const stateDir of stateDirs) {
    const stateAbbr = STATE_ABBREVS[stateDir.name]
    if (!stateAbbr) continue

    const agencyDirs = (await ghGet(`agreements/${snap}/${stateDir.name}`))
      .filter((e) => e.type === 'dir' && !e.name.startsWith('.'))
    apiCalls++

    for (const agencyDir of agencyDirs) {
      const key = `${stateAbbr}|${moaNorm(agencyDir.name)}`
      // Tree URL so the user sees all PDFs for this agency (may be multiple per model)
      const treeUrl = `https://github.com/appelson/Tracking_287g/tree/main/agreements/${snap}/${stateDir.name}/${encodeURIComponent(agencyDir.name)}`
      index.set(key, treeUrl) // newer snapshot overwrites older
      added++
    }
  }

  process.stdout.write(` ${added} agencies (${apiCalls} API calls total)\n`)
}

// ── 3. Write output ───────────────────────────────────────────────────────────

const result: Record<string, string> = {}
for (const [key, url] of index) result[key] = url

mkdirSync(resolve(__dirname, 'data'), { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify(result, null, 2))
console.log(`\nWrote ${index.size} MOA entries → ${OUT_PATH}`)
console.log(`Total GitHub API calls: ${apiCalls}`)

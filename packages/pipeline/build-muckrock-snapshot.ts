#!/usr/bin/env tsx
/**
 * Build MuckRock FOIA snapshot.
 *
 * Reads packages/pipeline/data/muckrock_seed.json (curated list of FOIA IDs and
 * their manual agency_slug matches), refreshes per-request status + datetime
 * fields via MuckRock's public API (/api_v1/foia/{id}/), and writes a slim
 * snapshot to packages/web/static/data/dist/muckrock_requests.json.
 *
 * Why a seed file: MuckRock has no /api_v1/multirequest/ endpoint exposing the
 * child FOIA list, and the per-FOIA endpoint doesn't surface jurisdiction or
 * the parent multirequest. The seed captures the 8 IDs in this multirequest
 * plus manual agency_slug mappings — only 2 of 8 target agencies appear in our
 * 287(g) index, so fuzzy/LLM matching wouldn't help here.
 *
 * Run:
 *   pnpm tsx build-muckrock-snapshot.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SEED_PATH = resolve(__dirname, 'data/muckrock_seed.json')
const OUT_DIR = resolve(__dirname, '../web/static/data/dist')
const OUT_PATH = resolve(OUT_DIR, 'muckrock_requests.json')
const UA = '287g-explorer-pipeline (https://287g.recoveredfactory.net)'
const FETCH_DELAY_MS = 300

type SeedRequest = {
  foia_id: number
  absolute_url: string
  agency_label: string
  jurisdiction: string
  agency_slug: string | null
  match_note?: string
}

type Seed = {
  multirequest: { id: number; title: string; absolute_url: string; filer: string }
  reporter_guide: { title: string; absolute_url: string; publisher: string }
  requests: SeedRequest[]
}

type FoiaApiResponse = {
  id: number
  title: string
  status: string
  datetime_submitted: string | null
  datetime_done: string | null
  datetime_updated: string | null
  absolute_url: string
}

type SnapshotRequest = SeedRequest & {
  title: string
  status: string
  datetime_submitted: string | null
  datetime_done: string | null
  datetime_updated: string | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchFoia(id: number): Promise<FoiaApiResponse | null> {
  const url = `https://www.muckrock.com/api_v1/foia/${id}/`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) {
    console.warn(`  ⚠ ${id}: HTTP ${res.status}`)
    return null
  }
  return (await res.json()) as FoiaApiResponse
}

const seed: Seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'))
console.log(`Refreshing ${seed.requests.length} FOIA requests from MuckRock API...`)

const enriched: SnapshotRequest[] = []
for (const req of seed.requests) {
  const api = await fetchFoia(req.foia_id)
  if (!api) {
    enriched.push({
      ...req,
      title: req.agency_label,
      status: 'unknown',
      datetime_submitted: null,
      datetime_done: null,
      datetime_updated: null,
    })
    continue
  }
  console.log(`  ${req.foia_id} ${api.status.padEnd(20)} ${req.agency_label}`)
  enriched.push({
    ...req,
    title: api.title,
    status: api.status,
    datetime_submitted: api.datetime_submitted,
    datetime_done: api.datetime_done,
    datetime_updated: api.datetime_updated,
  })
  await sleep(FETCH_DELAY_MS)
}

const matched = enriched.filter((r) => r.agency_slug !== null).length
const snapshot = {
  multirequest: seed.multirequest,
  reporter_guide: seed.reporter_guide,
  snapshot_date: new Date().toISOString().slice(0, 10),
  requests: enriched,
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify(snapshot, null, 2))
console.log(`\nWrote ${enriched.length} requests (${matched} matched to agencies) → ${OUT_PATH}`)

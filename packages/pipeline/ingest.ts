#!/usr/bin/env tsx
/**
 * 287(g) data pipeline
 *
 * Pulls from appelson/Tracking_287g sheets snapshots (xlsx):
 *   - Discovers the latest snapshot directory via GitHub API
 *   - Downloads and parses the xlsx file
 *   - Geocodes via Census Bureau county centroid Gazetteer
 *   - Samples one snapshot per week to build per-agency agreement history
 *
 * Output: packages/web/static/data/dist/agency_index.json
 */

import AdmZip from 'adm-zip'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import slugifyLib from 'slugify'
import { read as xlsxRead, utils as xlsxUtils } from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../web/static/data/dist')

const GITHUB_SHEETS_API =
  'https://api.github.com/repos/appelson/Tracking_287g/contents/sheets'
const COUNTY_GAZETTEER_URL =
  'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_counties_national.zip'

const STATE_ABBREVS: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR',
  CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE',
  FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID',
  ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS',
  KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
  MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS',
  MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK',
  OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
  VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI', WYOMING: 'WY', 'DISTRICT OF COLUMBIA': 'DC',
  'PUERTO RICO': 'PR', GUAM: 'GU', 'VIRGIN ISLANDS': 'VI',
  'AMERICAN SAMOA': 'AS', 'NORTHERN MARIANA ISLANDS': 'MP',
}

const MODEL_PRIORITY = [
  'Jail Enforcement Model',
  'Task Force Model',
  'Warrant Service Officer',
]

const COUNTY_SUFFIX =
  /\s+(County|Parish|Borough|Census Area|City and Borough|Municipality|city)$/i

// ── Types ──────────────────────────────────────────────────────────────────────

interface RawRow {
  STATE?: unknown
  'LAW ENFORCEMENT AGENCY'?: unknown
  TYPE?: unknown
  COUNTY?: unknown
  'SUPPORT TYPE'?: unknown
  SIGNED?: unknown
  MOA?: unknown
}

interface NormalizedRow {
  name: string
  state: string
  county: string | null
  agency_type: string | null
  model: string | null
  signed_date: string | null
  moa_url: string | null
}

export interface HistoryEvent {
  date: string      // YYYY-MM-DD
  added: string[]   // models that appeared since prior sample
  removed: string[] // models that disappeared since prior sample
}

interface Agency {
  slug: string
  name: string
  state: string
  county: string | null
  city: null
  agency_type: string
  models: string[]
  primary_model: string | null
  signed_date: string | null
  population: null
  lat: number | null
  lng: number | null
  moa_url: string | null
  ori: null
  snapshot_date: string | null
  history: HistoryEvent[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function titleAgency(s: string): string {
  const lower = new Set(['of', 'the', 'a', 'an', 'and', 'or', 'in', 'at', 'by', 'for', 'to'])
  return s
    .trim()
    .split(/\s+/)
    .map((word, i) => {
      const lw = word.toLowerCase()
      const capped = lw.charAt(0).toUpperCase() + lw.slice(1)
      return i === 0 || !lower.has(lw) ? capped : lw
    })
    .join(' ')
}

function makeSlug(name: string, state: string): string {
  return slugifyLib(`${name} ${state}`, { lower: true, strict: true })
}

function parseSignedDate(val: unknown): string | null {
  if (val == null || val === '') return null
  if (val instanceof Date) return val.toISOString().split('T')[0]
  if (typeof val === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + val * 86_400_000)
    return d.toISOString().split('T')[0]
  }
  if (typeof val === 'string') {
    const d = new Date(val.trim())
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
  }
  return null
}

function str(val: unknown): string {
  return String(val ?? '').trim()
}

// Stable cross-snapshot key: lowercase, alphanumeric only
function historyKey(name: string, state: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
  return `${state.toUpperCase()}\x00${normalized}`
}

function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-${String(weekNo).padStart(2, '0')}`
}

type GHEntry = { name: string; type: string; url: string }

// Pick the most recent snapshot directory for each calendar week
function sampleWeekly(dirs: GHEntry[]): GHEntry[] {
  const byWeek = new Map<string, GHEntry>()
  for (const dir of dirs) { // dirs are sorted newest-first
    const m = dir.name.match(/^sheets_(\d{4})(\d{2})(\d{2})/)
    if (!m) continue
    const date = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`)
    const weekKey = getISOWeek(date)
    if (!byWeek.has(weekKey)) byWeek.set(weekKey, dir)
  }
  return [...byWeek.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// Parse an xlsx buffer into a map of historyKey → Set<model>
function parseSnapshot(buf: Buffer): Map<string, Set<string>> {
  const wb = xlsxRead(buf, { type: 'buffer', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = xlsxUtils.sheet_to_json<RawRow>(ws, { defval: null })
  const result = new Map<string, Set<string>>()
  for (const row of rows) {
    const stateFull = str(row.STATE).toUpperCase()
    const state = STATE_ABBREVS[stateFull]
    if (!state) continue
    const name = str(row['LAW ENFORCEMENT AGENCY'])
    if (!name) continue
    const model = str(row['SUPPORT TYPE'])
    if (!model) continue
    const key = historyKey(name, state)
    if (!result.has(key)) result.set(key, new Set())
    result.get(key)!.add(model)
  }
  return result
}

// ── 1. Fetch latest snapshot ───────────────────────────────────────────────────

console.log('Loading latest sheets snapshot...')
console.log('  Listing snapshot directories via GitHub API...')

const sheetsResp = await fetch(GITHUB_SHEETS_API)
if (!sheetsResp.ok) throw new Error(`GitHub API: ${sheetsResp.status}`)

const allEntries = (await sheetsResp.json()) as GHEntry[]
const snapshotDirs = allEntries
  .filter((e) => e.type === 'dir')
  .sort((a, b) => b.name.localeCompare(a.name))

let latestBuf: Buffer | null = null
let snapshotName = ''

for (const dir of snapshotDirs.slice(0, 5)) {
  const filesResp = await fetch(dir.url)
  if (!filesResp.ok) continue
  type GHFile = { name: string; download_url: string }
  const files = (await filesResp.json()) as GHFile[]
  const xlsxFile = files.find((f) => f.name.endsWith('.xlsx'))
  if (!xlsxFile) continue

  console.log(`  Fetching ${xlsxFile.download_url}`)
  const dataResp = await fetch(xlsxFile.download_url)
  if (!dataResp.ok) throw new Error(`xlsx fetch: ${dataResp.status}`)

  latestBuf = Buffer.from(await dataResp.arrayBuffer())
  snapshotName = dir.name
  const wb = xlsxRead(latestBuf, { type: 'buffer', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rawRows = xlsxUtils.sheet_to_json<RawRow>(ws, { defval: null })
  console.log(`  ${rawRows.length} rows, columns: ${Object.keys(rawRows[0] ?? {})}`)
  break
}

if (!latestBuf) {
  console.error('Fatal: no xlsx found in latest sheets snapshots')
  process.exit(1)
}

const dateMatch = snapshotName.match(/^sheets_(\d{4})(\d{2})(\d{2})_/)
const snapshotDate = dateMatch
  ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
  : null

// ── 1b. Build agreement history from weekly-sampled snapshots ─────────────────

console.log('\nBuilding agreement history from weekly snapshots...')

const sampledDirs = sampleWeekly(snapshotDirs)
console.log(`  Sampling ${sampledDirs.length} weekly snapshots`)

interface SnapshotRecord {
  date: string
  agencies: Map<string, Set<string>>
}

// Fetch snapshots in small batches to respect GitHub API rate limits
const BATCH = 5
const snapshots: SnapshotRecord[] = []

for (let i = 0; i < sampledDirs.length; i += BATCH) {
  const batch = sampledDirs.slice(i, i + BATCH)
  const results = await Promise.all(
    batch.map(async (dir): Promise<SnapshotRecord | null> => {
      const m = dir.name.match(/^sheets_(\d{4})(\d{2})(\d{2})/)
      if (!m) return null
      const date = `${m[1]}-${m[2]}-${m[3]}`

      // Reuse already-downloaded latest snapshot buffer
      if (dir.name === snapshotName && latestBuf) {
        return { date, agencies: parseSnapshot(latestBuf) }
      }

      const filesResp = await fetch(dir.url)
      if (!filesResp.ok) return null
      type GHFile = { name: string; download_url: string }
      const files = (await filesResp.json()) as GHFile[]
      const xlsxFile = files.find((f) => f.name.endsWith('.xlsx'))
      if (!xlsxFile) return null

      const dataResp = await fetch(xlsxFile.download_url)
      if (!dataResp.ok) return null

      const buf = Buffer.from(await dataResp.arrayBuffer())
      return { date, agencies: parseSnapshot(buf) }
    })
  )
  for (const r of results) if (r) snapshots.push(r)
  process.stdout.write(`  ${Math.min(i + BATCH, sampledDirs.length)}/${sampledDirs.length} fetched\r`)
}
console.log()

// Derive per-agency history: only record dates where models changed
function buildHistory(key: string): HistoryEvent[] {
  const events: HistoryEvent[] = []
  let prev = new Set<string>()
  for (const snap of snapshots) {
    const curr = snap.agencies.get(key) ?? new Set()
    const added = [...curr].filter((m) => !prev.has(m))
    const removed = [...prev].filter((m) => !curr.has(m))
    if (added.length || removed.length) {
      events.push({ date: snap.date, added, removed })
    }
    prev = curr
  }
  return events
}

// ── 2. Normalize columns ───────────────────────────────────────────────────────

const wb = xlsxRead(latestBuf, { type: 'buffer', cellDates: true })
const ws = wb.Sheets[wb.SheetNames[0]]
const rawRows = xlsxUtils.sheet_to_json<RawRow>(ws, { defval: null })

const normalizedRows: NormalizedRow[] = []
let dropped = 0

for (const row of rawRows) {
  const stateFull = str(row.STATE).toUpperCase()
  const state = STATE_ABBREVS[stateFull]
  if (!state) { dropped++; continue }

  const name = str(row['LAW ENFORCEMENT AGENCY'])
  if (!name) { dropped++; continue }

  const moa = str(row.MOA)
  normalizedRows.push({
    name,
    state,
    county: str(row.COUNTY) || null,
    agency_type: str(row.TYPE) || null,
    model: str(row['SUPPORT TYPE']) || null,
    signed_date: parseSignedDate(row.SIGNED),
    moa_url: moa.startsWith('http') ? moa : null,
  })
}

if (dropped > 0) console.warn(`  ⚠ Dropped ${dropped} rows with unrecognized state`)
console.log(
  `  ${normalizedRows.length} rows, ${new Set(normalizedRows.map((r) => r.state)).size} states`,
)

// ── 3. Group models per agency ─────────────────────────────────────────────────

console.log('\nGrouping models per agency...')

const byAgency = new Map<string, NormalizedRow[]>()
for (const row of normalizedRows) {
  const key = `${row.state}\x00${row.name}`
  const bucket = byAgency.get(key)
  if (bucket) bucket.push(row)
  else byAgency.set(key, [row])
}

interface GroupedAgency {
  name: string
  state: string
  county: string | null
  agency_type: string | null
  models: string[]
  signed_date: string | null
  moa_url: string | null
}

const grouped: GroupedAgency[] = []
for (const rows of byAgency.values()) {
  const first = rows[0]
  const models = [
    ...new Set(rows.map((r) => r.model).filter((m): m is string => !!m)),
  ].sort()
  const moa = rows.map((r) => r.moa_url).find((u) => u?.startsWith('http')) ?? null
  grouped.push({
    name: first.name,
    state: first.state,
    county: first.county,
    agency_type: first.agency_type,
    models,
    signed_date: first.signed_date,
    moa_url: moa,
  })
}

console.log(`  ${grouped.length} unique agencies`)

// ── 4. Geocode via county centroid ─────────────────────────────────────────────

console.log('\nFetching county centroids from Census Bureau Gazetteer...')

const gazResp = await fetch(COUNTY_GAZETTEER_URL)
if (!gazResp.ok) throw new Error(`Census Gazetteer: ${gazResp.status}`)

const zip = new AdmZip(Buffer.from(await gazResp.arrayBuffer()))
const txtEntry = zip.getEntries().find((e) => e.entryName.endsWith('.txt'))
if (!txtEntry) throw new Error('No .txt in Census Gazetteer zip')

const [headerLine, ...dataLines] = txtEntry.getData().toString('latin1').trim().split('\n')
const headers = headerLine.split('\t').map((h) => h.trim())
const col = (name: string) => headers.indexOf(name)

const centroids = new Map<string, [number, number]>()
for (const line of dataLines) {
  const cols = line.split('\t')
  const state = cols[col('USPS')]?.trim()
  const name = cols[col('NAME')]?.trim()
  const lat = parseFloat(cols[col('INTPTLAT')]?.trim())
  const lng = parseFloat(cols[col('INTPTLONG')]?.trim())
  if (!state || !name || isNaN(lat) || isNaN(lng)) continue

  const nameUpper = name.toUpperCase()
  const stripped = nameUpper.replace(COUNTY_SUFFIX, '').trim()
  const key = (n: string) => `${n}|${state}`
  centroids.set(key(nameUpper), [lat, lng])
  if (!centroids.has(key(stripped))) centroids.set(key(stripped), [lat, lng])
}

console.log(`  Loaded ${centroids.size} county centroid entries`)

function getLatLng(county: string | null, state: string): [number | null, number | null] {
  if (!county) return [null, null]
  const upper = county.toUpperCase()
  const stripped = upper.replace(COUNTY_SUFFIX, '').trim()
  const key = (n: string) => `${n}|${state}`
  return centroids.get(key(upper)) ?? centroids.get(key(stripped)) ?? [null, null]
}

// ── 5. Build output ────────────────────────────────────────────────────────────

console.log('\nBuilding output...')

const seenSlugs = new Map<string, number>()
const agencies: Agency[] = []

for (const row of grouped) {
  const name = titleAgency(row.name)
  const state = row.state
  if (!name || !state) continue

  const primary = MODEL_PRIORITY.find((m) => row.models.includes(m)) ?? row.models[0] ?? null

  const base = makeSlug(name, state)
  const count = seenSlugs.get(base) ?? 0
  const slug = count === 0 ? base : `${base}-${count}`
  seenSlugs.set(base, count + 1)

  const [lat, lng] = getLatLng(row.county, state)
  const hKey = historyKey(row.name, state)

  agencies.push({
    slug,
    name,
    state,
    county: row.county,
    city: null,
    agency_type: row.agency_type ?? 'Unknown',
    models: row.models,
    primary_model: primary,
    signed_date: row.signed_date,
    population: null,
    lat,
    lng,
    moa_url: row.moa_url,
    ori: null,
    snapshot_date: snapshotDate,
    history: buildHistory(hKey),
  })
}

// ── 6. Write output ────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(resolve(OUT_DIR, 'agency_index.json'), JSON.stringify(agencies, null, 2))

const geocoded = agencies.filter((a) => a.lat !== null).length
const withHistory = agencies.filter((a) => a.history.length > 0).length
console.log(`\nWrote ${agencies.length} agencies → ${resolve(OUT_DIR, 'agency_index.json')}`)
console.log(`Snapshot: ${snapshotName}  (${snapshotDate})`)
console.log(`States: ${new Set(agencies.map((a) => a.state)).size}`)
console.log(`Geocoded: ${geocoded}/${agencies.length} (${Math.round((geocoded / agencies.length) * 100)}%)`)
console.log(`Agencies with history events: ${withHistory}`)

const modelCounts = new Map<string, number>()
for (const a of agencies)
  for (const m of a.models) modelCounts.set(m, (modelCounts.get(m) ?? 0) + 1)
console.log('\nModel breakdown:')
for (const [m, c] of [...modelCounts.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`  ${m}: ${c}`)

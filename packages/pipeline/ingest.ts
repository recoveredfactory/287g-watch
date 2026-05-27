#!/usr/bin/env tsx
/**
 * 287(g) data pipeline
 *
 * Pulls from appelson/Tracking_287g sheets snapshots (xlsx):
 *   - Discovers the latest snapshot directory via GitHub API
 *   - Downloads and parses the xlsx file
 *   - Geocodes via Census Bureau county centroid Gazetteer
 *   - Samples one snapshot per week to build per-agency agreement history
 *   - Joins FBI Law Enforcement Employees data (ORI, officer/civilian counts, population)
 *
 * Output: packages/web/static/data/dist/agency_index.json
 */

import AdmZip from 'adm-zip'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import slugifyLib from 'slugify'
import { read as xlsxRead, utils as xlsxUtils } from 'xlsx'
import { parse as parseYaml } from 'yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../web/static/data/dist')

const GITHUB_SHEETS_API =
  'https://api.github.com/repos/appelson/Tracking_287g/contents/sheets'
const COUNTY_GAZETTEER_URL =
  'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_counties_national.zip'

const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const ghHeaders: Record<string, string> = GH_TOKEN
  ? { Authorization: `Bearer ${GH_TOKEN}`, 'User-Agent': '287g-explorer-pipeline' }
  : { 'User-Agent': '287g-explorer-pipeline' }

async function ghFetch(url: string): Promise<Response> {
  return fetch(url, { headers: url.startsWith('https://api.github.com') || url.startsWith('https://raw.githubusercontent.com') ? ghHeaders : {} })
}

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

export interface LeeData {
  pub_agency_name: string
  agency_type_name: string
  population: number | null
  officer_ct: number | null
  civilian_ct: number | null
  total_pe_ct: number | null
  pe_ct_per_1000: number | null
  data_year: number
}

export interface AgreementMetadata {
  population_policed: number | null
  operating_budget: number | null
  agency_type: string | null
}

export interface AgencyNote {
  kind: string
  related_slug?: string
  text: string
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
  population: number | null
  lat: number | null
  lng: number | null
  moa_url: string | null
  ori: string | null
  snapshot_date: string | null
  contact_website: string | null
  contact_phone: string | null
  contact_address: string | null
  history: HistoryEvent[]
  lee: LeeData | null
  agreement: AgreementMetadata | null
  notes: AgencyNote[] | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function titleAgency(s: string): string {
  const lower = new Set(['of', 'the', 'a', 'an', 'and', 'or', 'in', 'at', 'by', 'for', 'to'])
  const capSegments = (word: string) =>
    word.split('-').map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1)).join('-')
  return s
    .trim()
    .split(/\s+/)
    .map((word, i) => {
      const lw = word.toLowerCase()
      return i === 0 || !lower.has(lw) ? capSegments(lw) : lw
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

const sheetsResp = await ghFetch(GITHUB_SHEETS_API)
if (!sheetsResp.ok) throw new Error(`GitHub API: ${sheetsResp.status}`)

const allEntries = (await sheetsResp.json()) as GHEntry[]
const snapshotDirs = allEntries
  .filter((e) => e.type === 'dir')
  .sort((a, b) => b.name.localeCompare(a.name))

let latestBuf: Buffer | null = null
let snapshotName = ''

for (const dir of snapshotDirs.slice(0, 5)) {
  const filesResp = await ghFetch(dir.url)
  if (!filesResp.ok) continue
  type GHFile = { name: string; download_url: string }
  const files = (await filesResp.json()) as GHFile[]
  const xlsxFile = files.find((f) => f.name.endsWith('.xlsx'))
  if (!xlsxFile) continue

  console.log(`  Fetching ${xlsxFile.download_url}`)
  const dataResp = await ghFetch(xlsxFile.download_url)
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

      const filesResp = await ghFetch(dir.url)
      if (!filesResp.ok) return null
      type GHFile = { name: string; download_url: string }
      const files = (await filesResp.json()) as GHFile[]
      const xlsxFile = files.find((f) => f.name.endsWith('.xlsx'))
      if (!xlsxFile) return null

      const dataResp = await ghFetch(xlsxFile.download_url)
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
    contact_website: null,
    contact_phone: null,
    contact_address: null,
    history: buildHistory(hKey),
    lee: null,
    agreement: null,
    notes: null,
  })
}

// ── 5. Join FBI / upstream agency metadata ────────────────────────────────────

console.log('\nJoining FBI LEE + upstream agreements.csv...')

const LEE_CSV = resolve(__dirname, 'data/fbi_lee_latest.csv')
const UPSTREAM_AGREEMENTS_URL =
  'https://raw.githubusercontent.com/appelson/Tracking_287g/main/agreements.csv'

interface LeeRow {
  ori: string
  data_year: number
  pub_agency_name: string
  state_abbr: string
  county_name: string
  agency_type_name: string
  population: number | null
  officer_ct: number | null
  civilian_ct: number | null
  total_pe_ct: number | null
  pe_ct_per_1000: number | null
}

interface UpstreamEntry {
  ori: string | null
  population_policed: number | null
  operating_budget: number | null
  agency_type: string | null
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else if (c === '\r') { /* skip */ }
      else field += c
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

function numOrNull(s: string): number | null {
  if (s == null || s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const leeText = readFileSync(LEE_CSV, 'utf8')
const leeRowsArr = parseCSV(leeText)
const leeHeaders = leeRowsArr[0]
const lc = Object.fromEntries(leeHeaders.map((h, i) => [h, i])) as Record<string, number>
const leeRows: LeeRow[] = []
// FBI historically codes Nebraska as "NB"; everywhere else uses USPS "NE".
const FBI_STATE_FIXUP: Record<string, string> = { NB: 'NE' }
for (let i = 1; i < leeRowsArr.length; i++) {
  const r = leeRowsArr[i]
  if (!r[lc.ori]) continue
  const rawState = r[lc.state_abbr]
  leeRows.push({
    ori: r[lc.ori],
    data_year: Number(r[lc.data_year]),
    pub_agency_name: r[lc.pub_agency_name],
    state_abbr: FBI_STATE_FIXUP[rawState] ?? rawState,
    county_name: r[lc.county_name],
    agency_type_name: r[lc.agency_type_name],
    population: numOrNull(r[lc.population]),
    officer_ct: numOrNull(r[lc.officer_ct]),
    civilian_ct: numOrNull(r[lc.civilian_ct]),
    total_pe_ct: numOrNull(r[lc.total_pe_ct]),
    pe_ct_per_1000: numOrNull(r[lc.pe_ct_per_1000]),
  })
}
console.log(`  Loaded ${leeRows.length} FBI LEE rows`)

const leeByOri = new Map<string, LeeRow>()
for (const r of leeRows) leeByOri.set(r.ori, r)

// Fetch upstream curated agreements.csv (~33% coverage but ORIs are hand-vetted)
console.log(`  Fetching ${UPSTREAM_AGREEMENTS_URL}`)
const upResp = await ghFetch(UPSTREAM_AGREEMENTS_URL)
const upRowsArr = upResp.ok ? parseCSV(await upResp.text()) : [[]]
const upHeaders = upRowsArr[0]
const uc = Object.fromEntries(upHeaders.map((h, i) => [h, i])) as Record<string, number>

const STATE_FULL_TO_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_ABBREVS).map(([full, ab]) => [full, ab]),
)

function upNorm(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const upstream = new Map<string, UpstreamEntry>()
for (let i = 1; i < upRowsArr.length; i++) {
  const r = upRowsArr[i]
  if (r.length < 2) continue
  const state = STATE_FULL_TO_ABBR[(r[uc.state] ?? '').toUpperCase()]
  const name = r[uc.agency]
  if (!state || !name) continue
  const k = `${state}|${upNorm(name)}`
  if (upstream.has(k)) continue
  const ori = r[uc.ori]
  upstream.set(k, {
    ori: ori && ori !== 'NA' ? ori : null,
    population_policed: numOrNull(r[uc.population_policed]),
    operating_budget: numOrNull(r[uc.operating_budget]),
    agency_type: r[uc.agency_type] || null,
  })
}
console.log(`  Loaded ${upstream.size} upstream agreement entries (${[...upstream.values()].filter(e => e.ori).length} with ORI)`)

// FBI agency_type → bucket
const FBI_BUCKET: Record<string, string> = {
  'County': 'county',
  'City': 'city',
  'State Police': 'state_police',
  'Other State Agency': 'state_other',
  'Federal': 'federal',
  'Tribal': 'tribal',
  'University or College': 'university',
  'Other': 'other',
}

function leeNorm(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\bsaint\b/g, 'st')
    .replace(/\bdept\b/g, 'department')
    .replace(/\s+/g, ' ')
    .trim()
}

// Common city-name suffixes the FBI dataset includes but 287g often omits
// (Sunny Isles Beach ↔ Sunny Isles, X Township ↔ X). Strip from FBI side to
// generate alternate lookup keys.
const FBI_CITY_TRAILS = [/\s+beach$/i, /\s+village$/i, /\s+township$/i, /\s+city$/i, /\s+borough$/i, /\s+town$/i]

const leeLookup = new Map<string, LeeRow>()
const leeLookupCollapsed = new Map<string, LeeRow>()
for (const r of leeRows) {
  const bucket = FBI_BUCKET[r.agency_type_name] ?? 'other'
  const name = leeNorm(r.pub_agency_name)
  if (!r.state_abbr || !name) continue
  const variants = new Set([name])
  if (bucket === 'city') {
    for (const re of FBI_CITY_TRAILS) {
      const stripped = name.replace(re, '').trim()
      if (stripped) variants.add(stripped)
    }
  }
  for (const v of variants) {
    const k = `${r.state_abbr}|${bucket}|${v}`
    const prev = leeLookup.get(k)
    if (!prev || prev.data_year < r.data_year) leeLookup.set(k, r)
    const ck = `${r.state_abbr}|${bucket}|${v.replace(/ /g, '')}`
    const cprev = leeLookupCollapsed.get(ck)
    if (!cprev || cprev.data_year < r.data_year) leeLookupCollapsed.set(ck, r)
  }
}

const CITY_SUFFIXES = [
  /\s+police services department$/i, /\s+public safety department$/i,
  /\s+department of public safety$/i,
  /\s+police department$/i, /\s+police services$/i, /\s+public safety$/i,
  /\s+department of police$/i, /\s+marshal'?s? office$/i,
  /\s+police$/i, /\bpd$/i,
]
const CITY_PREFIXES = [/^city of\s+/i, /^town of\s+/i, /^township of\s+/i, /^village of\s+/i, /^borough of\s+/i]
const COUNTY_SUFFIXES_287 = [
  /\s+county sheriff'?s? office$/i, /\s+county sheriff'?s? department$/i, /\s+county sheriff'?s?$/i,
  /\s+parish sheriff'?s? office$/i, /\s+parish sheriff'?s? department$/i,
  /\s+borough sheriff'?s? office$/i,
  /\s+sheriff'?s? office$/i, /\s+sheriff'?s? department$/i, /\s+sheriff'?s?$/i,
  /\s+county$/i, /\s+parish$/i,
]
const STATE_SUFFIXES = [/\s+department$/i, /\s+police department$/i, /\s+division$/i]
const UNIVERSITY_SUFFIXES = [/\s+board of trustees$/i, /\s+department of public safety$/i, /\s+police department$/i]
const UNIVERSITY_PREFIXES = [/^district board of trustees of\s+/i, /^board of trustees of\s+/i]

function applyRegexes(s: string, regexes: RegExp[]): string {
  let cur = s
  for (const r of regexes) cur = cur.replace(r, '').trim()
  return cur
}

function dedupeNonEmpty(arr: string[]): string[] {
  return [...new Set(arr)].filter(Boolean)
}

function cityCandidates(name: string): string[] {
  return dedupeNonEmpty([
    name,
    applyRegexes(name, [...CITY_PREFIXES, ...CITY_SUFFIXES]),
    applyRegexes(name, CITY_SUFFIXES),
    applyRegexes(name, CITY_PREFIXES),
  ])
}

function countyCandidates(name: string, county: string | null): string[] {
  const out = [applyRegexes(name, COUNTY_SUFFIXES_287)]
  if (county) out.push(county.replace(/\s+(County|Parish|Borough|Census Area|City and Borough|Municipality)$/i, '').trim())
  return dedupeNonEmpty(out)
}

function stateCandidates(name: string): string[] {
  return dedupeNonEmpty([name, applyRegexes(name, STATE_SUFFIXES)])
}

function universityCandidates(name: string): string[] {
  return dedupeNonEmpty([
    name,
    applyRegexes(name, [...UNIVERSITY_PREFIXES, ...UNIVERSITY_SUFFIXES]),
    applyRegexes(name, UNIVERSITY_SUFFIXES),
    applyRegexes(name, UNIVERSITY_PREFIXES),
  ])
}

function findLee(state: string, buckets: string[], candidates: string[]): LeeRow | null {
  for (const b of buckets) {
    for (const c of candidates) {
      const row = leeLookup.get(`${state}|${b}|${leeNorm(c)}`)
      if (row) return row
    }
  }
  // Whitespace-collapsed fallback: "la salle" ↔ "lasalle"
  for (const b of buckets) {
    for (const c of candidates) {
      const row = leeLookupCollapsed.get(`${state}|${b}|${leeNorm(c).replace(/ /g, '')}`)
      if (row) return row
    }
  }
  return null
}

function matchAgency(a: Agency): LeeRow | null {
  if (a.agency_type === 'County') {
    const m = findLee(a.state, ['county'], countyCandidates(a.name, a.county))
    if (m) return m
    // Consolidated city-counties / independent cities (Jacksonville, Hopewell, etc.)
    return findLee(a.state, ['city'], cityCandidates(a.name.replace(/\s+sheriff'?s? office$/i, '').replace(/\s+county$/i, '')))
  }
  if (a.agency_type === 'Municipality') {
    const cands = cityCandidates(a.name)
    const buckets = ['city']
    if (/university|college/i.test(a.name)) buckets.push('university', 'other')
    else if (/airport/i.test(a.name)) buckets.push('other')
    const m = findLee(a.state, buckets, cands)
    if (m) return m
    if (/university|college/i.test(a.name)) return findLee(a.state, ['university'], universityCandidates(a.name))
    return null
  }
  if (a.agency_type === 'State Agency') {
    const cands = stateCandidates(a.name)
    return (
      findLee(a.state, ['state_police', 'state_other'], cands) ||
      findLee(a.state, ['federal', 'other', 'university'], cands) ||
      findLee(a.state, ['university'], universityCandidates(a.name))
    )
  }
  return null
}

// Try upstream agreements.csv first (hand-curated ORI), then fall back to FBI name match.
// 287g name "X County Sheriff's Office" appears in upstream as "x county sheriff" etc.
function upstreamCandidates(name: string): string[] {
  const n = upNorm(name)
  return dedupeNonEmpty([
    n,
    n.replace(/\s+sheriffs office$/, ' sheriff').replace(/\s+sheriffs department$/, ' sheriff').replace(/\s+sheriffs$/, ' sheriff'),
    n.replace(/\s+police department$/, ' police'),
    n.replace(/\s+(office|department)$/, ''),
  ])
}

function findUpstream(state: string, name: string): UpstreamEntry | null {
  for (const c of upstreamCandidates(name)) {
    const hit = upstream.get(`${state}|${c}`)
    if (hit) return hit
  }
  return null
}

function leeToLeeData(lee: LeeRow): LeeData {
  return {
    pub_agency_name: lee.pub_agency_name,
    agency_type_name: lee.agency_type_name,
    population: lee.population,
    officer_ct: lee.officer_ct,
    civilian_ct: lee.civilian_ct,
    total_pe_ct: lee.total_pe_ct,
    pe_ct_per_1000: lee.pe_ct_per_1000,
    data_year: lee.data_year,
  }
}

let oriMatched = 0
let oriFromUpstream = 0
let oriFromHeuristic = 0
let leeAttached = 0
let agreementAttached = 0
const leeYearDist = new Map<number, number>()

for (const a of agencies) {
  const up = findUpstream(a.state, a.name)
  if (up) {
    a.agreement = {
      population_policed: up.population_policed,
      operating_budget: up.operating_budget,
      agency_type: up.agency_type,
    }
    agreementAttached++
    if (up.ori) {
      a.ori = up.ori
      oriFromUpstream++
    }
    if (up.population_policed != null) a.population = up.population_policed
  }

  if (!a.ori) {
    const lee = matchAgency(a)
    if (lee) {
      a.ori = lee.ori
      oriFromHeuristic++
    }
  }

  if (a.ori) {
    oriMatched++
    const lee = leeByOri.get(a.ori)
    if (lee) {
      a.lee = leeToLeeData(lee)
      leeAttached++
      leeYearDist.set(lee.data_year, (leeYearDist.get(lee.data_year) ?? 0) + 1)
      if (a.population == null) a.population = lee.population
    }
  }
}

console.log(
  `  ORI matched: ${oriMatched}/${agencies.length} (${Math.round((100 * oriMatched) / agencies.length)}%) — upstream:${oriFromUpstream}, heuristic:${oriFromHeuristic}`,
)
console.log(
  `  LEE data attached: ${leeAttached}, agreement metadata attached: ${agreementAttached}`,
)
console.log(
  `  LEE data by year: ` +
    [...leeYearDist.entries()].sort((a, b) => b[0] - a[0]).map(([y, c]) => `${y}:${c}`).join(', '),
)

const oriUnmatchedByType = new Map<string, number>()
for (const a of agencies) {
  if (a.ori) continue
  oriUnmatchedByType.set(a.agency_type, (oriUnmatchedByType.get(a.agency_type) ?? 0) + 1)
}
if (oriUnmatchedByType.size) {
  console.log(
    `  Unmatched by type: ` +
      [...oriUnmatchedByType.entries()].map(([t, c]) => `${t}:${c}`).join(', '),
  )
}

// ── 6. Per-state coverage: % of local LE agencies with a 287(g) agreement ─────
//
// Denominator: FBI LEE County + City agencies per state (these are the agencies
// that could plausibly sign a 287(g) agreement). State DOCs, federal agencies,
// universities, and tribal LE all participate too but represent a separate slice,
// so we exclude them from this headline ratio. Drops 287g agencies we couldn't
// ORI-match — we can't honestly count an agreement we couldn't slot against the
// FBI roster.

interface StateCoverage {
  state: string
  local_le_agencies: number      // FBI LEE County + City count
  participating: number           // matched 287g agencies that are County or City
  pct: number                     // participating / local_le_agencies
  population_served: number       // sum of population for participating local agencies
  state_local_population: number  // sum of FBI LEE population across all local agencies
  has_state_patrol: boolean       // a literal state police / highway patrol is participating
}

// Narrow match: only literal state-level traffic/patrol enforcement, not other
// state agencies (corrections, wildlife, AG offices, etc.).
const STATE_PATROL_RE = /state police|highway patrol|state patrol|state troopers/i
const statePatrolByState = new Map<string, boolean>()
for (const a of agencies) {
  if (STATE_PATROL_RE.test(a.name)) statePatrolByState.set(a.state, true)
}

const fbiLocalByState = new Map<string, number>()
const fbiLocalPopByState = new Map<string, number>()
for (const r of leeRows) {
  const bucket = FBI_BUCKET[r.agency_type_name]
  if (bucket !== 'county' && bucket !== 'city') continue
  fbiLocalByState.set(r.state_abbr, (fbiLocalByState.get(r.state_abbr) ?? 0) + 1)
  if (r.population) fbiLocalPopByState.set(r.state_abbr, (fbiLocalPopByState.get(r.state_abbr) ?? 0) + r.population)
}

// Use FBI LEE's jurisdictional population (sheriff = unincorporated, city = city
// proper) so sums across the same county don't double-count. The agency-level
// `population` field is fine for per-agency display, but uses upstream's
// whole-county figure for sheriffs which would inflate state totals.
const participatingByState = new Map<string, number>()
const popServedByState = new Map<string, number>()
for (const a of agencies) {
  if (!a.ori) continue
  if (a.agency_type !== 'County' && a.agency_type !== 'Municipality') continue
  participatingByState.set(a.state, (participatingByState.get(a.state) ?? 0) + 1)
  if (a.lee?.population) popServedByState.set(a.state, (popServedByState.get(a.state) ?? 0) + a.lee.population)
}

const stateCoverage: StateCoverage[] = []
const allStates = new Set<string>([...fbiLocalByState.keys(), ...participatingByState.keys()])
for (const state of allStates) {
  const denom = fbiLocalByState.get(state) ?? 0
  const num = participatingByState.get(state) ?? 0
  if (denom === 0) continue
  stateCoverage.push({
    state,
    local_le_agencies: denom,
    participating: num,
    pct: num / denom,
    population_served: popServedByState.get(state) ?? 0,
    state_local_population: fbiLocalPopByState.get(state) ?? 0,
    has_state_patrol: statePatrolByState.get(state) ?? false,
  })
}

const flaggedStates = stateCoverage.filter((s) => s.has_state_patrol).map((s) => s.state).sort()
console.log(`\nStates with literal state police / highway patrol participating (${flaggedStates.length}):`)
console.log(`  ${flaggedStates.join(', ')}`)
stateCoverage.sort((a, b) => b.pct - a.pct)

console.log('\nState 287(g) coverage of local LE (agency_count_pct | pop_served / state_local_pop):')
for (const s of stateCoverage) {
  const popPct = s.state_local_population > 0
    ? ((s.population_served / s.state_local_population) * 100).toFixed(0) + '%'
    : 'n/a'
  console.log(
    `  ${s.state}: ${s.participating}/${s.local_le_agencies} (${(s.pct * 100).toFixed(1)}%) | ` +
    `pop ${s.population_served.toLocaleString()} / ${s.state_local_population.toLocaleString()} (${popPct})`,
  )
}

// ── 7. Join MOA index ─────────────────────────────────────────────────────────

const MOA_INDEX_PATH = resolve(__dirname, 'data/moa_index.json')
if (existsSync(MOA_INDEX_PATH)) {
  const moaIndex = JSON.parse(readFileSync(MOA_INDEX_PATH, 'utf8')) as Record<string, string>

  function moaNorm(s: string): string {
    return s
      .toLowerCase()
      .replace(/'/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  let moaAttached = 0
  for (const a of agencies) {
    if (a.moa_url) continue
    const key = `${a.state}|${moaNorm(a.name)}`
    const url = moaIndex[key]
    if (url) {
      a.moa_url = url
      moaAttached++
    }
  }
  console.log(`\nMOA index: attached ${moaAttached}/${agencies.length} agencies`)
} else {
  console.log('\nMOA index not found — run `pnpm build:moa-index` to generate it')
}

// ── 8. Wikidata website enrichment ────────────────────────────────────────────

const WIKIDATA_PATH = resolve(__dirname, 'data/wikidata_websites.json')
if (existsSync(WIKIDATA_PATH)) {
  const wikidata = JSON.parse(readFileSync(WIKIDATA_PATH, 'utf8')) as Record<string, string>

  function wdNorm(s: string): string {
    return s
      .toLowerCase()
      .replace(/'/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  let wdAttached = 0
  for (const a of agencies) {
    if (a.contact_website) continue
    const key = `${a.state}|${wdNorm(a.name)}`
    const url = wikidata[key]
    if (url) {
      a.contact_website = url
      wdAttached++
    }
  }
  console.log(`\nWikidata: attached website for ${wdAttached} agencies`)
}

// ── 8b. Scraped contacts (Playwright) ─────────────────────────────────────────

const SCRAPED_PATH = resolve(__dirname, 'data/scraped_contacts.json')
if (existsSync(SCRAPED_PATH)) {
  const scraped = JSON.parse(readFileSync(SCRAPED_PATH, 'utf8')) as Record<
    string,
    { website?: string; phone?: string; address?: string }
  >

  function scrapedNorm(s: string): string {
    return s
      .toLowerCase()
      .replace(/'/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  let scrapedAttached = 0
  for (const a of agencies) {
    const key = `${a.state}|${scrapedNorm(a.name)}`
    const entry = scraped[key]
    if (!entry) continue
    if (!a.contact_website && entry.website) { a.contact_website = entry.website; scrapedAttached++ }
    else if (entry.website || entry.phone || entry.address) scrapedAttached++
    if (!a.contact_phone && entry.phone) a.contact_phone = entry.phone
    if (!a.contact_address && entry.address) a.contact_address = entry.address
  }
  console.log(`\nScraped contacts: enriched ${scrapedAttached} agencies`)
} else {
  console.log('\nScraped contacts not found — run `pnpm scrape:contacts` to generate')
}

// ── 9. Merge editorial notes overlay ──────────────────────────────────────────

const NOTES_PATH = resolve(__dirname, 'data/agency_notes.yaml')
if (existsSync(NOTES_PATH)) {
  const raw = parseYaml(readFileSync(NOTES_PATH, 'utf8')) as
    | Record<string, AgencyNote[]>
    | null
  const overlay = raw ?? {}
  const slugSet = new Set(agencies.map((a) => a.slug))
  let attached = 0
  let orphaned = 0
  for (const [slug, notes] of Object.entries(overlay)) {
    if (!slugSet.has(slug)) {
      console.warn(`  notes overlay: unknown slug '${slug}' (skipped)`)
      orphaned++
      continue
    }
    // Validate related_slug references too
    for (const n of notes) {
      if (n.related_slug && !slugSet.has(n.related_slug)) {
        console.warn(`  notes overlay: '${slug}' references unknown related_slug '${n.related_slug}'`)
      }
    }
  }
  for (const a of agencies) {
    if (overlay[a.slug]) {
      a.notes = overlay[a.slug]
      attached++
    }
  }
  console.log(`\nNotes overlay: attached ${attached} agencies${orphaned ? `, ${orphaned} orphaned` : ''}`)
}

// ── 10. Write output ───────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(resolve(OUT_DIR, 'agency_index.json'), JSON.stringify(agencies, null, 2))
writeFileSync(resolve(OUT_DIR, 'state_meta.json'), JSON.stringify(stateCoverage, null, 2))

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

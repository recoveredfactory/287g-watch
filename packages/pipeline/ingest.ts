#!/usr/bin/env tsx
/**
 * 287(g) data pipeline
 *
 * Pulls from appelson/Tracking_287g sheets snapshots (xlsx):
 *   - Discovers the latest snapshot directory via GitHub API
 *   - Downloads and parses the xlsx file
 *   - Geocodes via Census Bureau gazetteers (fully offline): municipalities →
 *     place / county-subdivision centroid (the town), others → county centroid;
 *     statewide agencies get no dot. A small curated override table fixes the
 *     stragglers (campus/airport police, county-name typos).
 *   - Samples one snapshot per week to build per-agency agreement history
 *   - Joins FBI Law Enforcement Employees data (ORI, officer/civilian counts, population)
 *
 * Output: packages/web/static/data/dist/agency_index.json
 */

import AdmZip from 'adm-zip'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import slugifyLib from 'slugify'
import { read as xlsxRead, utils as xlsxUtils } from 'xlsx'
import { parse as parseYaml } from 'yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../web/static/data/dist')
// Snapshot xlsx files are immutable once published (each dir is a dated capture),
// so we cache them on disk. Warm re-runs make zero GitHub API calls for already-
// seen snapshots — fast and token-free. Delete .cache/sheets to force a refresh.
const CACHE_DIR = resolve(__dirname, '.cache/sheets')

const GITHUB_SHEETS_API =
  'https://api.github.com/repos/appelson/Tracking_287g/contents/sheets'
// Wayback-archived snapshots that predate the live `sheets/` stream. The
// after_2025 folder fills the Mar–mid-May 2025 gap (same dir naming, xlsx, but
// no COUNTY column). We ingest only the dirs BEFORE the live stream starts, so
// there's no overlap to dedup and the live folder stays canonical for any shared
// date. before_2025 (CSV/HTML era, 2021→2024) is deferred — see #169/#170.
const GITHUB_AFTER2025_API =
  'https://api.github.com/repos/appelson/Tracking_287g/contents/archived_data/after_2025/sheets'
// Pre-2025 HTML era (CSV per dir, 2021→2024, ~150 agencies declining to ~133).
// State name + agency + support + signed only — no county/agency-type. #169
const GITHUB_BEFORE2025_API =
  'https://api.github.com/repos/appelson/Tracking_287g/contents/archived_data/before_2025/sheets'
const GAZETTEER_BASE =
  'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer'
const COUNTY_GAZETTEER_URL = `${GAZETTEER_BASE}/2023_Gaz_counties_national.zip`
const PLACE_GAZETTEER_URL = `${GAZETTEER_BASE}/2023_Gaz_place_national.zip`
const COUSUB_GAZETTEER_URL = `${GAZETTEER_BASE}/2023_Gaz_cousubs_national.zip`

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

// ICE occasionally publishes a misspelled SUPPORT TYPE when an agency first
// appears, then corrects it a few days later. Ingested verbatim, the upstream
// correction reads as a phantom remove/add pair in agency history (#182), so
// fold every model string to its canonical form before it enters a snapshot
// or the live sheet.
const MODEL_VARIANTS: Record<string, string> = {
  'warrant services officer': 'Warrant Service Officer',
  'warrant service office': 'Warrant Service Officer',
  'task force officer': 'Task Force Model',
}

// Lowercase and collapse punctuation/whitespace, so future variants that
// differ only in case or separators match the canonical list directly.
function foldModel(s: string): string {
  return s.toLowerCase().replace(/[^a-z]+/g, ' ').trim()
}

const MODEL_CANONICAL = new Map(MODEL_PRIORITY.map((m) => [foldModel(m), m]))
const unknownModels = new Set<string>()

function normalizeModel(raw: string): string {
  if (!raw) return raw
  const folded = foldModel(raw)
  const canonical = MODEL_CANONICAL.get(folded) ?? MODEL_VARIANTS[folded]
  if (canonical) return canonical
  // Pass unknowns through rather than dropping them — a genuinely new model
  // should surface downstream, not vanish — but flag it for triage.
  if (!unknownModels.has(raw)) {
    unknownModels.add(raw)
    console.warn(`  ⚠ Unrecognized SUPPORT TYPE passed through unnormalized: "${raw}"`)
  }
  return raw
}

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

// One 287(g) agreement on file (one per model: JEM/TFM/WSO). An agency can hold
// several; their ICE signer / date / public-affairs POC sometimes diverge.
// Sourced from extract-moa-signers.ts via data/moa_extracts.json (#1/#2).
export interface Agreement {
  model: string | null // full model name ("Jail Enforcement Model") or null if untagged
  pdf_url: string | null
  date_signed: string | null // as written in the document (may be null)
  date_filename: string | null // ISO date parsed from the PDF filename (fallback)
  ice_signer_name: string | null
  ice_signer_title: string | null
  ice_field_office: string | null
  lea_signer_name: string | null
  moa_poc_name: string | null
  moa_poc_email: string | null
  moa_poc_phone: string | null
  moa_poc_address: string | null
  addendum_date: string | null
  addendum_signer: string | null
}

// "N of M models on file" — onFile = roster models with a PDF, modelsListed = M.
export interface AgreementCoverage {
  onFile: number
  modelsListed: number
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
  first_seen_date: string | null
  terminated_date: string | null
  population: number | null
  lat: number | null
  lng: number | null
  moa_url: string | null
  ori: string | null
  snapshot_date: string | null
  contact_website: string | null
  contact_phone: string | null
  contact_address: string | null
  // Extracted from the signed MOA PDF (extract-moa-signers.ts)
  moa_date_signed: string | null
  ice_field_office: string | null
  ice_signer_name: string | null
  ice_signer_title: string | null
  lea_signer_name: string | null
  moa_poc_name: string | null
  moa_poc_email: string | null
  moa_poc_phone: string | null
  moa_poc_address: string | null
  moa_addendum_date: string | null
  moa_addendum_signer: string | null
  // Per-agreement breakdown (#3): every model-agreement on file. The flat
  // moa_* / ice_* fields above mirror the "primary" agreement for back-compat.
  agreements?: Agreement[]
  agreement_coverage?: AgreementCoverage
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

// ── Rename resolution ───────────────────────────────────────────────────────
//
// The upstream sheet relabels agencies constantly — "Miami Dade" → "Miami-Dade",
// "Ft. Myers" → "Fort Myers", "City of X PD" → "X PD", plus raw typos
// ("Calacasieu" → "Calcasieu") and a campaign of state-prefixing ("Department of
// Public Safety" → "Texas Department of Public Safety"). Under the naive
// "absent from the latest snapshot = terminated" rule, every relabel reads as a
// termination + a brand-new agency. These helpers fold a vanished agency back
// into its surviving record so only GENUINE departures count as terminations.
// Validated offline against all 144 clean snapshots (see #118): cleanly
// separates 42 renames from 68 real terminations with zero false merges.

const STATE_FULL_BY_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_ABBREVS).map(([full, ab]) => [ab, full.toLowerCase()]),
)

// Aggressive canonical form for identity matching (more folding than historyKey):
// hyphens → space, &/. /' normalized, common abbreviations expanded.
function canonName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'’,/]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\bft\b/g, 'fort')
    .replace(/\bst\b/g, 'saint')
    .replace(/\bste\b/g, 'sainte')
    .replace(/\btwp\b/g, 'township')
    .replace(/\bdept\b/g, 'department')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Generic agency words dropped so the distinctive part (the place / qualifier)
// can be compared on its own.
const RENAME_FILLER = new Set([
  'police', 'department', 'sheriffs', 'sheriff', 'office', 'of', 'the', 'county',
  'city', 'town', 'village', 'borough', 'services', 'service', 'public', 'safety',
  'division', 'corrections', 'correctional', 'board', 'commissioners', 'detention',
  'center', 'dps', 'authority', 'and', 'district',
])
function distinctiveTokens(name: string): Set<string> {
  return new Set(canonName(name).split(' ').filter((w) => w && !RENAME_FILLER.has(w)))
}
const sameSet = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x))

// Levenshtein edit distance (small strings; iterative two-row would be leaner
// but agency names are short enough that the full matrix is fine).
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[m][n]
}

type GHEntry = { name: string; type: string; url: string }

// All snapshot dirs, oldest-first, that carry a parseable date. The upstream
// repo publishes every-other-day, so this is ~170 snapshots since May 2025 —
// we ingest all of them and filter out the broken ones below (see #118).
function chronologicalSnapshots(dirs: GHEntry[]): GHEntry[] {
  return dirs
    .filter((d) => /^sheets_\d{8}/.test(d.name))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// One agency as observed in a single snapshot: its models plus the raw row
// fields we need to emit a record for it even after it later disappears (a
// terminated agency is never in the latest snapshot, so it never reaches the
// normalize/group pass — we rebuild it from its last-seen observation instead).
interface SnapshotAgency {
  models: Set<string>
  name: string
  state: string
  county: string | null
  agency_type: string | null
  signed_date: string | null
}

// One snapshot row, normalized across the two upstream formats: the xlsx era
// (STATE/AGENCY/TYPE/COUNTY/SUPPORT TYPE/SIGNED columns) and the pre-2025 HTML
// era (CSV: state/agency/support/signed, no TYPE or COUNTY). See #169.
interface SnapRow {
  stateFull: string
  name: string
  model: string
  signedRaw: unknown
  county: string | null
  agencyType: string | null
}

function xlsxSnapRows(buf: Buffer): SnapRow[] {
  const wb = xlsxRead(buf, { type: 'buffer', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = xlsxUtils.sheet_to_json<RawRow>(ws, { defval: null })
  return rows.map((r) => ({
    stateFull: str(r.STATE).toUpperCase(),
    name: str(r['LAW ENFORCEMENT AGENCY']),
    model: normalizeModel(str(r['SUPPORT TYPE'])),
    signedRaw: r.SIGNED,
    county: str(r.COUNTY) || null,
    agencyType: str(r.TYPE) || null,
  }))
}

// before_2025 CSV header: capture_date, capture_file, state, agency, support,
// signed, link, addendum, date_only. State is the full name ("ALABAMA"); there
// is no county or agency-type column.
function csvSnapRows(buf: Buffer): SnapRow[] {
  const rows = parseCSV(buf.toString('utf8'))
  if (rows.length < 2) return []
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const col = (name: string) => header.indexOf(name)
  const iState = col('state'), iAgency = col('agency'), iSupport = col('support'), iSigned = col('signed')
  if (iState < 0 || iAgency < 0 || iSupport < 0) return []
  const out: SnapRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row.length) continue
    out.push({
      stateFull: str(row[iState]).toUpperCase(),
      name: str(row[iAgency]),
      model: normalizeModel(str(row[iSupport])),
      signedRaw: iSigned >= 0 ? row[iSigned] : null,
      county: null,
      agencyType: null,
    })
  }
  return out
}

// Parse a snapshot buffer (xlsx OR csv, detected by the zip magic bytes) into a
// map of historyKey → SnapshotAgency.
function parseSnapshot(buf: Buffer): Map<string, SnapshotAgency> {
  const isXlsx = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b // "PK" zip header
  const rows = isXlsx ? xlsxSnapRows(buf) : csvSnapRows(buf)
  const result = new Map<string, SnapshotAgency>()
  for (const row of rows) {
    const state = STATE_ABBREVS[row.stateFull]
    if (!state) continue
    if (!row.name) continue
    if (!row.model) continue
    const key = historyKey(row.name, state)
    let e = result.get(key)
    if (!e) {
      e = {
        models: new Set(),
        name: row.name,
        state,
        county: row.county,
        agency_type: row.agencyType,
        signed_date: parseSignedDate(row.signedRaw),
      }
      result.set(key, e)
    }
    e.models.add(row.model)
  }
  return result
}

// Return a snapshot dir's xlsx bytes, disk-cached by dir name. On a cache hit
// this makes no network calls at all; on a miss it lists the dir, downloads the
// xlsx, and caches it. Returns null if the dir has no xlsx.
async function snapshotBuffer(dir: GHEntry): Promise<Buffer | null> {
  // Cache key is the dir name; the era determines the extension (xlsx for the
  // 2025+ sheets, csv for the pre-2025 HTML era). Check both on a warm run.
  const xlsxPath = resolve(CACHE_DIR, `${dir.name}.xlsx`)
  const csvPath = resolve(CACHE_DIR, `${dir.name}.csv`)
  if (existsSync(xlsxPath)) return readFileSync(xlsxPath)
  if (existsSync(csvPath)) return readFileSync(csvPath)

  const filesResp = await ghFetch(dir.url)
  if (!filesResp.ok) return null
  type GHFile = { name: string; download_url: string }
  const files = (await filesResp.json()) as GHFile[]
  // Both live and after_2025 dirs carry a participating AND a pending xlsx.
  // We only ingest the participating sheet. (The old "first xlsx" worked only
  // because GitHub lists "participating" before "pending" alphabetically — pick
  // it explicitly so a listing-order change can't silently grab pending.) The
  // pre-2025 HTML era has neither, just a single CSV — fall back to that.
  const xlsxFiles = files.filter((f) => f.name.toLowerCase().endsWith('.xlsx'))
  const dataFile =
    xlsxFiles.find((f) => /participat/i.test(f.name)) ??
    xlsxFiles.find((f) => !/pending/i.test(f.name)) ??
    files.find((f) => f.name.toLowerCase().endsWith('.csv'))
  if (!dataFile) return null

  const dataResp = await ghFetch(dataFile.download_url)
  if (!dataResp.ok) return null
  const buf = Buffer.from(await dataResp.arrayBuffer())
  mkdirSync(CACHE_DIR, { recursive: true })
  const ext = dataFile.name.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx'
  writeFileSync(resolve(CACHE_DIR, `${dir.name}.${ext}`), buf)
  return buf
}

// ── 1. Fetch latest snapshot ───────────────────────────────────────────────────

console.log('Loading latest sheets snapshot...')
console.log('  Listing snapshot directories via GitHub API...')

// Fall back to the local disk cache if the API listing is unavailable
// (rate-limited or no token). The cache holds every snapshot we've ever
// fetched, so we can reconstruct the directory list from it.
let snapshotDirs: GHEntry[]

const sheetsResp = await ghFetch(GITHUB_SHEETS_API)
if (sheetsResp.ok) {
  const allEntries = (await sheetsResp.json()) as GHEntry[]
  snapshotDirs = allEntries
    .filter((e) => e.type === 'dir')
    .sort((a, b) => b.name.localeCompare(a.name))
  console.log(`  ${snapshotDirs.length} snapshot dirs from API`)
} else {
  console.warn(`  ⚠ GitHub API ${sheetsResp.status} — falling back to local cache`)
  const cacheFiles = existsSync(CACHE_DIR)
    ? readdirSync(CACHE_DIR)
        .filter((f) => f.startsWith('sheets_'))
        .map((f) => f.replace(/\.(xlsx|csv)$/, ''))
    : []
  const uniqueNames = [...new Set(cacheFiles)].sort((a, b) => b.localeCompare(a))
  snapshotDirs = uniqueNames.map((name) => ({ name, type: 'dir' }))
  console.log(`  ${snapshotDirs.length} snapshot dirs from cache`)
  if (snapshotDirs.length === 0) throw new Error('No cached snapshots found. Set GH_TOKEN and retry.')
}

let latestBuf: Buffer | null = null
let snapshotName = ''

for (const dir of snapshotDirs.slice(0, 5)) {
  const buf = await snapshotBuffer(dir)
  if (!buf) continue

  latestBuf = buf
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

const dirDate = (name: string): string | null => {
  const m = name.match(/^sheets_(\d{4})(\d{2})(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

// Pull the archived snapshots that PREDATE the live stream — the pre-2025 HTML
// era (before_2025, CSV) plus the Mar–mid-May 2025 gap fill (after_2025, xlsx).
// Keeping only dirs before the live start means no overlap to dedup; the live
// folder stays canonical for any shared date. See #169.
const liveDirs = chronologicalSnapshots(snapshotDirs)
const earliestLiveDate = liveDirs.map((d) => dirDate(d.name)).filter(Boolean).sort()[0] ?? null

async function archiveDirsBefore(api: string, label: string, cutoff: string | null): Promise<GHEntry[]> {
  const resp = await ghFetch(api)
  if (!resp.ok) {
    console.warn(`  ⚠ ${label} archive listing failed (${resp.status}) — skipping that era`)
    return []
  }
  const entries = (await resp.json()) as GHEntry[]
  return chronologicalSnapshots(entries.filter((e) => e.type === 'dir')).filter(
    (d) => !cutoff || (dirDate(d.name) ?? '') < cutoff
  )
}

const before2025Dirs = await archiveDirsBefore(GITHUB_BEFORE2025_API, 'before_2025', earliestLiveDate)
const after2025Dirs = await archiveDirsBefore(GITHUB_AFTER2025_API, 'after_2025', earliestLiveDate)
console.log(
  `  + ${before2025Dirs.length} before_2025 (HTML era) + ${after2025Dirs.length} after_2025 (gap fill) archive snapshots before ${earliestLiveDate}`
)

const allDirs = chronologicalSnapshots([...before2025Dirs, ...after2025Dirs, ...liveDirs])
console.log(`  Ingesting all ${allDirs.length} snapshots (oldest-first)`)

interface SnapshotRecord {
  date: string
  agencies: Map<string, SnapshotAgency>
}

// Fetch snapshots in small batches to respect GitHub API rate limits
const BATCH = 5
const rawSnapshots: SnapshotRecord[] = []

for (let i = 0; i < allDirs.length; i += BATCH) {
  const batch = allDirs.slice(i, i + BATCH)
  const results = await Promise.all(
    batch.map(async (dir): Promise<SnapshotRecord | null> => {
      const m = dir.name.match(/^sheets_(\d{4})(\d{2})(\d{2})/)
      if (!m) return null
      const date = `${m[1]}-${m[2]}-${m[3]}`

      // Reuse already-downloaded latest snapshot buffer
      if (dir.name === snapshotName && latestBuf) {
        return { date, agencies: parseSnapshot(latestBuf) }
      }

      const buf = await snapshotBuffer(dir)
      if (!buf) return null
      return { date, agencies: parseSnapshot(buf) }
    })
  )
  for (const r of results) if (r) rawSnapshots.push(r)
  process.stdout.write(`  ${Math.min(i + BATCH, allDirs.length)}/${allDirs.length} fetched\r`)
}
console.log()

// Reject broken snapshots. A handful of upstream dates return malformed xlsx
// that parse as a mass phantom-removal and bounce back days later. We pin the
// known-bad dates outright (some, like 2026-02-28, drop too few agencies to
// trip the ratio test below). The pipeline is run attended, so the count
// heuristic additionally FLAGS any new suspicious snapshot — verify it and add
// it to KNOWN_BAD_SNAPSHOTS. See #118.
const KNOWN_BAD_SNAPSHOTS = new Set([
  '2026-01-01', // 1,012 of ~1,582 dropped, back by 2026-01-10
  '2025-10-25', //   870 dropped, back by 2025-11-01
  '2025-06-10', //   492 dropped, back by 2025-06-21
  '2026-02-28', //    55 dropped + re-added; too mild for the ratio test
])
// The real malformed-snapshot detector is the RELATIVE gate (DROP_RATIO vs the
// prior good count) — it scales across eras on its own: 287(g) was rare early on
// (dozens of agencies in the 2021 HTML era), ~305 in Mar 2025, ~1,500 today, so
// no single absolute count is meaningfully "too low" everywhere. MIN_AGENCIES is
// therefore just an empty/near-empty-parse backstop for the FIRST snapshot (which
// has no prior to compare against); keep it well below the sparsest real era so a
// future before_2025 ingest drops in cleanly. See #169.
const MIN_AGENCIES = 20
const DROP_RATIO = 0.7
const snapshots: SnapshotRecord[] = []
const rejected: { date: string; count: number; reason: string }[] = []
let lastGoodCount = 0
for (const snap of rawSnapshots) {
  const count = snap.agencies.size
  if (KNOWN_BAD_SNAPSHOTS.has(snap.date)) {
    rejected.push({ date: snap.date, count, reason: 'known-bad' })
    continue
  }
  // Heuristic detector for *new* broken snapshots: an implausible count drop.
  // Reject and warn loudly so an attended run can confirm and pin it above.
  if (count < MIN_AGENCIES || (lastGoodCount && count < DROP_RATIO * lastGoodCount)) {
    const reason = count < MIN_AGENCIES ? `<${MIN_AGENCIES}` : `<${DROP_RATIO * 100}% of ${lastGoodCount}`
    rejected.push({ date: snap.date, count, reason: `SUSPECT (${reason})` })
    console.warn(`  ⚠ SUSPECT snapshot ${snap.date}: ${count} agencies (${reason}) — verify and add to KNOWN_BAD_SNAPSHOTS if broken`)
    continue
  }
  snapshots.push(snap)
  lastGoodCount = count
}
console.log(`  ${snapshots.length} snapshots accepted, ${rejected.length} rejected`)
for (const r of rejected) {
  console.log(`    rejected ${r.date}: ${r.count} agencies (${r.reason})`)
}

// Observed window per agency across the clean snapshot sequence. snapshots are
// oldest-first, so firstIdx is set once and lastIdx advances. We also keep the
// last-seen row so a since-terminated agency can be rebuilt from it (it never
// reaches the latest-snapshot normalize/group pass). first_seen/terminated date
// derivation moves below, after rename resolution merges aliases (#118).
const N = snapshots.length
const dateAt = (i: number): string => snapshots[i].date
const observed = new Map<string, { firstIdx: number; lastIdx: number; lastRow: SnapshotAgency }>()
// Earliest non-blank signed date ICE ever reported for each agency. ICE revises
// the SIGNED cell forward over time (and sometimes lists an agency before
// assigning any date), which would otherwise push an agency's timeline position
// months past when it actually appeared. We pin the EARLIEST claim as the
// baseline so the timeline reflects first intent, not the latest revision. #118
const earliestSigned = new Map<string, string>()
snapshots.forEach((snap, i) => {
  for (const [key, obs] of snap.agencies) {
    const e = observed.get(key)
    if (!e) observed.set(key, { firstIdx: i, lastIdx: i, lastRow: obs })
    else { e.lastIdx = i; e.lastRow = obs }
    if (obs.signed_date) {
      const prev = earliestSigned.get(key)
      if (!prev || obs.signed_date < prev) earliestSigned.set(key, obs.signed_date)
    }
  }
})

// Derive per-agency history: only record dates where the model set changed.
// Takes an alias group (one canonical key plus any pre-rename keys merged into
// it) and unions their models per snapshot, so a relabel doesn't read as a
// drop-then-re-add. The groups never overlap in time, so the union is clean.
function buildHistory(keys: Set<string>): HistoryEvent[] {
  const events: HistoryEvent[] = []
  let prev = new Set<string>()
  for (const snap of snapshots) {
    const curr = new Set<string>()
    for (const k of keys) {
      const obs = snap.agencies.get(k)
      if (obs) for (const m of obs.models) curr.add(m)
    }
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
    model: normalizeModel(str(row['SUPPORT TYPE'])) || null,
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

// Group on the pipeline's own notion of agency identity, NOT the raw name.
// Upstream spells one agency more than one way — a curly apostrophe in the Jail
// Enforcement row and a straight one in the Task Force row — and keying on the
// raw string made that one agency into two, each holding a fragment of its
// models (#240). historyKey is the right key because it's already the identity
// the history/rename layer uses, so grouping and history can't disagree about
// what an agency is; it strips non-alphanumerics, which is exactly the class of
// difference upstream produces. (The slug generator had been quietly absorbing
// the same signal: both spellings slugify identically, collide, and the twin
// became `…-tx-1`. See the collision warning below.)
const byAgency = new Map<string, NormalizedRow[]>()
for (const row of normalizedRows) {
  const key = historyKey(row.name, row.state)
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
  // The rows in a group can spell the name differently, but only in characters
  // historyKey ignores — so the choice is typographic, never semantic, and any
  // variant is equally true. Sort and take the first: deterministic, and it
  // happens to prefer the ASCII apostrophe (U+0027 sorts before U+2019), which
  // is what the other ~1,800 agencies read like. Deterministic is the load-
  // bearing part — picking by row order would let an upstream reshuffle rewrite
  // the name, and a changed name means a changed agency_index, which means a
  // spurious deploy, bake and social post. (titleAgency re-cases it downstream.)
  const displayName = [...new Set(rows.map((r) => r.name))].sort()[0]
  const first = rows.find((r) => r.name === displayName) ?? rows[0]
  const models = [
    ...new Set(rows.map((r) => r.model).filter((m): m is string => !!m)),
  ].sort()
  const moa = rows.map((r) => r.moa_url).find((u) => u?.startsWith('http')) ?? null
  grouped.push({
    name: displayName,
    state: first.state,
    county: first.county,
    agency_type: first.agency_type,
    models,
    signed_date: first.signed_date,
    moa_url: moa,
  })
}

console.log(`  ${grouped.length} unique agencies`)

// ── 4. Geocode via Census gazetteers ────────────────────────────────────────────
//
// Cascade per agency:
//   • State Agency      → no dot (statewide bodies aren't a single point; surfaced
//                         in lists/counts instead, never on the map)
//   • Municipality      → place / county-subdivision centroid keyed off the agency
//                         name (the actual town), falling back to its county centroid
//   • County (or other) → county centroid
//   • a curated override table (campus/airport police, county-typo sheriffs)
//     redirects odd names to the right town/county
//
// Place names are matched case-insensitively with Saint/St. and &/and folded
// together, indexed under both the full gazetteer name ("Lake City") and the
// suffix-stripped form ("Apopka" from "Apopka city") so "X City"-style names and
// bare names both resolve.

// Fold the spelling variants the upstream sheet and the Census files disagree on.
const normPlace = (s: string): string =>
  s
    .toUpperCase()
    .replace(/\bSAINTE?\s+/g, (m) => (m.trim() === 'SAINTE' ? 'STE. ' : 'ST. '))
    .replace(/&/g, 'AND')
    .replace(/[.']/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// A few agencies don't geocode from their name alone — campus and airport
// police, multi-county jail authorities, and county sheriffs whose county field
// is a typo. Rather than hand-key coordinates, we map each to the town or county
// we want its dot in and resolve THAT through the gazetteers above, so every dot
// lands at a real, verifiable centroid. Keyed by normName(agency)|state.
// (One straggler — Northwest Regional Police Department, PA — is genuinely
// ambiguous and is intentionally left unplaced.)
const normName = (s: string): string => s.toUpperCase().replace(/\s+/g, ' ').trim()

const PLACE_OVERRIDES: Record<string, string> = {
  // Florida campus police → host city
  'FLORIDA A&M UNIVERSITY BOARD OF TRUSTEES|FL': 'Tallahassee',
  'FLORIDA INTERNATIONAL UNIVERSITY POLICE DEPARTMENT|FL': 'Miami',
  'FLORIDA POLYTECHNIC UNIVERSITY POLICE DEPARTMENT|FL': 'Lakeland',
  'FLORIDA SOUTHWESTERN STATE COLLEGE POLICE DEPARTMENT|FL': 'Fort Myers',
  'FLORIDA STATE COLLEGE AT JACKSONVILLE POLICE DEPARTMENT|FL': 'Jacksonville',
  'NEW COLLEGE OF FLORIDA POLICE DEPARTMENT|FL': 'Sarasota',
  'NORTHWEST FLORIDA STATE COLLEGE POLICE DEPARTMENT|FL': 'Niceville',
  'TALLAHASSEE STATE COLLEGE POLICE DEPARTMENT|FL': 'Tallahassee',
  'UNIVERSITY OF FLORIDA POLICE DEPARTMENT|FL': 'Gainesville',
  'UNIVERSITY OF NORTH FLORIDA POLICE DEPARTMENT|FL': 'Jacksonville',
  'UNIVERSITY OF WEST FLORIDA POLICE DEPARTMENT|FL': 'Pensacola',
  // Florida airport police → host city
  'MELBOURNE INTERNATIONAL AIRPORT POLICE DEPARTMENT|FL': 'Melbourne',
  'SANFORD AIRPORT POLICE DEPARTMENT|FL': 'Sanford',
  'SARASOTA MANATEE AIRPORT AUTHORITY POLICE DEPARTMENT|FL': 'Sarasota',
  // Spelling / suffix the gazetteer disagrees on
  'HOWEY IN THE HILLS POLICE DEPARTMENT|FL': 'Howey-in-the-Hills',
  'SUNNY ISLES POLICE DEPARTMENT|FL': 'Sunny Isles Beach',
  'PITTSBURGH POLICE DEPARTMENT|NH': 'Pittsburg',
  // Multi-county authorities → the town they're headquartered in
  'RAPPAHANNOCK, SHENANDOAH, WARREN REGIONAL JAIL AUTHORITY|VA': 'Front Royal',
  'SOUTHWEST VIRGINIA REGIONAL JAIL AUTHORITY|VA': 'Abingdon',
  'NORTH COUNTY POLICE COOPERATIVE|MO': 'Pagedale',
}

const COUNTY_OVERRIDES: Record<string, string> = {
  "POPE COUNTY SHERIFF'S OFFICE|AR": 'Pope County', // sheet had "Pop County"
  "CALCASIEU PARISH SHERIFF'S OFFICE|LA": 'Calcasieu Parish', // "Calacasieu"
  "ST. BERNARD PARISH SHERIFF'S OFFICE|LA": 'St. Bernard Parish', // "Chalmette Parish"
  "ST. CHARLES PARISH SHERIFF'S OFFICE|LA": 'St. Charles Parish', // "German Coast County"
  "BERRIAN COUNTY SHERIFF'S OFFICE|MI": 'Berrien County', // misspelled in agency name
  "CUSTER COUNTY SHERIFF'S OFFICE|OK": 'Custer County', // "Custer Countey"
}

const PLACE_SUFFIX =
  /\s+(city|town|village|borough|CDP|municipality|township|consolidated government|metro(politan)? government|unified government|urban county)$/i

// Trailing agency words to strip so an agency name collapses to its place name,
// e.g. "Apopka Police Department" → "Apopka", "Manheim Borough PD" → "Manheim Borough".
const AGENCY_TAIL =
  /\s+(Police(\s+Services)?\s+Department|Police\s+Dept\.?|Department\s+of\s+Police|Police\s+Services|Marshal(?:'?s)?\s+Office|Constable(?:'?s)?(\s+Office)?|Department\s+of\s+Public\s+Safety|Public\s+Safety\s+Department|Public\s+Safety|Police|Department\s+of\s+Corrections)\s*$/i

const placeNameFromAgency = (name: string): string =>
  name.replace(/^(City|Town|Village|Borough)\s+of\s+/i, '').replace(AGENCY_TAIL, '').trim()

async function loadGazetteer(url: string): Promise<Array<[string, string, number, number]>> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Census Gazetteer ${url}: ${resp.status}`)
  const zip = new AdmZip(Buffer.from(await resp.arrayBuffer()))
  const txtEntry = zip.getEntries().find((e) => e.entryName.endsWith('.txt'))
  if (!txtEntry) throw new Error(`No .txt in Census Gazetteer zip: ${url}`)
  const [headerLine, ...dataLines] = txtEntry.getData().toString('latin1').trim().split('\n')
  const headers = headerLine.split('\t').map((h) => h.trim())
  const col = (name: string) => headers.indexOf(name)
  const out: Array<[string, string, number, number]> = []
  for (const line of dataLines) {
    const cols = line.split('\t')
    const state = cols[col('USPS')]?.trim()
    const name = cols[col('NAME')]?.trim()
    const lat = parseFloat(cols[col('INTPTLAT')]?.trim())
    const lng = parseFloat(cols[col('INTPTLONG')]?.trim())
    if (!state || !name || isNaN(lat) || isNaN(lng)) continue
    out.push([state, name, lat, lng])
  }
  return out
}

console.log('\nFetching Census Bureau gazetteers (counties, places, county subdivisions)...')
const [countyRows, placeRows, cousubRows] = await Promise.all([
  loadGazetteer(COUNTY_GAZETTEER_URL),
  loadGazetteer(PLACE_GAZETTEER_URL),
  loadGazetteer(COUSUB_GAZETTEER_URL),
])

// County centroids: keyed by full ("Orange County") and stripped ("Orange") name.
const counties = new Map<string, [number, number]>()
for (const [state, name, lat, lng] of countyRows) {
  const full = normPlace(name)
  const stripped = normPlace(name.replace(COUNTY_SUFFIX, ''))
  const key = (n: string) => `${n}|${state}`
  if (!counties.has(key(full))) counties.set(key(full), [lat, lng])
  if (!counties.has(key(stripped))) counties.set(key(stripped), [lat, lng])
}

// Place + county-subdivision centroids share one index (a municipality may be
// either an incorporated place or a New England-style town/township).
const places = new Map<string, [number, number]>()
for (const [state, name, lat, lng] of [...placeRows, ...cousubRows]) {
  const full = normPlace(name)
  const stripped = normPlace(name.replace(PLACE_SUFFIX, ''))
  const key = (n: string) => `${n}|${state}`
  if (!places.has(key(full))) places.set(key(full), [lat, lng])
  if (!places.has(key(stripped))) places.set(key(stripped), [lat, lng])
}

console.log(
  `  Loaded ${counties.size} county + ${places.size} place/cousub centroid keys`,
)

function countyLatLng(county: string | null, state: string): [number, number] | null {
  if (!county) return null
  const full = normPlace(county)
  const stripped = normPlace(county.replace(COUNTY_SUFFIX, ''))
  return counties.get(`${full}|${state}`) ?? counties.get(`${stripped}|${state}`) ?? null
}

function placeLatLng(name: string, state: string): [number, number] | null {
  return places.get(`${normPlace(placeNameFromAgency(name))}|${state}`) ?? null
}

// Fully deterministic, offline geocode. Returns null when nothing matches — a
// handful of agencies (e.g. Northwest Regional PD, PA) are intentionally left
// unplaced rather than dropped at a wrong location.
function geocode(
  name: string,
  county: string | null,
  state: string,
  type: string | null,
): [number, number] | null {
  if (type === 'State Agency') return null // statewide → never a single map dot
  const ovKey = `${normName(name)}|${state}`
  const placeOverride = PLACE_OVERRIDES[ovKey]
  if (placeOverride) return places.get(`${normPlace(placeOverride)}|${state}`) ?? null
  const countyOverride = COUNTY_OVERRIDES[ovKey]
  if (countyOverride) return countyLatLng(countyOverride, state)
  if (type === 'Municipality') return placeLatLng(name, state) ?? countyLatLng(county, state)
  return countyLatLng(county, state)
}

// ── 5. Build output ────────────────────────────────────────────────────────────

console.log('\nBuilding output...')

// ── Rename resolution + termination detection (#118) ─────────────────────────
//
// Active keys = the agencies we emit (drawn from the latest snapshot). Anything
// observed historically but absent from this set has "disappeared": it was
// either relabeled (fold it into the surviving record) or it genuinely left.
const activeKeys = new Set(grouped.map((g) => historyKey(g.name, g.state)))

// Candidate active agencies per state, with their latest-known name + county.
const activeByState = new Map<string, { key: string; name: string; county: string | null }[]>()
for (const key of activeKeys) {
  const e = observed.get(key)
  if (!e) continue
  const st = e.lastRow.state
  const bucket = activeByState.get(st) ?? []
  bucket.push({ key, name: e.lastRow.name, county: e.lastRow.county })
  activeByState.set(st, bucket)
}

// Find the active agency a vanished one was renamed into, or null if it looks
// like a genuine departure. Tiers, strictest first (validated in #118):
//   1. exact canonical-name match
//   2. state-prefix addition ("…" → "Texas …"): exact after stripping the state
//   3. typo: full-string edit distance ≤ 2 (every real upstream typo is ≤2;
//      every distinct-agency near-miss like Pike/Hale County is ≥3)
//   4. identical distinctive tokens + same county (label drift)
//   4b. identical distinctive tokens, ≥2 of them, county-agnostic
function findRenameTarget(vanishedKey: string): string | null {
  const e = observed.get(vanishedKey)!
  const st = e.lastRow.state
  const cands = activeByState.get(st) ?? []
  const c = canonName(e.lastRow.name)
  const dt = distinctiveTokens(e.lastRow.name)
  const foldCounty = (x: string | null) => (x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const eCounty = foldCounty(e.lastRow.county)
  for (const a of cands) if (canonName(a.name) === c) return a.key
  const sn = STATE_FULL_BY_ABBR[st]
  const strip = (s: string) => (sn && s.startsWith(sn + ' ') ? s.slice(sn.length + 1) : s)
  const cs = strip(c)
  for (const a of cands) if (strip(canonName(a.name)) === cs) return a.key
  let best: string | null = null
  let bestD = Infinity
  for (const a of cands) {
    const d = editDistance(c, canonName(a.name))
    if (d < bestD) { bestD = d; best = a.key }
  }
  if (best && bestD <= 2) return best
  for (const a of cands)
    if (dt.size && sameSet(dt, distinctiveTokens(a.name)) && foldCounty(a.county) === eCounty) return a.key
  for (const a of cands) if (dt.size >= 2 && sameSet(dt, distinctiveTokens(a.name))) return a.key
  return null
}

// Walk every disappeared agency: merge renames into their survivor (carrying the
// earlier first-seen + a unified history) and collect sustained departures.
const TERMINATION_MIN_ABSENT_SNAPSHOTS = 3 // ~1 week at the every-other-day cadence
const aliasGroups = new Map<string, Set<string>>() // active key → {self, ...pre-rename aliases}
const mergedFirstIdx = new Map<string, number>()    // active key → earliest first-seen idx
for (const key of activeKeys) {
  const e = observed.get(key)
  if (e) mergedFirstIdx.set(key, e.firstIdx)
}
const terminationKeys: string[] = []
let renameCount = 0
let blipCount = 0
for (const [key, e] of observed) {
  if (activeKeys.has(key)) continue // still active
  const target = findRenameTarget(key)
  if (target) {
    renameCount++
    const group = aliasGroups.get(target) ?? new Set([target])
    group.add(key)
    aliasGroups.set(target, group)
    if (e.firstIdx < (mergedFirstIdx.get(target) ?? Infinity)) mergedFirstIdx.set(target, e.firstIdx)
    continue
  }
  if (N - 1 - e.lastIdx >= TERMINATION_MIN_ABSENT_SNAPSHOTS) terminationKeys.push(key)
  else blipCount++
}
console.log(
  `  Rename resolution: ${renameCount} relabels merged, ${blipCount} brief blips ignored, ${terminationKeys.length} genuine terminations`,
)

// first_seen reflects the earliest alias in the group; an active agency is never
// terminated, so terminated_date is set only on the separate terminated payload.
function firstSeenDate(key: string): string | null {
  const idx = mergedFirstIdx.get(key) ?? observed.get(key)?.firstIdx
  return idx == null ? null : dateAt(idx)
}
const aliasGroupOf = (key: string): Set<string> => aliasGroups.get(key) ?? new Set([key])

// Earliest signing date ICE ever reported across the alias group (so a relabel
// doesn't reset the clock). Null if ICE never put a date on this agency.
function earliestSignedDate(keys: Set<string>): string | null {
  let best: string | null = null
  for (const k of keys) {
    const s = earliestSigned.get(k)
    if (s && (!best || s < best)) best = s
  }
  return best
}

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
  if (count > 0) {
    // Two agencies we consider distinct slugify the same. This counter is how
    // the apostrophe duplicates hid for years (#240) — it minted `…-tx-1` and
    // said nothing, so one agency reading as two looked like two agencies. Now
    // that grouping keys on historyKey this should never fire, and if it does,
    // the pair deserves a look before anyone trusts the count.
    console.warn(
      `  ⚠ slug collision: '${name}' (${state}) → ${slug} — two agencies share a slug; is one a duplicate?`,
    )
  }
  seenSlugs.set(base, count + 1)

  const [lat, lng] = geocode(name, row.county, state, row.agency_type) ?? [null, null]
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
    signed_date: earliestSignedDate(aliasGroupOf(hKey)) ?? row.signed_date,
    first_seen_date: firstSeenDate(hKey),
    terminated_date: null,
    population: null,
    lat,
    lng,
    moa_url: row.moa_url,
    ori: null,
    snapshot_date: snapshotDate,
    contact_website: null,
    contact_phone: null,
    contact_address: null,
    moa_date_signed: null,
    ice_field_office: null,
    ice_signer_name: null,
    ice_signer_title: null,
    lea_signer_name: null,
    moa_poc_name: null,
    moa_poc_email: null,
    moa_poc_phone: null,
    moa_poc_address: null,
    moa_addendum_date: null,
    moa_addendum_signer: null,
    history: buildHistory(aliasGroupOf(hKey)),
    lee: null,
    agreement: null,
    notes: null,
  })
}

// Genuine terminations: rebuild each from its last-seen snapshot row (it never
// reached the latest-snapshot pass above) and emit to a SEPARATE payload so the
// active topline in agency_index.json is unchanged. The map animation reads
// this file to fade agencies out at their terminated_date.
const terminatedAgencies: Agency[] = []
for (const key of terminationKeys) {
  const e = observed.get(key)!
  const row = e.lastRow
  const name = titleAgency(row.name)
  if (!name || !row.state) continue

  const models = [...row.models].sort()
  const primary = MODEL_PRIORITY.find((m) => models.includes(m)) ?? models[0] ?? null

  const base = makeSlug(name, row.state)
  const count = seenSlugs.get(base) ?? 0
  const slug = count === 0 ? base : `${base}-${count}`
  seenSlugs.set(base, count + 1)

  const [lat, lng] = geocode(name, row.county, row.state, row.agency_type) ?? [null, null]

  terminatedAgencies.push({
    slug,
    name,
    state: row.state,
    county: row.county,
    city: null,
    agency_type: row.agency_type ?? 'Unknown',
    models,
    primary_model: primary,
    signed_date: earliestSignedDate(aliasGroupOf(key)) ?? row.signed_date,
    first_seen_date: firstSeenDate(key),
    terminated_date: dateAt(e.lastIdx),
    population: null,
    lat,
    lng,
    moa_url: null,
    ori: null,
    snapshot_date: snapshotDate,
    contact_website: null,
    contact_phone: null,
    contact_address: null,
    moa_date_signed: null,
    ice_field_office: null,
    ice_signer_name: null,
    ice_signer_title: null,
    lea_signer_name: null,
    moa_poc_name: null,
    moa_poc_email: null,
    moa_poc_phone: null,
    moa_poc_address: null,
    moa_addendum_date: null,
    moa_addendum_signer: null,
    history: buildHistory(aliasGroupOf(key)),
    lee: null,
    agreement: null,
    notes: null,
  })
}
console.log(`  ${agencies.length} active agencies, ${terminatedAgencies.length} terminated`)

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

const COUNTY_SUFFIXES_287 = [
  /\s+county sheriff'?s? office$/i, /\s+county sheriff'?s? department$/i, /\s+county sheriff'?s?$/i,
  /\s+parish sheriff'?s? office$/i, /\s+parish sheriff'?s? department$/i,
  /\s+borough sheriff'?s? office$/i,
  /\s+sheriff'?s? office$/i, /\s+sheriff'?s? department$/i, /\s+sheriff'?s?$/i,
  /\s+county$/i, /\s+parish$/i,
]

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
  } else if (bucket === 'county') {
    // County LEE rows register their full name ("Jacksonville Sheriff's Office"), but the
    // 287g side strips suffixes down to bare "jacksonville"/"duval". Register the stripped
    // variant too, so a consolidated city-county reaches its real County row instead of
    // falling through to a same-named City row (Jacksonville Beach). #243
    const stripped = applyRegexes(name, COUNTY_SUFFIXES_287)
    if (stripped) variants.add(stripped)
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
// COUNTY_SUFFIXES_287 is declared above the LEE lookup build, which now consumes it too.
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
    // Consolidated city-counties (Jacksonville/Duval) now resolve via the county bucket
    // above. The only County agencies that legitimately match a *city* LEE row are
    // independent cities (VA/MD/MO/NV), which the FBI codes with a "<NAME> CITY"
    // county_name. Gate the fallback on that signal: unconditional, it grabbed a same-named
    // city or township for six county sheriffs — three in a different county entirely. #243
    const cityMatch = findLee(a.state, ['city'], cityCandidates(a.name.replace(/\s+sheriff'?s? office$/i, '').replace(/\s+county$/i, '')))
    return cityMatch && /\bcity$/i.test((cityMatch.county_name ?? '').trim()) ? cityMatch : null
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
      // LEE reports population 0 (not null) for agencies that don't report it.
      // Treat that as "no LEE population" so the MOA population_policed fallback
      // below fills it — otherwise big agencies show 0 residents (e.g. Broward
      // County: LEE 0, MOA 1,951,260). Real positive LEE values still win. #142
      if (lee.population) a.population = lee.population
    }
  }

  // MOA's population_policed is a fallback when LEE has no row for the
  // agency. We prefer LEE because its non-overlapping convention (sheriff
  // = unincorporated only) avoids double-counting in state-level sums;
  // MOA reports whole-county pop for sheriffs, which the agency page
  // surfaces as a separate "Population policed" slot for transparency.
  if (a.population == null && a.agreement?.population_policed != null) {
    a.population = a.agreement.population_policed
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
//
// Dedupe by ORI before tallying participation: several counties (Miami-Dade,
// Orange, Pasco, Volusia, …) appear in the ICE sheet as both a sheriff's
// office and a corrections department under the same FBI ORI. Both rows
// match the same LEE record, so summing them double-counts the agency *and*
// the people it serves. See #99.
const participatingByState = new Map<string, number>()
const popServedByState = new Map<string, number>()
const seenOriByState = new Map<string, Set<string>>()
for (const a of agencies) {
  if (!a.ori) continue
  if (a.agency_type !== 'County' && a.agency_type !== 'Municipality') continue
  const seen = seenOriByState.get(a.state) ?? new Set<string>()
  if (seen.has(a.ori)) continue
  seen.add(a.ori)
  seenOriByState.set(a.state, seen)
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

// Shared key normalizer — used by both MOA index (step 7) and MOA extracts (step 7b).
function moaNorm(s: string): string {
  return s
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const MOA_INDEX_PATH = resolve(__dirname, 'data/moa_index.json')
if (existsSync(MOA_INDEX_PATH)) {
  const moaIndex = JSON.parse(readFileSync(MOA_INDEX_PATH, 'utf8')) as Record<string, string>

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

// ── 7b. MOA signer / field-office enrichment ─────────────────────────────────

const MOA_EXTRACTS_PATH = resolve(__dirname, 'data/moa_extracts.json')
if (existsSync(MOA_EXTRACTS_PATH)) {
  // One PDF's parsed fields + its index metadata (see extract-moa-signers.ts).
  type AgreementExtract = {
    model?: string | null // tag: JEM | TFM | WSO | null
    pdf_url?: string | null
    date_filename?: string | null // raw MMDDYY / MMDDYYYY from filename
    ice_field_office?: string | null
    ice_signer_name?: string | null
    ice_signer_title?: string | null
    lea_signer_name?: string | null
    date_signed?: string | null
    lea_poc_name?: string | null
    lea_poc_email?: string | null
    lea_poc_phone?: string | null
    lea_poc_address?: string | null
    addendum_date?: string | null
    addendum_signer?: string | null
    error?: string
  }
  type MoaExtract = AgreementExtract & {
    agreements?: AgreementExtract[]
    error?: string
  }
  const extracts = JSON.parse(readFileSync(MOA_EXTRACTS_PATH, 'utf8')) as Record<string, MoaExtract>

  // Model tag (JEM/TFM/WSO) → full model name used in agency.models.
  const MODEL_FULL: Record<string, string> = {
    JEM: 'Jail Enforcement Model',
    TFM: 'Task Force Model',
    WSO: 'Warrant Service Officer',
  }

  // Raw filename date (MMDDYY or MMDDYYYY) → ISO "YYYY-MM-DD", else null.
  function isoFromFilenameDate(raw: string | null | undefined): string | null {
    if (!raw) return null
    let mm: number, dd: number, yyyy: number
    if (raw.length === 8) {
      mm = +raw.slice(0, 2); dd = +raw.slice(2, 4); yyyy = +raw.slice(4, 8)
    } else if (raw.length === 6) {
      mm = +raw.slice(0, 2); dd = +raw.slice(2, 4); yyyy = 2000 + +raw.slice(4, 6)
    } else return null
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 2017 || yyyy > 2100) return null
    return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  }

  function toAgreement(ex: AgreementExtract): Agreement {
    return {
      model: ex.model ? (MODEL_FULL[ex.model] ?? ex.model) : null,
      pdf_url: ex.pdf_url ?? null,
      date_signed: ex.date_signed ?? null,
      date_filename: isoFromFilenameDate(ex.date_filename),
      ice_signer_name: ex.ice_signer_name ?? null,
      ice_signer_title: ex.ice_signer_title ?? null,
      ice_field_office: ex.ice_field_office ?? null,
      lea_signer_name: ex.lea_signer_name ?? null,
      moa_poc_name: ex.lea_poc_name ?? null,
      moa_poc_email: ex.lea_poc_email ?? null,
      moa_poc_phone: ex.lea_poc_phone ?? null,
      moa_poc_address: ex.lea_poc_address ?? null,
      addendum_date: ex.addendum_date ?? null,
      addendum_signer: ex.addendum_signer ?? null,
    }
  }

  let moaEnriched = 0
  let agreementsAttached = 0
  for (const a of [...agencies, ...terminatedAgencies]) {
    const key = `${a.state}|${moaNorm(a.name)}`
    const ex = extracts[key]
    if (!ex) continue

    // Per-agreement breakdown (#3): every PDF on file, grouped/sorted in the
    // index already (JEM, TFM, WSO, then newest). Attached even when the flat
    // primary fields are sparse, so the UI can still show "agreements on file".
    if (ex.agreements && ex.agreements.length > 0) {
      a.agreements = ex.agreements.map(toAgreement)
      const onFileModels = new Set(a.agreements.map((g) => g.model).filter(Boolean) as string[])
      a.agreement_coverage = {
        onFile: a.models.filter((m) => onFileModels.has(m)).length,
        modelsListed: a.models.length,
      }
      agreementsAttached++
    }

    // Flat primary fields for back-compat (map/OG/state/model pages read these).
    if (ex.error) continue
    if (ex.ice_field_office) a.ice_field_office = ex.ice_field_office
    if (ex.ice_signer_name) a.ice_signer_name = ex.ice_signer_name
    if (ex.ice_signer_title) a.ice_signer_title = ex.ice_signer_title
    if (ex.lea_signer_name) a.lea_signer_name = ex.lea_signer_name
    if (ex.date_signed) a.moa_date_signed = ex.date_signed
    if (ex.lea_poc_name) a.moa_poc_name = ex.lea_poc_name
    if (ex.lea_poc_email) a.moa_poc_email = ex.lea_poc_email
    if (ex.lea_poc_phone) a.moa_poc_phone = ex.lea_poc_phone
    if (ex.lea_poc_address) a.moa_poc_address = ex.lea_poc_address
    if (ex.addendum_date) a.moa_addendum_date = ex.addendum_date
    if (ex.addendum_signer) a.moa_addendum_signer = ex.addendum_signer
    moaEnriched++
  }
  console.log(
    `\nMOA extracts: enriched ${moaEnriched} agencies (signer / field-office), ` +
      `attached agreements[] to ${agreementsAttached}`,
  )
} else {
  console.log('\nMOA extracts not found — run `pnpm extract:moa-signers` to generate it')
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
// Terminated agencies live in a separate payload so the active topline is
// untouched; the homepage map reads this to fade departures out (#118).
writeFileSync(resolve(OUT_DIR, 'terminated_agencies.json'), JSON.stringify(terminatedAgencies, null, 2))
console.log(`Wrote ${terminatedAgencies.length} terminated agencies → ${resolve(OUT_DIR, 'terminated_agencies.json')}`)

const geocoded = agencies.filter((a) => a.lat !== null).length
const stateAgencies = agencies.filter((a) => a.agency_type === 'State Agency').length
const mappable = agencies.length - stateAgencies // statewide bodies are off-map by design
const ungeocoded = agencies.filter((a) => a.lat === null && a.agency_type !== 'State Agency').length
const withHistory = agencies.filter((a) => a.history.length > 0).length
console.log(`\nWrote ${agencies.length} agencies → ${resolve(OUT_DIR, 'agency_index.json')}`)
console.log(`Snapshot: ${snapshotName}  (${snapshotDate})`)
console.log(`States: ${new Set(agencies.map((a) => a.state)).size}`)
console.log(
  `Geocoded: ${geocoded}/${mappable} mappable (${Math.round((geocoded / mappable) * 100)}%)` +
    ` — ${stateAgencies} statewide agencies off-map by design, ${ungeocoded} still unresolved`,
)
console.log(`Agencies with history events: ${withHistory}`)

const modelCounts = new Map<string, number>()
for (const a of agencies)
  for (const m of a.models) modelCounts.set(m, (modelCounts.get(m) ?? 0) + 1)
console.log('\nModel breakdown:')
for (const [m, c] of [...modelCounts.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`  ${m}: ${c}`)

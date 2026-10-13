import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface DownloadAgency {
  slug: string
  name: string
  state: string
  county: string | null
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
  lee: { officer_ct: number | null } | null
}

const LICENSE = 'CC BY 4.0'
const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'
const SOURCE = '287(g) Watch (https://287g.recoveredfactory.net)'
const CONTACT = '287g@grupovisual.org'

type Row = { agency: DownloadAgency; status: 'active' | 'terminated'; snapshotDate: string }

const COLUMNS: { name: string; description: string; value: (r: Row) => string | number | null }[] = [
  { name: 'slug', description: 'Stable identifier; the agency page is /agency/<slug>.', value: (r) => r.agency.slug },
  { name: 'name', description: "Agency name as it appears in ICE's roster.", value: (r) => r.agency.name },
  { name: 'state', description: 'Two-letter state or territory code.', value: (r) => r.agency.state },
  { name: 'county', description: "County named in ICE's roster; empty for some statewide agencies.", value: (r) => r.agency.county },
  { name: 'agency_type', description: 'County, Municipality or State Agency.', value: (r) => r.agency.agency_type },
  { name: 'primary_model', description: "The agency's main 287(g) model: Jail Enforcement Model, Task Force Model or Warrant Service Officer.", value: (r) => r.agency.primary_model },
  { name: 'models', description: 'Every model the agency holds, separated by semicolons. An agency can hold up to three.', value: (r) => r.agency.models.join('; ') },
  { name: 'status', description: 'active if the agency is on the current roster; terminated if it has left the program.', value: (r) => r.status },
  { name: 'signed_date', description: 'Date the agreement was signed (YYYY-MM-DD).', value: (r) => r.agency.signed_date },
  { name: 'first_seen_date', description: "Date the agency first appeared in ICE's public data (YYYY-MM-DD). It can lag the signing date.", value: (r) => r.agency.first_seen_date },
  { name: 'terminated_date', description: 'Date the agency left the program; empty for active agencies.', value: (r) => r.agency.terminated_date },
  { name: 'population', description: 'Population the agency serves, from FBI Law Enforcement Employee data; empty where unavailable.', value: (r) => r.agency.population },
  { name: 'officer_count', description: 'Sworn officers, from FBI Law Enforcement Employee data; empty where unavailable.', value: (r) => r.agency.lee?.officer_ct ?? null },
  { name: 'ori', description: "FBI Originating Agency Identifier. Some agencies share one, and some have none.", value: (r) => r.agency.ori },
  { name: 'moa_url', description: 'Link to the signed agreement or its folder, where we have one.', value: (r) => r.agency.moa_url },
  { name: 'latitude', description: "Approximate location: the town centroid for municipalities, the county centroid otherwise. Not the agency's address.", value: (r) => r.agency.lat },
  { name: 'longitude', description: 'See latitude.', value: (r) => r.agency.lng },
  { name: 'snapshot_date', description: "Date of the ICE roster snapshot this file was built from (YYYY-MM-DD).", value: (r) => r.snapshotDate },
  { name: 'license', description: `License for the data: Creative Commons Attribution 4.0 (${LICENSE_URL}). Share and adapt, including commercially, with credit. Do not alter the figures.`, value: () => LICENSE },
  { name: 'source', description: 'Credit this source when you use the data.', value: () => SOURCE },
  { name: 'contact', description: 'Email for questions and corrections.', value: () => CONTACT },
]

const BOM = '\uFEFF'

function field(v: string | number | null): string {
  if (v === null) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

const line = (values: (string | number | null)[]) => values.map(field).join(',')

export function writeAgencyDownloads(
  outDir: string,
  active: DownloadAgency[],
  terminated: DownloadAgency[],
  snapshotDate: string | null,
): void {
  if (!snapshotDate) throw new Error('downloads: no snapshot date')
  const byState = (a: DownloadAgency, b: DownloadAgency) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name)
  const rows: Row[] = [
    ...[...active].sort(byState).map((agency) => ({ agency, status: 'active' as const, snapshotDate })),
    ...[...terminated].sort(byState).map((agency) => ({ agency, status: 'terminated' as const, snapshotDate })),
  ]
  if (!active.length) throw new Error('downloads: no active agencies')

  const slugs = new Set<string>()
  for (const { agency } of rows) {
    if (slugs.has(agency.slug)) throw new Error(`downloads: duplicate slug ${agency.slug}`)
    slugs.add(agency.slug)
  }

  const data = [line(COLUMNS.map((c) => c.name)), ...rows.map((r) => line(COLUMNS.map((c) => c.value(r))))]
  const example = (name: string) => {
    const col = COLUMNS.find((c) => c.name === name)!
    const hit = rows.find((r) => col.value(r) !== null && col.value(r) !== '')
    return hit ? col.value(hit) : null
  }
  const dictionary = [
    line(['column', 'description', 'example']),
    ...COLUMNS.map((c) => line([c.name, c.description, example(c.name)])),
    line(['(file)', `UTF-8 with a byte-order mark, so Excel reads accents and curly apostrophes correctly. In pandas use encoding="utf-8-sig". Licensed ${LICENSE}: credit ${SOURCE}. Questions or corrections: ${CONTACT}.`, null]),
  ]

  const dir = resolve(outDir, 'downloads')
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, '287g-agencies-latest.csv'), BOM + data.join('\n') + '\n')
  writeFileSync(resolve(dir, '287g-agencies-data-dictionary.csv'), BOM + dictionary.join('\n') + '\n')
  console.log(`Wrote ${rows.length} agencies (${active.length} active, ${terminated.length} terminated) → ${dir}`)
}

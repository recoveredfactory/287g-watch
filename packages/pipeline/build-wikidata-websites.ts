#!/usr/bin/env tsx
/**
 * build-wikidata-websites.ts
 *
 * Queries Wikidata SPARQL (via POST) for US law enforcement agencies with
 * official websites. Uses label-based text filter; matches against our agency
 * index; writes to data/wikidata_websites.json.
 *
 * Run: pnpm exec tsx build-wikidata-websites.ts
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = resolve(__dirname, 'data/wikidata_websites.json')
const AGENCY_PATH = resolve(__dirname, '../web/static/data/dist/agency_index.json')

function norm(s: string): string {
  return s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

const STATE_ABBR: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS',
  Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC',
  'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA',
  'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN',
  Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA',
  'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC',
}

const agencies: Array<{ name: string; state: string }> =
  JSON.parse(readFileSync(AGENCY_PATH, 'utf8'))

const nameToStates: Map<string, string[]> = new Map()
for (const a of agencies) {
  const key = norm(a.name)
  const existing = nameToStates.get(key) ?? []
  if (!existing.includes(a.state)) existing.push(a.state)
  nameToStates.set(key, existing)
}

async function sparqlPost(query: string, retries = 3): Promise<any[]> {
  const url = 'https://query.wikidata.org/sparql'
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 55000)
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'User-Agent': '287g-explorer/1.0 (education/public-interest)',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/sparql-results+json',
        },
        body: new URLSearchParams({ query }),
      })
      clearTimeout(timer)
      if (res.status === 429) {
        const wait = 15000 * (attempt + 1)
        console.log(`    Rate limited, waiting ${wait/1000}s...`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      if (!res.ok) {
        const text = await res.text()
        if (attempt < retries) { await new Promise(r => setTimeout(r, 5000)); continue }
        throw new Error(`${res.status}: ${text.substring(0, 200)}`)
      }
      const text = await res.text()
      try {
        const data = JSON.parse(text)
        return data.results.bindings
      } catch {
        if (attempt < retries) { await new Promise(r => setTimeout(r, 5000)); continue }
        throw new Error(`JSON parse failed: ${text.substring(0, 200)}`)
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        if (attempt < retries) { console.log('    Timeout, retrying...'); continue }
        throw new Error('Request timed out')
      }
      if (attempt < retries) { await new Promise(r => setTimeout(r, 5000)); continue }
      throw e
    }
  }
  return []
}

// Load existing to merge (not replace)
const output: Record<string, string> = existsSync(OUT_PATH)
  ? JSON.parse(readFileSync(OUT_PATH, 'utf8'))
  : {}

// Remove the old garbage entries (state courts, transit authorities etc.)
for (const key of Object.keys(output)) {
  const n = key.split('|')[1] ?? ''
  if (!nameToStates.has(n)) delete output[key]
}

let added = 0

function processRows(rows: any[]): number {
  let matched = 0
  for (const row of rows) {
    const name: string = row.itemLabel?.value ?? ''
    const website: string = row.website?.value ?? ''
    const stateLabel: string = row.stateLabel?.value ?? ''
    if (!name || !website) continue

    const normalizedName = norm(name)
    const allStates = nameToStates.get(normalizedName)
    if (!allStates || allStates.length === 0) continue

    let targetState: string | undefined
    if (allStates.length === 1) {
      targetState = allStates[0]
    } else if (stateLabel && STATE_ABBR[stateLabel]) {
      const abbr = STATE_ABBR[stateLabel]
      if (allStates.includes(abbr)) targetState = abbr
    }
    if (!targetState) continue

    const key = `${targetState}|${normalizedName}`
    if (!output[key] || (!output[key].startsWith('https') && website.startsWith('https'))) {
      output[key] = website
      added++
      matched++
    }
  }
  return matched
}

async function runQuery(label: string, query: string) {
  console.log(`\nQuerying: ${label}`)
  try {
    const rows = await sparqlPost(query)
    console.log(`  ${rows.length} rows → ${processRows(rows)} new matches`)
  } catch (e: any) {
    console.log(`  ERROR: ${e.message.substring(0, 120)}`)
  }
  await new Promise(r => setTimeout(r, 5000))
}

// ── Sheriff label ────────────────────────────────────────────────────────────
await runQuery('Sheriff (with state via P131)', `
SELECT DISTINCT ?item ?itemLabel ?website ?stateLabel WHERE {
  ?item wdt:P17 wd:Q30 ;
        wdt:P856 ?website .
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en")
  FILTER(CONTAINS(UCASE(STR(?itemLabel)), "SHERIFF"))
  OPTIONAL {
    ?item wdt:P131 ?county .
    OPTIONAL {
      ?county wdt:P131 ?state .
      ?state wdt:P31 wd:Q35657 .
      ?state rdfs:label ?stateLabel . FILTER(LANG(?stateLabel) = "en")
    }
    OPTIONAL {
      ?county wdt:P31 wd:Q35657 .
      ?county rdfs:label ?stateLabel . FILTER(LANG(?stateLabel) = "en")
    }
  }
}
LIMIT 5000`)

// ── Police Department label ──────────────────────────────────────────────────
await runQuery('Police Department (with state via P131)', `
SELECT DISTINCT ?item ?itemLabel ?website ?stateLabel WHERE {
  ?item wdt:P17 wd:Q30 ;
        wdt:P856 ?website .
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en")
  FILTER(CONTAINS(UCASE(STR(?itemLabel)), "POLICE DEPARTMENT") ||
         CONTAINS(UCASE(STR(?itemLabel)), "POLICE DEPT"))
  OPTIONAL {
    ?item wdt:P131 ?county .
    OPTIONAL {
      ?county wdt:P131 ?state .
      ?state wdt:P31 wd:Q35657 .
      ?state rdfs:label ?stateLabel . FILTER(LANG(?stateLabel) = "en")
    }
    OPTIONAL {
      ?county wdt:P31 wd:Q35657 .
      ?county rdfs:label ?stateLabel . FILTER(LANG(?stateLabel) = "en")
    }
  }
}
LIMIT 5000`)

// ── Broader police label ─────────────────────────────────────────────────────
await runQuery('Police (broader, with state)', `
SELECT DISTINCT ?item ?itemLabel ?website ?stateLabel WHERE {
  ?item wdt:P17 wd:Q30 ;
        wdt:P856 ?website .
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en")
  FILTER(CONTAINS(UCASE(STR(?itemLabel)), " POLICE") &&
         !CONTAINS(UCASE(STR(?itemLabel)), "DEPARTMENT OF") &&
         !CONTAINS(UCASE(STR(?itemLabel)), "STATE POLICE"))
  OPTIONAL {
    ?item wdt:P131 ?county .
    OPTIONAL {
      ?county wdt:P131 ?state .
      ?state wdt:P31 wd:Q35657 .
      ?state rdfs:label ?stateLabel . FILTER(LANG(?stateLabel) = "en")
    }
    OPTIONAL {
      ?county wdt:P31 wd:Q35657 .
      ?county rdfs:label ?stateLabel . FILTER(LANG(?stateLabel) = "en")
    }
  }
}
LIMIT 5000`)

// ── Marshal offices ──────────────────────────────────────────────────────────
await runQuery('Marshal / Constable', `
SELECT DISTINCT ?item ?itemLabel ?website ?stateLabel WHERE {
  ?item wdt:P17 wd:Q30 ;
        wdt:P856 ?website .
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en")
  FILTER(CONTAINS(UCASE(STR(?itemLabel)), "MARSHAL") ||
         CONTAINS(UCASE(STR(?itemLabel)), "CONSTABLE"))
  OPTIONAL {
    ?item wdt:P131 ?county .
    OPTIONAL {
      ?county wdt:P131 ?state .
      ?state wdt:P31 wd:Q35657 .
      ?state rdfs:label ?stateLabel . FILTER(LANG(?stateLabel) = "en")
    }
    OPTIONAL {
      ?county wdt:P31 wd:Q35657 .
      ?county rdfs:label ?stateLabel . FILTER(LANG(?stateLabel) = "en")
    }
  }
}
LIMIT 3000`)

// ── By instance type: police (Q35535) ────────────────────────────────────────
await runQuery('Instance: police agency (Q35535)', `
SELECT DISTINCT ?item ?itemLabel ?website ?stateLabel WHERE {
  ?item wdt:P17 wd:Q30 ;
        wdt:P31/wdt:P279* wd:Q35535 ;
        wdt:P856 ?website .
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en")
  OPTIONAL {
    ?item wdt:P131 ?county .
    OPTIONAL {
      ?county wdt:P131 ?state .
      ?state wdt:P31 wd:Q35657 .
      ?state rdfs:label ?stateLabel . FILTER(LANG(?stateLabel) = "en")
    }
    OPTIONAL {
      ?county wdt:P31 wd:Q35657 .
      ?county rdfs:label ?stateLabel . FILTER(LANG(?stateLabel) = "en")
    }
  }
}
LIMIT 5000`)

// ── By instance type: sheriff (Q146591) ──────────────────────────────────────
await runQuery('Instance: sheriff department (Q146591)', `
SELECT DISTINCT ?item ?itemLabel ?website ?stateLabel WHERE {
  ?item wdt:P17 wd:Q30 ;
        wdt:P31/wdt:P279* wd:Q146591 ;
        wdt:P856 ?website .
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en")
  OPTIONAL {
    ?item wdt:P131 ?county .
    OPTIONAL {
      ?county wdt:P131 ?state .
      ?state wdt:P31 wd:Q35657 .
      ?state rdfs:label ?stateLabel . FILTER(LANG(?stateLabel) = "en")
    }
    OPTIONAL {
      ?county wdt:P31 wd:Q35657 .
      ?county rdfs:label ?stateLabel . FILTER(LANG(?stateLabel) = "en")
    }
  }
}
LIMIT 3000`)

// ── Save ──────────────────────────────────────────────────────────────────────
mkdirSync(resolve(__dirname, 'data'), { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify(output, null, 2))
console.log(`\n━━━ Total new/updated: ${added} | File total: ${Object.keys(output).length} ━━━`)
console.log(`Saved to ${OUT_PATH}`)

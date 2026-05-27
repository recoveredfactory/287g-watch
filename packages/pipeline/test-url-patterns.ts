#!/usr/bin/env tsx
/**
 * test-url-patterns.ts
 *
 * For 287g agencies that lack a website, generates candidate URLs from common
 * county sheriff office patterns and verifies them with HTTP HEAD requests.
 * Saves confirmed working URLs to data/scraped_contacts.json.
 *
 * Run: pnpm exec tsx test-url-patterns.ts
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRAPED_PATH = resolve(__dirname, 'data/scraped_contacts.json')
const AGENCY_PATH = resolve(__dirname, '../web/static/data/dist/agency_index.json')

function norm(s: string): string {
  return s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

// Slug for URL construction: lowercase, no spaces, no punctuation
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Parked/for-sale domain signals in page content
const PARKED_SIGNALS = [
  'buy this domain', 'domain for sale', 'godaddy', 'sedoparking',
  'afternic', 'parking', 'this domain', 'register domain',
  'hugedomains', 'namecheap', 'underconstruction', 'coming soon',
]

async function check(url: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research bot)' },
      redirect: 'follow',
    })
    clearTimeout(timer)
    if (!res.ok) return false
    // Read first 2KB to detect parked domains
    const text = await res.text().then(t => t.substring(0, 2000).toLowerCase())
    if (PARKED_SIGNALS.some(s => text.includes(s))) return false
    // Must be HTML
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text/html')) return false
    return true
  } catch {
    return false
  }
}

function countyFromName(agencyName: string): string | null {
  // "Tarrant County Sheriff's Office" → "Tarrant"
  // "Bell County Sheriff's Department" → "Bell"
  const m = agencyName.match(/^([A-Za-z][A-Za-z .'-]+?)\s+County\s+Sheriff/i)
  return m ? m[1].trim() : null
}

function candidateUrls(county: string, state: string): string[] {
  const c = slug(county)        // e.g. "tarrant"
  const s = state.toLowerCase() // e.g. "tx"
  return [
    `https://${c}so.com/`,
    `https://www.${c}so.com/`,
    `https://${c}sheriff.com/`,
    `https://www.${c}sheriff.com/`,
    `https://${c}sheriff.org/`,
    `https://www.${c}sheriff.org/`,
    `https://${c}sheriff.net/`,
    `https://${c}countysheriff.com/`,
    `https://${c}countysheriff.org/`,
    `https://${c}co.${s}.us/sheriff/`,
    `https://www.${c}county.gov/sheriff/`,
    `https://sheriff.${c}county.gov/`,
    `https://${c}${s}sheriff.com/`,
    `https://${c}countysheriffoffice.com/`,
  ]
}

// Load data
const scraped: Record<string, { website?: string; phone?: string; address?: string }> =
  existsSync(SCRAPED_PATH) ? JSON.parse(readFileSync(SCRAPED_PATH, 'utf8')) : {}

const agencies: Array<{ name: string; state: string; contact_website: string | null }> =
  JSON.parse(readFileSync(AGENCY_PATH, 'utf8'))

// Only process sheriff offices without a website
const targets = agencies.filter(
  a => /sheriff/i.test(a.name) && !a.contact_website
)
console.log(`Testing URL patterns for ${targets.length} sheriff agencies without websites...`)

// Also skip if already in scraped_contacts with a website
const toTest = targets.filter(a => {
  const key = `${a.state}|${norm(a.name)}`
  return !scraped[key]?.website
})
console.log(`  (${targets.length - toTest.length} already have scraped website, skipping)`)
console.log(`  Testing ${toTest.length} agencies\n`)

let found = 0
const CONCURRENCY = 8

// Process in batches
for (let i = 0; i < toTest.length; i += CONCURRENCY) {
  const batch = toTest.slice(i, i + CONCURRENCY)
  await Promise.all(
    batch.map(async (agency) => {
      const county = countyFromName(agency.name)
      if (!county) return

      const candidates = candidateUrls(county, agency.state)
      for (const url of candidates) {
        const ok = await check(url)
        if (ok) {
          const key = `${agency.state}|${norm(agency.name)}`
          scraped[key] = { ...scraped[key], website: url }
          found++
          console.log(`  ✓ ${agency.name}: ${url}`)
          break // stop at first working URL
        }
      }
    })
  )
  process.stdout.write(`  Progress: ${Math.min(i + CONCURRENCY, toTest.length)}/${toTest.length}\r`)
  if ((i / CONCURRENCY) % 6 === 5) writeFileSync(SCRAPED_PATH, JSON.stringify(scraped, null, 2))
}

console.log(`\n\nFound ${found} new websites via pattern matching`)
writeFileSync(SCRAPED_PATH, JSON.stringify(scraped, null, 2))
console.log(`Saved to ${SCRAPED_PATH}`)

#!/usr/bin/env tsx
/**
 * test-pd-patterns.ts
 *
 * For 287g municipal police agencies lacking a website, tests common city-based
 * URL patterns via HTTP GET. Saves confirmed URLs to data/scraped_contacts.json.
 *
 * Run: pnpm exec tsx test-pd-patterns.ts
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

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

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
    const text = await res.text().then(t => t.substring(0, 2000).toLowerCase())
    if (PARKED_SIGNALS.some(s => text.includes(s))) return false
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text/html')) return false
    return true
  } catch {
    return false
  }
}

function cityFromName(agencyName: string): string | null {
  const m = agencyName.match(/^(.+?)\s+(?:Police\s+(?:Department|Dept\.?|Division|Bureau)|Department\s+of\s+Public\s+Safety)\b/i)
  return m ? m[1].trim() : null
}

function candidateUrls(city: string, state: string): string[] {
  const c = slug(city)
  const s = state.toLowerCase()
  return [
    `https://${c}pd.com/`,
    `https://www.${c}pd.com/`,
    `https://${c}police.com/`,
    `https://www.${c}police.com/`,
    `https://${c}pd.org/`,
    `https://www.${c}pd.org/`,
    `https://${c}police.org/`,
    `https://www.${c}police.org/`,
    `https://${c}pd.net/`,
    `https://www.${c}pd.net/`,
    `https://${c}police.net/`,
    `https://${c}policedept.com/`,
    `https://${c}policedept.org/`,
    `https://${c}policedepartment.com/`,
    `https://cityof${c}.com/`,
    `https://www.cityof${c}.com/`,
    `https://cityof${c}.org/`,
    `https://www.cityof${c}.org/`,
    `https://${c}${s}pd.com/`,
    `https://www.${c}${s}pd.com/`,
  ]
}

const scraped: Record<string, { website?: string; phone?: string; address?: string }> =
  existsSync(SCRAPED_PATH) ? JSON.parse(readFileSync(SCRAPED_PATH, 'utf8')) : {}

const agencies: Array<{ name: string; state: string; contact_website: string | null; agency_type: string }> =
  JSON.parse(readFileSync(AGENCY_PATH, 'utf8'))

const targets = agencies.filter(
  a => a.agency_type === 'Municipality' && !a.contact_website
)
console.log(`Testing URL patterns for ${targets.length} municipal police agencies without websites...`)

const toTest = targets.filter(a => {
  const key = `${a.state}|${norm(a.name)}`
  return !scraped[key]?.website
})
console.log(`  (${targets.length - toTest.length} already have scraped website, skipping)`)
console.log(`  Testing ${toTest.length} agencies\n`)

let found = 0
const CONCURRENCY = 8

for (let i = 0; i < toTest.length; i += CONCURRENCY) {
  const batch = toTest.slice(i, i + CONCURRENCY)
  await Promise.all(
    batch.map(async (agency) => {
      const city = cityFromName(agency.name)
      if (!city) return

      const candidates = candidateUrls(city, agency.state)
      for (const url of candidates) {
        const ok = await check(url)
        if (ok) {
          const key = `${agency.state}|${norm(agency.name)}`
          scraped[key] = { ...scraped[key], website: url }
          found++
          console.log(`  ✓ ${agency.name}: ${url}`)
          break
        }
      }
    })
  )
  process.stdout.write(`  Progress: ${Math.min(i + CONCURRENCY, toTest.length)}/${toTest.length}\r`)
  if ((i / CONCURRENCY) % 6 === 5) writeFileSync(SCRAPED_PATH, JSON.stringify(scraped, null, 2))
}

console.log(`\n\nFound ${found} new PD websites via pattern matching`)
writeFileSync(SCRAPED_PATH, JSON.stringify(scraped, null, 2))
console.log(`Saved to ${SCRAPED_PATH}`)

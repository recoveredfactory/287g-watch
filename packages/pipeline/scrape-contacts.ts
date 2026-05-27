#!/usr/bin/env tsx
/**
 * scrape-contacts.ts
 *
 * Playwright scraper for law enforcement contact data from state sheriff
 * association directories — sites blocked to curl via CDN bot detection.
 *
 * Confirmed working sources:
 *   AR — arsheriffs.org  (74 287g agencies)
 *   FL — flsheriffs.org  (282 287g agencies)
 *
 * Output: packages/pipeline/data/scraped_contacts.json
 *   { "STATE|normalizedName": { website?, phone?, address? } }
 *
 * Idempotent — merges with existing file, skipping already-scraped entries.
 * Run: pnpm -F pipeline scrape:contacts
 */

import { chromium, type Page } from 'playwright'
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = resolve(__dirname, 'data/scraped_contacts.json')

type ContactEntry = { website?: string; phone?: string; address?: string }

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Load existing so we can resume runs
const results: Record<string, ContactEntry> =
  existsSync(OUT_PATH) ? JSON.parse(readFileSync(OUT_PATH, 'utf8')) : {}

function save() {
  mkdirSync(resolve(__dirname, 'data'), { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(results, null, 2))
}

function upsert(state: string, name: string, data: ContactEntry) {
  const key = `${state}|${norm(name)}`
  results[key] = { ...results[key], ...data }
}

function cleanPhone(raw: string): string {
  return raw.replace(/\s*ext.*$/i, '').trim()
}

// ── AR: arsheriffs.org ────────────────────────────────────────────────────────
// Each county has its own page at /sheriffs/{county}-county-sheriff/
// with address, phone, and "VIEW WEBSITE" link.

async function scrapeAR(context: Awaited<ReturnType<typeof chromium.launch>>['contexts'][0]): Promise<number> {
  console.log('\nScraping AR (arsheriffs.org)...')
  const page = await context.newPage()

  // Step 1: collect county page URLs from the directory
  await page.goto('https://arsheriffs.org/asa-directory/sheriff-directory/', {
    waitUntil: 'networkidle',
    timeout: 45000,
  })
  await page.waitForTimeout(2000)

  const countyUrls: string[] = await page.$$eval('a[href]', (els) =>
    [...new Set(
      els
        .map((el) => (el as HTMLAnchorElement).href)
        .filter((href) => /arsheriffs\.org\/sheriffs\/.+-county-sheriff/.test(href))
    )]
  )
  console.log(`  Found ${countyUrls.length} AR county URLs`)
  await page.close()

  // Step 2: scrape each county page
  let added = 0
  const CONCURRENT = 4
  for (let i = 0; i < countyUrls.length; i += CONCURRENT) {
    const batch = countyUrls.slice(i, i + CONCURRENT)
    await Promise.all(
      batch.map(async (url) => {
        const p = await context.newPage()
        try {
          await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
          await p.waitForTimeout(500)

          const text = await p.evaluate(() =>
            (document.body as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
          )

          // County name from URL: /sheriffs/benton-county-sheriff/ → "Benton County Sheriff's Office"
          const urlMatch = url.match(/\/sheriffs\/(.+)-county-sheriff\/?$/)
          if (!urlMatch) return

          const countySlug = urlMatch[1]
          const countyName = countySlug
            .split('-')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ')
          const agencyName = `${countyName} County Sheriff's Office`

          // Phone: first (NNN) NNN-NNNN in text, before any Fax line
          const phoneSection = text.split(/\bfax\b/i)[0]
          const phoneMatch = phoneSection.match(/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/)
          const phone = phoneMatch ? cleanPhone(phoneMatch[0]) : undefined

          // Website: external link with href not containing arsheriffs.org
          const websiteLinks: string[] = await p.$$eval('a[href]', (els) =>
            els
              .map((el) => (el as HTMLAnchorElement).href)
              .filter(
                (href) =>
                  href.startsWith('https://') &&
                  !href.includes('arsheriffs.org') &&
                  !href.includes('facebook.com') &&
                  !href.includes('twitter.com') &&
                  !href.includes('apple.com') &&
                  !href.includes('mailto:') &&
                  !href.includes('tel:')
              )
          )
          const website = websiteLinks[0] ?? undefined

          // Address: text between "Contact & Address" and the next labelled field
          const addrMatch = text.match(/Contact\s*[&and]*\s*Address\s+(.+?)(?:Email:|Office:|Phone:|Fax:)/is)
          const address = addrMatch ? addrMatch[1].replace(/\s+/g, ' ').trim() : undefined

          if (phone || website) {
            upsert('AR', agencyName, { phone, website, address })
            added++
          }
        } catch (e) {
          // skip quietly
        } finally {
          await p.close()
        }
      })
    )
    process.stdout.write(`  ${Math.min(i + CONCURRENT, countyUrls.length)}/${countyUrls.length} AR counties\r`)
  }
  console.log(`\n  AR done: +${added} entries`)
  return added
}

// ── FL: flsheriffs.org ────────────────────────────────────────────────────────
// /staff-type/sheriff/ lists all sheriffs with links to /staff/{slug}/
// Each staff page has county name, phone, address, and "View Website" link.

async function scrapeFL(context: Awaited<ReturnType<typeof chromium.launch>>['contexts'][0]): Promise<number> {
  console.log('\nScraping FL (flsheriffs.org)...')
  const page = await context.newPage()

  await page.goto('https://flsheriffs.org/staff-type/sheriff/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await page.waitForTimeout(2000)

  // Collect all individual sheriff page URLs
  let sheriffUrls: Array<{ url: string; county: string }> = await page.$$eval(
    'a[href]',
    (els) => {
      const seen = new Set<string>()
      return els
        .filter((el) => (el as HTMLAnchorElement).href.includes('/staff/sheriff-'))
        .map((el) => {
          const href = (el as HTMLAnchorElement).href
          // Try to get county from "Read Bio … {County}" text pattern
          const text = el.closest('article,div,li')?.textContent?.trim() ?? ''
          const countyMatch = text.match(/([A-Z][a-zA-Z\s]+)\s*$/)
          return { url: href, county: countyMatch?.[1]?.trim() ?? '' }
        })
        .filter((e) => {
          if (seen.has(e.url)) return false
          seen.add(e.url)
          return true
        })
    }
  )

  // Also check pagination — FL may have >1 page
  const nextPage = await page.$('a.next, a[rel="next"]').catch(() => null)
  if (nextPage) {
    const nextUrl = await nextPage.evaluate((el) => (el as HTMLAnchorElement).href)
    await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(1500)
    const moreUrls: Array<{ url: string; county: string }> = await page.$$eval('a[href]', (els) =>
      els
        .filter((el) => (el as HTMLAnchorElement).href.includes('/staff/sheriff-'))
        .map((el) => ({ url: (el as HTMLAnchorElement).href, county: '' }))
    )
    const existing = new Set(sheriffUrls.map((e) => e.url))
    for (const e of moreUrls) if (!existing.has(e.url)) sheriffUrls.push(e)
  }

  console.log(`  Found ${sheriffUrls.length} FL sheriff URLs`)
  await page.close()

  let added = 0
  const CONCURRENT = 4
  for (let i = 0; i < sheriffUrls.length; i += CONCURRENT) {
    const batch = sheriffUrls.slice(i, i + CONCURRENT)
    await Promise.all(
      batch.map(async ({ url }) => {
        const p = await context.newPage()
        try {
          await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
          await p.waitForTimeout(500)

          const text = await p.evaluate(() =>
            (document.body as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
          )

          // County name: always the last word(s) immediately before "| VIEW ALL SHERIFFS"
          const pipeIdx = text.indexOf('| VIEW ALL SHERIFFS')
          if (pipeIdx === -1) return
          const beforePipe = text.substring(0, pipeIdx).trim()
          const words = beforePipe.split(/\s+/)
          const lastWord = words[words.length - 1]
          // Handle known 2-word FL county name endings
          const MULTI_WORD_ENDS = new Set(['BEACH', 'JOHNS', 'LUCIE', 'RIVER', 'ROSA', 'DADE'])
          let rawCounty: string
          if (MULTI_WORD_ENDS.has(lastWord.toUpperCase()) && words.length >= 2) {
            rawCounty = `${words[words.length - 2]} ${lastWord}`
          } else {
            rawCounty = lastWord
          }
          const countyName = rawCounty
            .split(' ')
            .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ')
          const agencyName = `${countyName} County Sheriff's Office`

          // Phone: look after "Phone:" label
          const phoneMatch = text.match(/Phone:\s*(\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})/i)
          const phone = phoneMatch ? cleanPhone(phoneMatch[1]) : undefined

          // Website: external "View Website" link (not flsheriffs.org, not flsheriffsjobs)
          const allLinks: string[] = await p.$$eval('a[href]', (els) =>
            els
              .map((el) => (el as HTMLAnchorElement).href)
              .filter(
                (href) =>
                  href.startsWith('https://') &&
                  !href.includes('flsheriffs.org') &&
                  !href.includes('flsheriffsjobs.org') &&
                  !href.includes('facebook.com') &&
                  !href.includes('twitter.com') &&
                  !href.includes('instagram.com') &&
                  !href.includes('youtube.com') &&
                  !href.includes('linkedin.com') &&
                  !href.includes('google') &&
                  !href.includes('apple.com') &&
                  !href.includes('cdcfors') &&
                  !href.includes('mygiftlegacy') &&
                  !href.includes('policies')
              )
          )
          const website = allLinks[0] ?? undefined

          // Address: text between "Address:" and "Phone:" label, strip "Mailing Address:" prefix
          const addrMatch = text.match(/(?:Mailing\s+)?Address:\s*(.*?)(?=Phone:|View Website|County Details|$)/is)
          const address = addrMatch
            ? addrMatch[1].replace(/^(?:Mailing\s+)?Address:\s*/i, '').replace(/\s+/g, ' ').trim()
            : undefined

          if (phone || website) {
            upsert('FL', agencyName, { phone, website, address })
            added++
          }
        } catch {
          // skip
        } finally {
          await p.close()
        }
      })
    )
    process.stdout.write(`  ${Math.min(i + CONCURRENT, sheriffUrls.length)}/${sheriffUrls.length} FL sheriffs\r`)
  }
  console.log(`\n  FL done: +${added} entries`)
  return added
}

// ── GA: georgiasheriffs.org ───────────────────────────────────────────────────
// Single table at /resources/sheriffs-by-county/ with columns:
//   County (ALL CAPS) | Sheriff | Address | Phone Number

async function scrapeGA(context: Awaited<ReturnType<typeof chromium.launch>>['contexts'][0]): Promise<number> {
  console.log('\nScraping GA (georgiasheriffs.org)...')
  const page = await context.newPage()
  let added = 0

  try {
    await page.goto('https://georgiasheriffs.org/resources/sheriffs-by-county/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })
    await page.waitForTimeout(2000)

    const rows = await page.$$eval('table tr', (trs) =>
      trs
        .slice(1) // skip header row
        .map((tr) => {
          const tds = Array.from(tr.querySelectorAll('td'))
          return {
            county: tds[0]?.textContent?.trim() ?? '',
            address: tds[2]?.textContent?.trim() ?? '',
            phone: tds[3]?.textContent?.trim() ?? '',
          }
        })
        .filter((r) => r.county && (r.phone || r.address))
    )

    for (const row of rows) {
      const countyName = row.county
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
      const agencyName = `${countyName} County Sheriff's Office`
      const phone = row.phone ? cleanPhone(row.phone) : undefined
      const address = row.address || undefined
      if (phone || address) {
        upsert('GA', agencyName, { phone, address })
        added++
      }
    }
  } finally {
    await page.close()
  }

  console.log(`  GA done: +${added} entries`)
  return added
}

// ── TN: tnsheriffs.com ────────────────────────────────────────────────────────
// Single page at /sheriff-directory/ — Elementor loop items, each entry has
// four headings in order: sheriff name, county name, address, phone.

async function scrapeTN(context: Awaited<ReturnType<typeof chromium.launch>>['contexts'][0]): Promise<number> {
  console.log('\nScraping TN (tnsheriffs.com)...')
  const page = await context.newPage()
  let added = 0

  try {
    await page.goto('https://tnsheriffs.com/sheriff-directory/', {
      waitUntil: 'networkidle',
      timeout: 30000,
    })
    await page.waitForTimeout(3000)

    const entries = await page.$$eval('.elementor-loop-container > .elementor', (divs) =>
      divs.map((div) => {
        const headings = Array.from(div.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(
          (h) => h.textContent?.replace(/\s+/g, ' ').trim() ?? ''
        )
        // headings[0] = sheriff name, [1] = "X County", [2] = address, [3] = phone
        return {
          countyHeading: headings[1] ?? '',
          address: headings[2] ?? '',
          phone: headings[3] ?? '',
        }
      }).filter((e) => e.countyHeading.includes('County'))
    )

    for (const entry of entries) {
      // "Anderson County" → "Anderson County Sheriff's Office"
      const agencyName = `${entry.countyHeading} Sheriff's Office`
      const phone = entry.phone ? cleanPhone(entry.phone) : undefined
      const address = entry.address || undefined
      if (phone || address) {
        upsert('TN', agencyName, { phone, address })
        added++
      }
    }
  } finally {
    await page.close()
  }

  console.log(`  TN done: +${added} entries`)
  return added
}

// ── IN: indianasheriffs.org ───────────────────────────────────────────────────
// Single page at /resources/find-your-sheriff-office/ with all 92 counties.
// Text format per entry: "{COUNTY} COUNTY SHERIFF {NAME} {address}, IN {zip} Phone: {phone} Get Directions"

async function scrapeIN(context: Awaited<ReturnType<typeof chromium.launch>>['contexts'][0]): Promise<number> {
  console.log('\nScraping IN (indianasheriffs.org)...')
  const page = await context.newPage()
  let added = 0

  try {
    await page.goto('https://indianasheriffs.org/resources/find-your-sheriff-office/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })
    await page.waitForTimeout(2000)

    const fullText = await page.evaluate(
      () => (document.body as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
    )

    // Split on "Get Directions" to isolate each county block
    const chunks = fullText.split('Get Directions').filter((c) => /COUNTY SHERIFF/.test(c))

    for (const chunk of chunks) {
      const countyMatch = chunk.match(/([A-Z][A-Z ]+?) COUNTY SHERIFF/)
      const phoneMatch = chunk.match(/Phone:\s*(\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})/)
      // Address: everything from first digit (or P.O.) up to "Phone:"
      const addrMatch = chunk.match(/COUNTY SHERIFF\s+[A-Z ]+?\s+((?:\d+|P\.O\.)[\s\S]+?)\s*Phone:/s)

      if (!countyMatch || !phoneMatch) continue

      const countyRaw = countyMatch[1].trim()
      const countyName = countyRaw
        .split(' ')
        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
        .join(' ')
      const agencyName = `${countyName} County Sheriff's Office`
      const phone = cleanPhone(phoneMatch[1])
      const address = addrMatch ? addrMatch[1].replace(/\s+/g, ' ').trim() : undefined

      upsert('IN', agencyName, { phone, address })
      added++
    }
  } finally {
    await page.close()
  }

  console.log(`  IN done: +${added} entries`)
  return added
}

// ── NC: ncsheriffs.org ────────────────────────────────────────────────────────
// /find-a-sheriff lists all 100 county sheriff profile pages (/people/{slug}).
// Each page has: county name, phone (Office Telephone), address, website link.

async function scrapeNC(context: Awaited<ReturnType<typeof chromium.launch>>['contexts'][0]): Promise<number> {
  console.log('\nScraping NC (ncsheriffs.org)...')
  const page = await context.newPage()

  await page.goto('https://ncsheriffs.org/find-a-sheriff', {
    waitUntil: 'networkidle',
    timeout: 30000,
  })
  await page.waitForTimeout(2000)

  const peopleUrls: string[] = await page.$$eval('a[href]', (els) =>
    [...new Set(
      els
        .map((el) => (el as HTMLAnchorElement).href)
        .filter((href) => /ncsheriffs\.org\/people\//.test(href))
    )]
  )
  console.log(`  Found ${peopleUrls.length} NC sheriff URLs`)
  await page.close()

  let added = 0
  const CONCURRENT = 2
  for (let i = 0; i < peopleUrls.length; i += CONCURRENT) {
    const batch = peopleUrls.slice(i, i + CONCURRENT)
    await Promise.all(
      batch.map(async (url) => {
        const p = await context.newPage()
        try {
          await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 })
          await p.waitForTimeout(1000)

          const text = await p.evaluate(() =>
            (document.body as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
          )

          // County: nav always ends with "Search" then the county content starts
          const countyMatch = text.match(/Search\s+([A-Za-z][A-Za-z ]{2,30}?)\s+County Sheriff/)
          if (!countyMatch) return

          const countyName = countyMatch[1].trim()
          const agencyName = `${countyName} County Sheriff's Office`

          // Phone: after "Office Telephone"
          const phoneMatch = text.match(/Office Telephone\s*(\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})/)
          const phone = phoneMatch ? cleanPhone(phoneMatch[1]) : undefined

          // Address: "Address {text} North Carolina {zip}" — strip trailing comma from city
          const addrMatch = text.match(/\bAddress\s+(.+?)\s+(?:North Carolina|NC)\s+\d{5}/)
          const address = addrMatch
            ? addrMatch[1].replace(/\s+/g, ' ').trim().replace(/,\s*$/, '')
            : undefined

          // Website: first external link (exclude social, ncsheriffs, nmcdn, etc.)
          const websiteLinks: string[] = await p.$$eval('a[href]', (els) =>
            els
              .map((el) => (el as HTMLAnchorElement).href)
              .filter(
                (href) =>
                  (href.startsWith('http://') || href.startsWith('https://')) &&
                  !href.includes('ncsheriffs.org') &&
                  !href.includes('facebook.com') &&
                  !href.includes('instagram.com') &&
                  !href.includes('twitter.com') &&
                  !href.includes('x.com') &&
                  !href.includes('nmcdn.io') &&
                  !href.includes('newmediacampaigns.com') &&
                  !href.includes('membership.') &&
                  !href.includes('shop.')
              )
          )
          const website = websiteLinks[0] ?? undefined

          if (phone || website || address) {
            upsert('NC', agencyName, { phone, website, address })
            added++
          }
        } catch {
          // skip
        } finally {
          await p.close()
        }
      })
    )
    process.stdout.write(`  ${Math.min(i + CONCURRENT, peopleUrls.length)}/${peopleUrls.length} NC sheriffs\r`)
    await new Promise((r) => setTimeout(r, 800))
  }
  console.log(`\n  NC done: +${added} entries`)
  return added
}

// ── CO: coloradosheriffs.org ──────────────────────────────────────────────────
// /sheriffSDirectory — client-side OCV app, all 64 counties.
// Format: "ADAMS COUNTY Gene Claps Address: 4430 S Adams County Pkwy ... Phone: (303) 655-3215 Fax: ..."

async function scrapeCO(context: Awaited<ReturnType<typeof chromium.launch>>['contexts'][0]): Promise<number> {
  console.log('\nScraping CO (coloradosheriffs.org)...')
  const page = await context.newPage()
  let added = 0

  try {
    await page.goto('https://www.coloradosheriffs.org/sheriffSDirectory', {
      waitUntil: 'networkidle',
      timeout: 45000,
    })
    await page.waitForTimeout(3000)

    const fullText = await page.evaluate(() =>
      (document.body as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
    )

    // Split on all-caps county name boundaries: "ADAMS COUNTY", "ARAPAHOE COUNTY", etc.
    const parts = fullText.split(/(?=\b[A-Z]{2,}(?:\s+[A-Z]{2,})*\s+COUNTY\s+[A-Z])/)

    for (const entry of parts) {
      const countyMatch = entry.match(/^([A-Z]{2,}(?:\s+[A-Z]{2,})*)\s+COUNTY\b/)
      if (!countyMatch) continue

      const rawCounty = countyMatch[1].trim()
      const countyName = rawCounty.split(' ').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ')
      const agencyName = `${countyName} County Sheriff's Office`

      // Phone: before any Fax line
      const beforeFax = entry.split(/\bFax\b/i)[0]
      const phoneMatch = beforeFax.match(/Phone:\s*(\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})/)
      const phone = phoneMatch ? cleanPhone(phoneMatch[1]) : undefined

      // Address: between "Address:" and "Phone:" or "Fax:"
      const addrMatch = entry.match(/Address:\s*(.+?)\s*(?:Phone:|Fax:)/)
      const address = addrMatch ? addrMatch[1].replace(/\s+/g, ' ').trim() : undefined

      if (phone || address) {
        upsert('CO', agencyName, { phone, address })
        added++
      }
    }
  } finally {
    await page.close()
  }

  console.log(`  CO done: +${added} entries`)
  return added
}

// ── ID: idahosheriffs.org ─────────────────────────────────────────────────────
// Jail directory with 44 county entries — also has sheriff phone + website.
// Format: "Ada County Jail Address: 7200 Barrister ... Phone: 208-577-3000 Website: www.adasheriff.org"

async function scrapeID(context: Awaited<ReturnType<typeof chromium.launch>>['contexts'][0]): Promise<number> {
  console.log('\nScraping ID (idahosheriffs.org)...')
  const page = await context.newPage()
  let added = 0

  try {
    await page.goto('https://www.idahosheriffs.org/jail-services/directory-of-idahos-jails/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })
    await page.waitForTimeout(2000)

    const fullText = await page.evaluate(() =>
      (document.body as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
    )

    // Split on county jail entries
    const parts = fullText.split(/(?=\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+County Jail\b)/)

    for (const entry of parts) {
      const countyMatch = entry.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+County Jail/)
      if (!countyMatch) continue

      const countyName = countyMatch[1].trim()
      const agencyName = `${countyName} County Sheriff's Office`

      const phoneMatch = entry.match(/Phone:\s*(\d{3}[-.\s]\d{3}[-.\s]\d{4})/)
      const phone = phoneMatch ? cleanPhone(phoneMatch[1]) : undefined

      const websiteMatch = entry.match(/Website:\s*((?:https?:\/\/)?[^\s]+\.[^\s]+)/)
      let website: string | undefined
      if (websiteMatch) {
        const raw = websiteMatch[1].trim().replace(/\/$/, '')
        website = raw.startsWith('http') ? raw : `https://${raw}`
      }

      const addrMatch = entry.match(/Address:\s*(.+?)\s*(?:Phone:|Website:|$)/)
      const address = addrMatch ? addrMatch[1].replace(/\s+/g, ' ').trim() : undefined

      if (phone || website || address) {
        upsert('ID', agencyName, { phone, website, address })
        added++
      }
    }
  } finally {
    await page.close()
  }

  console.log(`  ID done: +${added} entries`)
  return added
}

// ── NH: nh-sheriffs.org ───────────────────────────────────────────────────────
// /helpful-contacts — 10 NH county sheriff website links (no phone numbers).

async function scrapeNH(context: Awaited<ReturnType<typeof chromium.launch>>['contexts'][0]): Promise<number> {
  console.log('\nScraping NH (nh-sheriffs.org)...')
  const page = await context.newPage()
  let added = 0

  try {
    await page.goto('https://nh-sheriffs.org/helpful-contacts', {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    })
    await page.waitForTimeout(1500)

    const entries = await page.$$eval('a[href]', (els) =>
      els
        .filter((el) => {
          const href = (el as HTMLAnchorElement).href
          const text = el.textContent?.trim() ?? ''
          return (
            href.startsWith('http') &&
            !href.includes('nh-sheriffs.org') &&
            !href.includes('facebook.com') &&
            !href.includes('twitter.com') &&
            /county/i.test(text)
          )
        })
        .map((el) => ({
          text: el.textContent?.trim() ?? '',
          url: (el as HTMLAnchorElement).href,
        }))
    )

    for (const { text, url } of entries) {
      const countyMatch = text.match(/([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+County/i)
      if (!countyMatch) continue
      const countyName = countyMatch[1].trim()
        .split(' ')
        .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
      const agencyName = `${countyName} County Sheriff's Office`
      upsert('NH', agencyName, { website: url })
      added++
    }
  } finally {
    await page.close()
  }

  console.log(`  NH done: +${added} entries`)
  return added
}

// ── WV: wvsheriff.org ─────────────────────────────────────────────────────────
// Single page at /?page_id=21 — one <p> per county with phone, email, optional website link.
// Format: "{County} County Sheriff {Name}\nPhone #: {phone}\nEmail: ...\nWebsite: ..."

async function scrapeWV(context: Awaited<ReturnType<typeof chromium.launch>>['contexts'][0]): Promise<number> {
  console.log('\nScraping WV (wvsheriff.org)...')
  const page = await context.newPage()
  let added = 0

  try {
    await page.goto('https://www.wvsheriff.org/?page_id=21', {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    })
    await page.waitForTimeout(2000)

    // Each county is in a <p> inside .entry-content
    const entries = await page.$$eval('.entry-content p', (paras) =>
      paras
        .map((p) => {
          const text = p.textContent?.replace(/\s+/g, ' ').trim() ?? ''
          // Must start with "{County} County Sheriff"
          if (!/County Sheriff/.test(text)) return null
          const countyMatch = text.match(/^([A-Za-z][A-Za-z ]+?) County Sheriff/)
          if (!countyMatch) return null
          const county = countyMatch[1].trim()
          const phoneMatch = text.match(/Phone #:\s*([\d-]+)/)
          const phone = phoneMatch?.[1]
          // Website: first non-mailto external href in this paragraph
          const link = p.querySelector('a[href]:not([href^="mailto:"])')
          const website = link ? (link as HTMLAnchorElement).href : undefined
          return { county, phone, website }
        })
        .filter((e): e is { county: string; phone: string; website?: string } => !!e && !!e.county)
    )

    for (const entry of entries) {
      const agencyName = `${entry.county} County Sheriff's Office`
      const phone = entry.phone ? cleanPhone(entry.phone) : undefined
      const website = entry.website && !entry.website.includes('wvsheriff.org')
        ? entry.website
        : undefined
      if (phone || website) {
        upsert('WV', agencyName, { phone, website })
        added++
      }
    }
  } finally {
    await page.close()
  }

  console.log(`  WV done: +${added} entries`)
  return added
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('Launching Playwright Chromium...')
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'en-US',
  viewport: { width: 1280, height: 800 },
})

let total = 0

try {
  total += await scrapeAR(context)
  save()
  total += await scrapeFL(context)
  save()
  total += await scrapeGA(context)
  save()
  total += await scrapeTN(context)
  save()
  total += await scrapeIN(context)
  save()
  total += await scrapeNC(context)
  save()
  total += await scrapeWV(context)
  save()
  total += await scrapeCO(context)
  save()
  total += await scrapeID(context)
  save()
  total += await scrapeNH(context)
  save()
} finally {
  await browser.close()
}

console.log(`\nTotal new/updated entries: ${total}`)
console.log(`Total in file: ${Object.keys(results).length}`)
console.log(`Saved to ${OUT_PATH}`)

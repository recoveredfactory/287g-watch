#!/usr/bin/env tsx
/**
 * Build per-state 287(g) news summaries.
 *
 * Calls the PromptQL saved program `news_287g_state_summary` (which does the
 * news gathering + relevance screening remotely) once per state, then does two
 * things PromptQL deliberately can't:
 *
 *   1. Resolves Google News redirect links (`news.google.com/rss/articles/…`)
 *      to publisher URLs. The decode needs Google's batchexecute roundtrip,
 *      which only works from a normal residential/CI IP — from PromptQL's
 *      datacenter IP Google returns a consent interstitial. See resolveGnews.
 *   2. Renders the markdown prose to controlled HTML so the SvelteKit side can
 *      drop it in via {@html} with no client-side markdown dependency.
 *
 * Only the *summaries* are public (statewide_tldr + statewide_summary, each in
 * EN and ES), so only the links inside those prose fields get resolved. The
 * screened article table, publications, roster grounding and cost ledger are
 * stored raw for internal use and are not rendered yet.
 *
 * Output: packages/web/static/data/dist/news/<abbr>.json (+ news/index.json)
 *
 * Env: PQL_NEWS_URL, PQL_NEWS_TOKEN (read from process.env or repo-root .env).
 * Run: pnpm news            # every state with agencies
 *      pnpm news OH PA      # just these states
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const DIST_DIR = resolve(__dirname, '../web/static/data/dist')
const OUT_DIR = resolve(DIST_DIR, 'news')
const RAW_DIR = resolve(__dirname, 'data/news_raw') // cached program responses (gitignored)
const GNEWS_CACHE = resolve(__dirname, 'data/gnews_cache.json') // gnews URL → publisher URL
const AGENCY_INDEX = resolve(DIST_DIR, 'agency_index.json')

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const AFTER = process.env.AFTER || '2025-01-01'
const RESOLVE_DELAY_MS = 200

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
}

// ── Env ──────────────────────────────────────────────────────────────────────
// Maintainers keep creds in the repo-root .env; CI passes them as real env vars.
function loadEnv(key: string): string {
  if (process.env[key]) return process.env[key] as string
  const envPath = resolve(REPO_ROOT, '.env')
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '')
    }
  }
  throw new Error(`Missing required env var ${key} (set it in .env or the environment)`)
}

const PQL_URL = loadEnv('PQL_NEWS_URL')
const PQL_TOKEN = loadEnv('PQL_NEWS_TOKEN')

// ── PromptQL program ─────────────────────────────────────────────────────────
type Artifact = { type: string; name: string; data: unknown; metadata?: unknown }
type ProgramResult = {
  artifacts: Artifact[]
  status: string
  error: unknown
  execution_time_ms?: number
}

async function runProgram(stateName: string, abbr: string, after: string): Promise<ProgramResult> {
  const cachePath = resolve(RAW_DIR, `${abbr}.json`)
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf8')) as ProgramResult
  }
  const manifest = JSON.stringify({
    inputs: [{ name: 'params', title: 'State Summary Params', artifact_type: 'table' }],
    entrypoint: 'default.run.json',
    timezone: 'America/Bogota',
  })
  const params = JSON.stringify([{ state: stateName, state_abbr: abbr, after }])
  const form = new FormData()
  form.append('manifest', manifest)
  form.append('params', params)

  const res = await fetch(PQL_URL, {
    method: 'POST',
    headers: { Authorization: `pat ${PQL_TOKEN}` },
    body: form,
  })
  if (!res.ok) throw new Error(`PromptQL ${abbr}: HTTP ${res.status} ${await res.text()}`)
  const result = (await res.json()) as ProgramResult
  mkdirSync(RAW_DIR, { recursive: true })
  writeFileSync(cachePath, JSON.stringify(result))
  return result
}

function artifact(result: ProgramResult, name: string): Artifact | undefined {
  return result.artifacts.find((a) => a.name === name)
}

// ── Google News link resolution ──────────────────────────────────────────────
const gnewsCache: Record<string, string> = existsSync(GNEWS_CACHE)
  ? JSON.parse(readFileSync(GNEWS_CACHE, 'utf8'))
  : {}

const isGnews = (url: string) => /^https?:\/\/news\.google\.com\/(rss\/)?articles\//.test(url)

async function resolveGnews(url: string): Promise<string> {
  if (gnewsCache[url]) return gnewsCache[url]
  try {
    const id = new URL(url).pathname.split('/').pop() as string
    const page = await fetch(`https://news.google.com/rss/articles/${id}`, {
      headers: { 'User-Agent': UA },
    })
    const html = await page.text()
    const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1]
    const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1]
    const aid = html.match(/data-n-a-id="([^"]+)"/)?.[1]
    if (!sg || !ts || !aid) return url // consent wall / format change → leave clickable
    const inner = JSON.stringify([
      'garturlreq',
      [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
        'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
      aid, Number(ts), sg,
    ])
    const body = 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]))
    const r2 = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA },
      body,
    })
    let txt = await r2.text()
    const nl = txt.indexOf('\n')
    if (nl >= 0) txt = txt.slice(nl)
    const arr = JSON.parse(txt) as unknown[]
    const part = (arr.find((x) => Array.isArray(x) && x[1] === 'Fbv4je') as unknown[]) || arr[0]
    const resolved = JSON.parse((part as unknown[])[2] as string)[1] as string
    gnewsCache[url] = resolved
    return resolved
  } catch {
    return url // any failure → keep the original (a browser click still redirects)
  }
}

// ── Markdown → controlled HTML ───────────────────────────────────────────────
// The program emits a narrow markdown subset: # / ## / ### headers, **bold**,
// _italic_, `- ` bullets, [text](url) links, and PromptQL <wiki://…> pseudo-links.
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(text: string, links: Record<string, string>): string {
  // Links first (their text may itself contain ** / _), pulling href from the
  // resolved-link map; wiki:// and non-http hrefs degrade to plain text. The
  // <…> branch handles markdown's angle-bracket URLs, which may hold spaces and
  // parentheses (PromptQL's wiki:// provenance links do).
  let out = text.replace(/\[([^\]]+)\]\(\s*(<[^>]*>|[^)]*)\s*\)/g, (_m, label: string, href: string) => {
    const clean = href.replace(/^<|>$/g, '').trim()
    const target = links[clean] ?? clean
    if (!/^https?:\/\//.test(target)) return inlineEmphasis(label, links)
    return `<a href="${esc(target)}" target="_blank" rel="noopener noreferrer">${inlineEmphasis(label, links)}</a>`
  })
  out = inlineEmphasis(out, links, true)
  return out
}

function inlineEmphasis(text: string, _links: Record<string, string>, pre = false): string {
  // When called on raw text (pre=false from inline's label path) we must escape;
  // when called on text that already had links substituted (pre=true) the
  // non-tag remainder still needs escaping, so split on our own <a> tags.
  const apply = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])_([^_]+)_/g, '$1<em>$2</em>')
  if (!pre) return apply(text)
  return text
    .split(/(<a [^>]*>.*?<\/a>)/g)
    .map((seg) => (seg.startsWith('<a ') ? seg : apply(seg)))
    .join('')
}

function mdToHtml(md: string, links: Record<string, string>): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let para: string[] = []
  let list: string[] = []
  const flushPara = () => {
    if (para.length) html.push(`<p>${inline(para.join(' '), links)}</p>`)
    para = []
  }
  const flushList = () => {
    if (list.length) html.push(`<ul>${list.map((li) => `<li>${inline(li, links)}</li>`).join('')}</ul>`)
    list = []
  }
  for (const raw of lines) {
    const line = raw.trim()
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    const b = line.match(/^[-*]\s+(.*)$/)
    if (h) {
      flushPara(); flushList()
      const level = Math.min(h[1].length + 1, 4) // # → h2, ## → h3, ### → h4
      html.push(`<h${level}>${inline(h[2], links)}</h${level}>`)
    } else if (b) {
      flushPara()
      list.push(b[1])
    } else if (line === '') {
      flushPara(); flushList()
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara(); flushList()
  return html.join('\n')
}

function gnewsLinksIn(md: string): string[] {
  const urls = new Set<string>()
  for (const m of md.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const href = m[1].replace(/^<|>$/g, '').trim()
    if (isGnews(href)) urls.add(href)
  }
  return [...urls]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── Per-state build ──────────────────────────────────────────────────────────
async function buildState(abbr: string, name: string) {
  process.stdout.write(`${abbr} (${name})… `)
  const result = await runProgram(name, abbr, AFTER)
  if (result.status !== 'completed') {
    console.log(`SKIP — status=${result.status} error=${JSON.stringify(result.error)}`)
    return null
  }

  // Public prose: a short TL;DR plus the full statewide narrative, each in EN
  // and ES (the program emits both languages in one run). focal_agencies_md was
  // retired upstream when the TL;DR was split into its own artifact.
  const prose = {
    en: {
      tldr: (artifact(result, 'statewide_tldr')?.data as string) ?? '',
      summary: (artifact(result, 'statewide_summary')?.data as string) ?? '',
    },
    es: {
      tldr: (artifact(result, 'statewide_tldr_es')?.data as string) ?? '',
      summary: (artifact(result, 'statewide_summary_es')?.data as string) ?? '',
    },
  }
  const allMd = [prose.en.tldr, prose.en.summary, prose.es.tldr, prose.es.summary]

  // Resolve every gnews link across all four prose fields. The source links are
  // language-independent, so resolve the union once and apply the map to each.
  const toResolve = [...new Set(allMd.flatMap(gnewsLinksIn))].filter((u) => !gnewsCache[u])
  for (const url of toResolve) {
    await resolveGnews(url)
    await sleep(RESOLVE_DELAY_MS)
  }
  const links: Record<string, string> = {}
  for (const url of allMd.flatMap(gnewsLinksIn)) links[url] = gnewsCache[url] ?? url

  const out = {
    abbr,
    state: name,
    after: AFTER,
    generated_at: new Date().toISOString(),
    en: {
      tldr_html: mdToHtml(prose.en.tldr, links),
      summary_html: mdToHtml(prose.en.summary, links),
    },
    es: {
      tldr_html: mdToHtml(prose.es.tldr, links),
      summary_html: mdToHtml(prose.es.summary, links),
    },
    // Internal — stored raw, not rendered.
    internal: {
      relevant_articles: artifact(result, 'relevant_articles')?.data ?? [],
      publications: artifact(result, 'publications')?.data ?? [],
      roster_grounding: artifact(result, 'roster_grounding')?.data ?? [],
      cost_ledger: artifact(result, 'cost_ledger')?.data ?? [],
    },
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(resolve(OUT_DIR, `${abbr}.json`), JSON.stringify(out, null, 2))
  console.log(`ok (${toResolve.length} new links resolved)`)
  return { abbr, state: name, generated_at: out.generated_at }
}

// ── Main ─────────────────────────────────────────────────────────────────────
function statesToBuild(): Array<{ abbr: string; name: string }> {
  const cliStates = process.argv.slice(2).map((s) => s.toUpperCase())
  let abbrs: string[]
  if (cliStates.length) {
    abbrs = cliStates
  } else {
    const agencies = JSON.parse(readFileSync(AGENCY_INDEX, 'utf8')) as Array<{ state: string }>
    abbrs = [...new Set(agencies.map((a) => a.state))].sort()
  }
  return abbrs
    .filter((a) => STATE_NAMES[a])
    .map((a) => ({ abbr: a, name: STATE_NAMES[a] }))
}

const states = statesToBuild()
console.log(`Building news summaries for ${states.length} states (after=${AFTER})\n`)
const manifest: Array<{ abbr: string; state: string; generated_at: string }> = []
for (const { abbr, name } of states) {
  const entry = await buildState(abbr, name)
  if (entry) manifest.push(entry)
}
writeFileSync(GNEWS_CACHE, JSON.stringify(gnewsCache, null, 2))
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(
  resolve(OUT_DIR, 'index.json'),
  JSON.stringify({ generated_at: new Date().toISOString(), states: manifest }, null, 2),
)
console.log(`\nWrote ${manifest.length} states → ${OUT_DIR}`)

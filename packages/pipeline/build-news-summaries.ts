#!/usr/bin/env tsx
/**
 * Build per-state 287(g) news summaries.
 *
 * Calls the PromptQL saved program `news_bilingual_brief` once per state. That
 * program is fed by a DDN of pre-gathered, relevance-screened articles, so unlike
 * the retired `news_287g_state_summary` it (a) is much cheaper and (b) returns
 * DIRECT publisher URLs — no Google-News redirect decoding needed, which is why
 * the whole gnews batchexecute machinery is gone.
 *
 * This script still does the two things the program deliberately leaves to us:
 *
 *   1. Fills the roster placeholders. The prose is cached and regenerated rarely,
 *      so the volatile roster numbers are emitted as `{{agency_count}}`,
 *      `{{agreement_count}}`, `{{abs_rank}}` tokens and substituted here from the
 *      program's own run_meta grounding. See fillPlaceholders — a leftover token
 *      is a hard error (fail loud rather than ship `{{…}}` to readers).
 *   2. Renders the markdown prose to controlled HTML for {@html} on the SvelteKit
 *      side. See mdToHtml.
 *
 * Output shape is unchanged from the old program (so the web app needs no edits):
 * `statewide_*` → en/es {tldr_html, summary_html}; `candidate_articles` is mapped
 * into `internal.relevant_articles` under the columns the state page already reads
 * (Title/Link/Publication/Date/Relevant/…). `legislation` is dropped by this
 * program → emitted as null (the badge is flag-gated; keep/retire is TBD).
 *
 * Transition: the DDN is still being populated state by state. A state the DDN
 * doesn't cover yet returns thin/mismatched — we CARRY FORWARD its existing file
 * rather than overwrite it, and never write one state's prose into another's file
 * (the primary_state guard). BRIEF_STATES pins which states even attempt the brief
 * (comma abbrs, or `all` — the default) so a half-populated DDN isn't probed for
 * states known to be missing.
 *
 * Output: packages/web/static/data/dist/news/<abbr>.json (+ news/index.json)
 *
 * Env: PQL_NEWS_URL, PQL_NEWS_TOKEN (process.env or repo-root .env).
 *      BRIEF_STATES   covered-state allowlist (comma abbrs, or `all`; default all)
 *      PQL_CONCURRENCY prefetch pool width (default 6)
 *      BRIEF_TIMEOUT_MS per-call abort (default 300000)
 * Run: pnpm news            # every state
 *      pnpm news OH PA      # just these states
 *      pnpm news ID --force # bypass the local raw cache; re-fetch from the program
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STATE_NAMES } from './states.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const DIST_DIR = resolve(__dirname, '../web/static/data/dist')
const OUT_DIR = resolve(DIST_DIR, 'news')
const RAW_DIR = resolve(__dirname, 'data/news_brief_raw') // cached program responses (gitignored)

// `--force` (or FORCE=1) bypasses the local raw-response cache so the run re-hits
// the program (which still serves its own server-side cache) instead of replaying
// a local payload.
const FORCE = process.argv.includes('--force') || process.env.FORCE === '1'
const BRIEF_TIMEOUT_MS = Number(process.env.BRIEF_TIMEOUT_MS) || 300_000
const PQL_CONCURRENCY = Number(process.env.PQL_CONCURRENCY) || 6

// Which states attempt the brief. Default `all`; during DDN population set e.g.
// BRIEF_STATES=AK,AL,…,ND to route only covered states at the program and let the
// rest carry forward untouched (no wasted cold composes on empty pools).
const BRIEF_STATES_RAW = (process.env.BRIEF_STATES || 'all').trim()
const BRIEF_ALL = BRIEF_STATES_RAW === '' || BRIEF_STATES_RAW.toLowerCase() === 'all'
const BRIEF_SET = new Set(
  BRIEF_ALL ? [] : BRIEF_STATES_RAW.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
)
const briefEligible = (abbr: string) => BRIEF_ALL || BRIEF_SET.has(abbr)

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

// The program reads exactly ONE multipart input — a table artifact named `trigger`
// (single row `{states: <ABBR>}`). Execute Program only injects parts listed in
// manifest.inputs, and both parts must be typed application/json; sending the old
// `params`/`{state,state_abbr}` envelope is silently dropped → the program falls
// back to its default state (MO). We build the body by hand to match that contract
// exactly (typed field parts, no filename).
const BOUNDARY = '----287gBriefBoundaryXo9Kd2Lm'
function multipart(parts: Array<{ name: string; value: string }>): string {
  return (
    parts
      .map(
        (p) =>
          `--${BOUNDARY}\r\n` +
          `Content-Disposition: form-data; name="${p.name}"\r\n` +
          `Content-Type: application/json\r\n\r\n` +
          `${p.value}\r\n`,
      )
      .join('') + `--${BOUNDARY}--\r\n`
  )
}

async function runBrief(abbr: string): Promise<ProgramResult> {
  const cachePath = resolve(RAW_DIR, `${abbr}.json`)
  if (!FORCE && existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf8')) as ProgramResult
  }
  const body = multipart([
    {
      name: 'manifest',
      value: JSON.stringify({
        inputs: [{ name: 'trigger', title: 'trigger', artifact_type: 'table' }],
        entrypoint: 'default.run.json',
      }),
    },
    { name: 'trigger', value: JSON.stringify([{ states: abbr }]) },
  ])
  const res = await fetch(PQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `pat ${PQL_TOKEN}`,
      'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
    },
    body,
    signal: AbortSignal.timeout(BRIEF_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`brief ${abbr}: HTTP ${res.status} ${await res.text()}`)
  const result = (await res.json()) as ProgramResult
  // Cache ONLY a completed run. A failed program comes back HTTP 200 with
  // status:"errored" in the body, so caching unconditionally would latch a
  // transient error in and replay it forever (the #238 lesson). A state with no
  // cache file is simply retried.
  if (result.status === 'completed') {
    mkdirSync(RAW_DIR, { recursive: true })
    writeFileSync(cachePath, JSON.stringify(result))
  }
  return result
}

function artifact(result: ProgramResult, name: string): Artifact | undefined {
  return result.artifacts.find((a) => a.name === name)
}
const artStr = (result: ProgramResult, name: string): string => {
  const d = artifact(result, name)?.data
  return typeof d === 'string' ? d : ''
}
// First (only) row of a single-row table artifact, or undefined.
function firstRow(result: ProgramResult, name: string): Record<string, unknown> | undefined {
  const data = artifact(result, name)?.data
  return Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

// ── Live-roster counts for the roster tokens ─────────────────────────────────
// {{agency_count}} / {{agreement_count}} / {{abs_rank}} are filled from OUR
// published roster (agency_index.json), counted the SAME way the state page's own
// card counts — so the blurb can never contradict the card above it. Rules:
//   • agency_count    = active agencies in the state (the `agencies.length`
//                       headline rule — NOT ORI-deduped; see homeData #92/#118)
//   • agreement_count = sum of each active agency's current models (the active
//                       agency–model basis the trend uses, #162 → "distinct agreements")
//   • abs_rank        = the state's rank by agency_count across the country
type RosterCounts = { agency_count: number; agreement_count: number; abs_rank: number }
let ROSTER_CACHE: Map<string, RosterCounts> | null = null
function loadRoster(): Map<string, RosterCounts> {
  if (ROSTER_CACHE) return ROSTER_CACHE
  const map = new Map<string, RosterCounts>()
  try {
    const raw = JSON.parse(readFileSync(resolve(DIST_DIR, 'agency_index.json'), 'utf8'))
    const agencies: Array<Record<string, unknown>> = Array.isArray(raw)
      ? raw
      : ((raw.agencies as Array<Record<string, unknown>>) ?? [])
    const agencyCount = new Map<string, number>()
    const agreementCount = new Map<string, number>()
    for (const a of agencies) {
      if (a?.terminated_date) continue // active-only, matching the headline rule
      const st = String(a?.state ?? '').toUpperCase()
      if (!st) continue
      agencyCount.set(st, (agencyCount.get(st) ?? 0) + 1)
      const models = Array.isArray(a?.models) ? a.models.length : 0
      agreementCount.set(st, (agreementCount.get(st) ?? 0) + models)
    }
    for (const [st, count] of agencyCount) {
      // Competition rank: 1 + the number of states strictly ahead by agency_count.
      let ahead = 0
      for (const other of agencyCount.values()) if (other > count) ahead++
      map.set(st, { agency_count: count, agreement_count: agreementCount.get(st) ?? 0, abs_rank: ahead + 1 })
    }
  } catch (e) {
    console.warn(`roster load failed (${(e as Error).message}); falling back to run_meta numbers`)
  }
  ROSTER_CACHE = map
  return map
}

// ── Roster placeholder substitution ──────────────────────────────────────────
// The prose is cached and regenerated rarely, so the roster numbers ride as
// {{tokens}} and are filled here from the live roster above (loadRoster). We used
// to fill from the program's own run_meta grounding, but that is a lagged DDN
// snapshot that can disagree with our live card — e.g. MO read 102 agencies / 3rd
// there vs our card's 105 / 4th — so run_meta now only backfills states the roster
// doesn't cover. English is templated today; the Spanish prose currently carries
// no tokens (it hedges "decenas de agencias"), so a fill there is a harmless no-op
// until the program templates ES too.
const enOrdinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}
type Fills = { agency_count: unknown; agreement_count: unknown; abs_rank: unknown }
function fillPlaceholders(md: string, f: Fills, locale: 'en' | 'es'): string {
  const num = (v: unknown): string | null => {
    const n = Number(v)
    return Number.isFinite(n) ? n.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US') : null
  }
  const rank = (v: unknown): string | null => {
    const n = Number(v)
    if (!Number.isFinite(n)) return null
    return locale === 'es' ? `${n.toLocaleString('es-ES')}.º` : enOrdinal(n)
  }
  // Only substitute when we actually have a value; a missing one leaves the token
  // in place so assertFilled below catches it loudly instead of writing "NaN".
  const sub = (s: string, token: string, val: string | null) =>
    val == null ? s : s.replace(new RegExp(`\\{\\{\\s*${token}\\s*\\}\\}`, 'g'), val)
  let out = md
  out = sub(out, 'agency_count', num(f.agency_count))
  out = sub(out, 'agreement_count', num(f.agreement_count))
  out = sub(out, 'abs_rank', rank(f.abs_rank))
  return out
}
// A raw `{{…}}` reaching the site is a visible defect — throw so the state fails
// loud (and carries forward its last good copy) rather than shipping the token.
function assertFilled(label: string, s: string): void {
  const left = [...new Set([...s.matchAll(/\{\{[^}]+\}\}/g)].map((m) => m[0]))]
  if (left.length) throw new Error(`unfilled placeholders in ${label}: ${left.join(' ')}`)
}

// ── candidate_articles → the state page's article-table shape ─────────────────
// The state page reads `internal.relevant_articles` with the old program's
// capitalized columns and filters Relevant === "yes". Map the DDN's screened pool
// (already relevant, direct URLs) into that shape so nothing on the site changes.
// The DDN carries no per-article agency/county tags, so those stay blank (no chips).
type RawArticle = Record<string, unknown>

// DDN titles often trail site chrome: "Headline | Section | Publisher" or
// "Headline - Publisher". Strip it conservatively — headlines rarely contain these
// separators as content, but some do ("…facility — and other projects — on hold"),
// so a dash suffix is only removed when it LOOKS like a source (matches the
// publisher, ends in a TLD, or is a short Capitalized name), and a pipe is only
// treated as chrome when the first segment is long enough to be the headline.
function cleanArticleTitle(title: string, publisher: string): string {
  let t = title.replace(/\s+/g, ' ').trim()
  const pipe = t.indexOf(' | ')
  if (pipe > 0) {
    const head = t.slice(0, pipe).trim()
    if (head.split(/\s+/).length >= 4) t = head
  }
  const m = t.match(/^(.*\S)\s+[-–—]\s+([^-–—]{1,50})$/)
  if (m) {
    const tail = m[2].trim()
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const sourceLike =
      norm(tail) === norm(publisher) ||
      /\.(com|org|net|news)$/i.test(tail) ||
      (/^[\p{Lu}\p{N}]/u.test(tail) && tail.split(/\s+/).length <= 6)
    if (sourceLike) t = m[1].trim()
  }
  return t
}

function mapCandidateArticles(rows: unknown): RawArticle[] {
  if (!Array.isArray(rows)) return []
  return rows.map((r: Record<string, unknown>) => ({
    Title: cleanArticleTitle(str(r.title), str(r.publisher)),
    Link: str(r.url),
    Publication: str(r.publisher),
    Date: str(r.published_at),
    Relevant: 'yes',
    Agencies: '',
    Counties: '',
    Lang: str(r.language),
  }))
}

// ── Markdown → controlled HTML ───────────────────────────────────────────────
// The program emits a narrow markdown subset: # / ## / ### headers, **bold**,
// _italic_, `- ` bullets, [text](url) links. Links are direct publisher URLs, so
// mdToHtml is called with an empty link map and every href passes through as-is.
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(text: string, links: Record<string, string>): string {
  // Links first (their text may itself contain ** / _), pulling href from the
  // link map; non-http hrefs degrade to plain text. The label allows one level of
  // nested [...] — editorial insertions inside a quoted link text
  // ("just want[s] to lend a hand.") are common, and a plain [^\]]+ would stop at
  // that inner ] and fail to parse the link.
  let out = text.replace(/\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*(<[^>]*>|[^)]*)\s*\)/g, (_m, label: string, href: string) => {
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

// ── Per-state build ──────────────────────────────────────────────────────────
type IndexEntry = { abbr: string; state: string; generated_at: string; built_at: string }
// A brief attempt lands in one of four buckets. Only `error` is a real failure;
// `skip` (DDN hasn't reached this state) and `mismatch` (program returned another
// state) carry forward the existing file. `mismatch` is tallied separately because
// it EN MASSE is the trigger-regression signature (every state → MO).
type BriefOutcome =
  | { kind: 'built'; entry: IndexEntry }
  | { kind: 'skip'; reason: string }
  | { kind: 'mismatch'; got: string }
  | { kind: 'error'; error: string }

async function buildStateBrief(abbr: string, name: string): Promise<BriefOutcome> {
  let result: ProgramResult
  try {
    result = await runBrief(abbr)
  } catch (e) {
    return { kind: 'error', error: (e as Error).message }
  }
  if (result.status !== 'completed') {
    return { kind: 'error', error: `program status=${result.status} error=${JSON.stringify(result.error)}` }
  }

  const runMeta = firstRow(result, 'run_meta') ?? {}
  const got = String(runMeta.primary_state ?? runMeta.states ?? '').toUpperCase()
  const pool = Number(runMeta.pool_size ?? runMeta.candidate_article_count ?? 0)
  const summaryEn = artStr(result, 'statewide_summary')

  // Never write one state's prose into another's file. A different primary_state
  // means the requested state didn't take (the class of bug where an unthreaded
  // param fell back to MO) — carry forward, and let the run-level tally decide if
  // it's a broad regression (red) or just an uncovered pocket (benign).
  if (got && got !== abbr) return { kind: 'mismatch', got }
  if (!summaryEn.trim() || pool <= 0) return { kind: 'skip', reason: 'no DDN coverage yet' }

  try {
    // Fill from our live roster so the blurb agrees with the state page card;
    // run_meta only backfills a state the roster doesn't cover (e.g. a territory
    // with no agencies). See loadRoster.
    const roster = loadRoster().get(abbr)
    const fills: Fills = {
      agency_count: roster?.agency_count ?? runMeta.agency_count,
      agreement_count: roster?.agreement_count ?? runMeta.agreement_count,
      abs_rank: roster?.abs_rank ?? runMeta.abs_rank,
    }
    const render = (name_: string, artName: string, locale: 'en' | 'es') => {
      const filled = fillPlaceholders(artStr(result, artName), fills, locale)
      assertFilled(`${abbr} ${name_}`, filled)
      return mdToHtml(filled, {})
    }
    const builtAt = str(runMeta.cache_generated_at ?? runMeta.served_at) || new Date().toISOString()

    const out = {
      abbr,
      state: name,
      after: str(runMeta.after_date),
      generated_at: new Date().toISOString(),
      built_at: builtAt,
      // news_bilingual_brief drops the legislation stance artifact; the badge is
      // flag-gated, so null is safe. Keep/retire the field is still an open call.
      legislation: null,
      en: {
        tldr_html: render('en.tldr', 'statewide_tldr', 'en'),
        summary_html: render('en.summary', 'statewide_summary', 'en'),
      },
      es: {
        tldr_html: render('es.tldr', 'statewide_tldr_es', 'es'),
        summary_html: render('es.summary', 'statewide_summary_es', 'es'),
      },
      internal: {
        // Mapped into the state page's existing article-table shape.
        relevant_articles: mapCandidateArticles(artifact(result, 'candidate_articles')?.data),
        run_meta: runMeta,
        editorial_spine: artifact(result, 'editorial_spine')?.data ?? null,
        source: 'news_bilingual_brief',
      },
    }
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(resolve(OUT_DIR, `${abbr}.json`), JSON.stringify(out, null, 2))
    return { kind: 'built', entry: { abbr, state: name, generated_at: out.generated_at, built_at: builtAt } }
  } catch (e) {
    return { kind: 'error', error: (e as Error).message }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
// A TARGETED run names its states (`pnpm news OH PA`) — in CI that's the daily
// refresh of states whose data just moved (#233). A bare run sweeps them all.
const CLI_STATES = process.argv
  .slice(2)
  .filter((s) => !s.startsWith('--'))
  .map((s) => s.toUpperCase())
const TARGETED = CLI_STATES.length > 0

function statesToBuild(): Array<{ abbr: string; name: string }> {
  const abbrs = TARGETED ? CLI_STATES : Object.keys(STATE_NAMES).sort()
  return abbrs.filter((a) => STATE_NAMES[a]).map((a) => ({ abbr: a, name: STATE_NAMES[a] }))
}

// ── Prefetch ─────────────────────────────────────────────────────────────────
// CI's raw cache is gitignored → always cold. A cache HIT returns in ~6–9s, but
// the serial build loop below would still be slow across 50+ states, so warm the
// raw-response cache with a bounded pool first; the serial pass then reads it back
// instantly. Only brief-eligible states are warmed. Skipped under --force.
async function prefetchBriefs(list: Array<{ abbr: string; name: string }>) {
  const eligible = list.filter((s) => briefEligible(s.abbr))
  let next = 0
  const worker = async () => {
    while (next < eligible.length) {
      const { abbr } = eligible[next++]
      try {
        await runBrief(abbr)
      } catch (e) {
        console.log(`  prefetch ${abbr} failed (${(e as Error).message})`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PQL_CONCURRENCY, eligible.length) }, worker))
  const landed = eligible.filter((s) => existsSync(resolve(RAW_DIR, `${s.abbr}.json`))).length
  console.log(`  prefetched ${landed}/${eligible.length} brief responses\n`)
}

type IndexRow = { abbr: string; state: string; generated_at: string; built_at: string }

// The index is DERIVED from the state files actually on disk, not accumulated from
// this run — so a state that carried forward (skip/mismatch) stays listed, and the
// index can't shrink. Every state file carries these four fields. See #234.
function indexFromDisk(): IndexRow[] {
  const entries: IndexRow[] = []
  for (const file of readdirSync(OUT_DIR)) {
    if (!file.endsWith('.json') || file === 'index.json') continue
    try {
      const d = JSON.parse(readFileSync(resolve(OUT_DIR, file), 'utf8'))
      if (!d?.abbr) continue
      entries.push({ abbr: d.abbr, state: d.state, generated_at: d.generated_at, built_at: d.built_at })
    } catch {
      console.log(`  (news/${file} is unreadable — left out of the index)`)
    }
  }
  return entries.sort((a, b) => a.abbr.localeCompare(b.abbr))
}

const states = statesToBuild()
console.log(`Building news summaries for ${states.length} states (brief=${BRIEF_ALL ? 'all' : [...BRIEF_SET].join(',')})\n`)
if (!FORCE) await prefetchBriefs(states)

// One state's outcome never aborts the run. Only `error` is a real failure; `skip`
// and `mismatch` carry forward the previous file. See the redline below for when a
// partial build turns CI red.
const manifest: IndexEntry[] = []
const failures: Array<{ abbr: string; error: string }> = []
const skips: string[] = []
const mismatches: Array<{ abbr: string; got: string }> = []

for (const { abbr, name } of states) {
  process.stdout.write(`${abbr} (${name})… `)
  if (!briefEligible(abbr)) {
    console.log('not in BRIEF_STATES — carry forward')
    skips.push(abbr)
    continue
  }
  const o = await buildStateBrief(abbr, name)
  if (o.kind === 'built') {
    console.log(`ok (built_at ${o.entry.built_at})`)
    manifest.push(o.entry)
  } else if (o.kind === 'skip') {
    console.log('no DDN coverage yet — carry forward')
    skips.push(abbr)
  } else if (o.kind === 'mismatch') {
    console.log(`⚠ program returned ${o.got} — carry forward`)
    mismatches.push({ abbr, got: o.got })
  } else {
    console.log(`FAILED — ${o.error}`)
    failures.push({ abbr, error: o.error })
  }
}

mkdirSync(OUT_DIR, { recursive: true }) // before indexFromDisk: readdirSync needs it
const indexStates = indexFromDisk()
writeFileSync(
  resolve(OUT_DIR, 'index.json'),
  JSON.stringify({ generated_at: new Date().toISOString(), states: indexStates }, null, 2),
)

const carried = indexStates.length - manifest.length
console.log(
  `\nWrote ${manifest.length} fresh states → ${OUT_DIR}` +
    (carried > 0 ? ` (index lists ${indexStates.length}, ${carried} carried)` : ''),
)
if (skips.length) console.log(`  carried forward (no coverage yet): ${skips.join(' ')}`)
if (mismatches.length) console.log(`  ⚠ returned a different state: ${mismatches.map((m) => `${m.abbr}→${m.got}`).join(' ')}`)
if (failures.length) {
  console.log(`\n⚠  ${failures.length}/${states.length} states FAILED — kept their previous copy:`)
  for (const f of failures) console.log(`   ${f.abbr}: ${f.error}`)
}

// When does a partial build turn CI red? It NOTIFIES, never blocks — the site
// keeps its carried-forward summaries, and news-health is a separate job so a news
// outage can't cancel the data deploy.
//
//   • Real failures (covered state, errored/unfilled): a TARGETED run reddens on
//     any (every failure is a concrete defect); a full sweep reddens past half
//     (one flaky state is noise; a majority is an outage or dead token).
//   • Broad mismatch is the trigger-regression signature (unthreaded state → MO
//     for everyone). Red past half the eligible states — below that it's just the
//     uncovered tail of the DDN, which is expected during population.
//   • skip is always benign (carry-forward); it never reddens.
const eligibleCount = states.filter((s) => briefEligible(s.abbr)).length
const regression = eligibleCount > 0 && mismatches.length > eligibleCount / 2
const failRed = TARGETED ? failures.length > 0 : failures.length > states.length / 2
if (states.length > 0 && (regression || failRed)) {
  const scope = TARGETED ? 'targeted' : 'full'
  console.error(
    `\n✖ ${scope} news build FAILED — ${failures.length} error(s), ${mismatches.length} wrong-state` +
      (regression ? ' (looks like a state-threading regression)' : '') +
      ` — refusing to exit 0.`,
  )
  process.exit(1)
}

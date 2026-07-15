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
 * The summaries are public (statewide_tldr + statewide_summary, each in EN and
 * ES) and their links are resolved + rendered. The screened article table is
 * now surfaced too (state page, raw for now), so its Link column is resolved as
 * well: every gnews link across prose + table is gathered, de-duped, and
 * resolved in one bounded-concurrency pass (see resolveAll). Publications,
 * roster grounding and cost ledger stay raw/internal.
 *
 * Output: packages/web/static/data/dist/news/<abbr>.json (+ news/index.json)
 *
 * Env: PQL_NEWS_URL, PQL_NEWS_TOKEN (read from process.env or repo-root .env).
 *      RESOLVE_CONCURRENCY (default 6) and RESOLVE_DELAY_MS (default 150) tune
 *      the gnews link-resolution worker pool.
 * Run: pnpm news            # every state with agencies
 *      pnpm news OH PA      # just these states
 *      pnpm news ID --force # bypass both caches; re-gather from scratch
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STATE_NAMES } from './states.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const DIST_DIR = resolve(__dirname, '../web/static/data/dist')
const OUT_DIR = resolve(DIST_DIR, 'news')
const RAW_DIR = resolve(__dirname, 'data/news_raw') // cached program responses (gitignored)
const GNEWS_CACHE = resolve(__dirname, 'data/gnews_cache.json') // gnews URL → publisher URL

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const AFTER = process.env.AFTER || '2025-01-01'
// Link resolution runs as a small worker pool. Google tolerates a handful of
// parallel batchexecute calls from one residential/CI IP; the per-call delay
// keeps the aggregate rate civil. Conservative defaults because once Google
// IP-throttles us it withholds the resolve tokens for the rest of the run (and a
// while after) — see resolveAll's early-abort. All three are env-tunable; for a
// gentle retry after a throttle, e.g. RESOLVE_CONCURRENCY=2 RESOLVE_DELAY_MS=500.
const RESOLVE_CONCURRENCY = Number(process.env.RESOLVE_CONCURRENCY) || 4
const RESOLVE_DELAY_MS = Number(process.env.RESOLVE_DELAY_MS) || 250
// Consecutive token-absent (consent-wall) responses that mean "we're throttled,
// stop hammering" — abort resolution for the rest of the run rather than grind
// through thousands of doomed requests (which only prolongs the cooldown).
const RESOLVE_THROTTLE_ABORT = Number(process.env.RESOLVE_THROTTLE_ABORT) || 8
// `--force` (or FORCE=1) bypasses BOTH caches — the local raw-response file and
// the program's own server-side cache (passed through as force:true in the
// params row) — so the run re-gathers from scratch instead of replaying a
// cached payload.
const FORCE = process.argv.includes('--force') || process.env.FORCE === '1'

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
  if (!FORCE && existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf8')) as ProgramResult
  }
  const manifest = JSON.stringify({
    inputs: [{ name: 'params', title: 'State Summary Params', artifact_type: 'table' }],
    entrypoint: 'default.run.json',
    timezone: 'America/Bogota',
  })
  const params = JSON.stringify([
    { state: stateName, state_abbr: abbr, after, ...(FORCE ? { force: true } : {}) },
  ])
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
  // Cache ONLY a completed run. A failed program comes back as HTTP 200 with
  // status:"errored" in the BODY, so the check above never sees it — and caching
  // it anyway latched a transient upstream error in for the whole run: the
  // prefetch wrote the error, the build pass replayed it instead of re-calling,
  // and 29/53 states vanished from a green build (#238). Worse locally, where
  // the raw cache never expires: one bad reply overwrote a known-good gather and
  // replayed forever. A state with no cache file is simply retried.
  if (result.status === 'completed') {
    mkdirSync(RAW_DIR, { recursive: true })
    writeFileSync(cachePath, JSON.stringify(result))
  }
  return result
}

function artifact(result: ProgramResult, name: string): Artifact | undefined {
  return result.artifacts.find((a) => a.name === name)
}

// First (only) row of a single-row table artifact, or undefined.
function firstRow(result: ProgramResult, name: string): Record<string, unknown> | undefined {
  const data = artifact(result, name)?.data
  return Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined
}

// The program reports a statewide legislative posture toward 287(g). Its own
// vocabulary is `compels` / `prohibits` / `none`; we normalize to pro/anti/none:
//   pro  (compels)   — state policy/law mandates or forces local participation
//                      (e.g. FL's DeSantis/Uthmeier top-down mandate)
//   anti (prohibits) — state law limits or bars it (e.g. CA's SB 54 sanctuary)
//   none             — no enacted statewide direction; participation is local
// Also tolerate the pro/anti/con/mandate/bar family in case the label drifts;
// anything unrecognized falls to none.
type LegStance = 'pro' | 'anti' | 'none'
const PRO_WORDS = new Set(['pro', 'compels', 'compel', 'mandates', 'mandate', 'requires', 'require'])
const ANTI_WORDS = new Set(['anti', 'con', 'prohibits', 'prohibit', 'bars', 'bar', 'limits', 'limit', 'restricts', 'restrict'])
const normStance = (s: unknown): LegStance => {
  const v = String(s ?? '').toLowerCase().trim()
  if (PRO_WORDS.has(v)) return 'pro'
  if (ANTI_WORDS.has(v)) return 'anti'
  return 'none'
}

// ── Google News link resolution ──────────────────────────────────────────────
const gnewsCache: Record<string, string> = existsSync(GNEWS_CACHE)
  ? JSON.parse(readFileSync(GNEWS_CACHE, 'utf8'))
  : {}

const isGnews = (url: string) => /^https?:\/\/news\.google\.com\/(rss\/)?articles\//.test(url)

// Outcome of one resolution attempt. Two failure shapes, because a block can
// surface either way: 'throttled' = the token-bearing page was withheld
// (empty/consent wall); 'error' = the request threw (connection-level block or a
// one-off network/parse hiccup). resolveAll counts a streak of EITHER toward its
// abort. Both leave the link as its original gnews URL — still clickable, and
// uncached so a later run retries it.
type ResolveOutcome = 'resolved' | 'throttled' | 'error'

async function resolveGnews(url: string): Promise<ResolveOutcome> {
  if (gnewsCache[url]) return 'resolved'
  try {
    const id = new URL(url).pathname.split('/').pop() as string
    const page = await fetch(`https://news.google.com/rss/articles/${id}`, {
      headers: { 'User-Agent': UA },
    })
    const html = await page.text()
    const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1]
    const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1]
    const aid = html.match(/data-n-a-id="([^"]+)"/)?.[1]
    if (!sg || !ts || !aid) return 'throttled' // tokens withheld → IP-throttled / consent wall
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
    return 'resolved'
  } catch {
    return 'error' // one-off network/parse hiccup → keep the original gnews link
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
  // The label allows one level of nested [...] — editorial insertions inside a
  // quoted link text ("just want[s] to lend a hand.") are common in the prose,
  // and a plain [^\]]+ would stop at that inner ] and fail to parse the link.
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

function gnewsLinksIn(md: string): string[] {
  const urls = new Set<string>()
  for (const m of md.matchAll(/\[(?:[^[\]]|\[[^\]]*\])*\]\(([^)]+)\)/g)) {
    const href = m[1].replace(/^<|>$/g, '').trim()
    if (isGnews(href)) urls.add(href)
  }
  return [...urls]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Once Google IP-throttles us, EVERY further resolve fails for the rest of the
// run (and a while after) — so the first state that trips the limit flips this,
// and later states skip resolution entirely (links stay gnews, retryable) rather
// than grind through thousands of doomed requests. Cleared per process start.
let resolutionThrottled = false

// Resolve a batch of gnews URLs through a bounded worker pool. The input is
// already de-duped and uncached, and workers pull distinct indices, so no URL is
// resolved twice. Stops early (and latches resolutionThrottled) once we see
// RESOLVE_THROTTLE_ABORT consecutive consent-wall responses. Returns how many
// actually resolved and whether we bailed out throttled.
async function resolveAll(urls: string[]): Promise<{ resolved: number; throttled: boolean }> {
  if (resolutionThrottled) return { resolved: 0, throttled: true }
  let next = 0
  let resolved = 0
  let consecutive = 0 // shared across workers; a real throttle makes every outcome 'throttled'
  const worker = async () => {
    while (next < urls.length && !resolutionThrottled) {
      const outcome = await resolveGnews(urls[next++])
      // A run of consecutive failures of EITHER kind means we're blocked: an
      // empty consent wall surfaces as 'throttled', a connection-level block
      // surfaces as 'error'. Any success resets the streak, so a healthy run
      // (successes interleaved) never trips this.
      if (outcome === 'resolved') {
        resolved++
        consecutive = 0
      } else if (++consecutive >= RESOLVE_THROTTLE_ABORT) {
        resolutionThrottled = true
      }
      if (RESOLVE_DELAY_MS) await sleep(RESOLVE_DELAY_MS)
    }
  }
  await Promise.all(Array.from({ length: Math.min(RESOLVE_CONCURRENCY, urls.length) }, worker))
  return { resolved, throttled: resolutionThrottled }
}

// Persist the gnews cache eagerly (after each state) so a crash mid-run doesn't
// discard everything resolved so far — cheap insurance now that a cold run
// resolves thousands of links rather than a few dozen.
const persistGnewsCache = () => writeFileSync(GNEWS_CACHE, JSON.stringify(gnewsCache, null, 2))

// ── Per-state build ──────────────────────────────────────────────────────────
async function buildState(abbr: string, name: string) {
  process.stdout.write(`${abbr} (${name})… `)
  const result = await runProgram(name, abbr, AFTER)
  if (result.status !== 'completed') {
    // An errored program is a FAILURE, not a shrug. Returning null here dropped
    // the state without recording anything in failures[], so the end-of-run
    // warning never named it and the exit check — which only asks whether ANY
    // state built fresh — still called it a success. That is how a build that
    // lost 29 of 53 states shipped green (#238). Throw, and it rides the same
    // path every other failure already takes.
    throw new Error(`program status=${result.status} error=${JSON.stringify(result.error)}`)
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

  // Resolve ONLY the prose links — the citations rendered inside the public
  // summaries (few per state, high value). The screened-article table's links are
  // deliberately NOT bulk-resolved: ~150/state from one datacenter IP re-trips
  // Google's rate limit fast, and the table just lets readers click through (a
  // gnews redirect resolves itself in the browser). Table Links still pick up a
  // resolved URL for free below wherever an article was also cited in prose or is
  // already cached.
  const articleRows =
    (artifact(result, 'relevant_articles')?.data as Array<Record<string, unknown>>) ?? []
  const proseGnews = allMd.flatMap(gnewsLinksIn)
  const toResolve = [...new Set(proseGnews)].filter((u) => !gnewsCache[u])
  const resolveStats = await resolveAll(toResolve)
  persistGnewsCache()

  // Prose: a gnews→publisher map substituted into the rendered HTML by mdToHtml.
  const links: Record<string, string> = {}
  for (const url of proseGnews) links[url] = gnewsCache[url] ?? url
  // Table: rewrite each gnews Link in place to its resolved publisher URL
  // (unresolved ones stay the still-clickable gnews redirect).
  const relevantArticles = articleRows.map((r) =>
    typeof r.Link === 'string' && gnewsCache[r.Link] ? { ...r, Link: gnewsCache[r.Link] } : r,
  )

  // The real "last built" timestamp is the program's own run_meta.generated_at —
  // when the summary content was produced upstream — not our local pipeline clock
  // (that stays `generated_at`, below, as the file-write stamp). Falls back to the
  // write stamp if an older cached response predates the run_meta artifact.
  const runMeta = firstRow(result, 'run_meta')
  const builtAt =
    typeof runMeta?.generated_at === 'string' ? runMeta.generated_at : new Date().toISOString()

  // Statewide legislative posture (pro/anti/none) plus whether a bill is currently
  // live and the program's one-paragraph rationale. The description is English-only
  // upstream for now, so the site renders `stance` as a localized badge and holds
  // the prose here for a later bilingual pass. Null when the program omits it
  // (older cached responses).
  const legRow = firstRow(result, 'legislation')
  const legislation = legRow
    ? {
        stance: normStance(legRow.legislation_stance),
        active: String(legRow.legislation_active ?? '').toLowerCase() === 'yes',
        description:
          typeof legRow.legislation_description === 'string' ? legRow.legislation_description : '',
      }
    : null

  const out = {
    abbr,
    state: name,
    after: AFTER,
    generated_at: new Date().toISOString(),
    built_at: builtAt,
    legislation,
    en: {
      tldr_html: mdToHtml(prose.en.tldr, links),
      summary_html: mdToHtml(prose.en.summary, links),
    },
    es: {
      tldr_html: mdToHtml(prose.es.tldr, links),
      summary_html: mdToHtml(prose.es.summary, links),
    },
    // Internal — raw (article Link resolved above), not styled yet.
    internal: {
      relevant_articles: relevantArticles,
      publications: artifact(result, 'publications')?.data ?? [],
      roster_grounding: artifact(result, 'roster_grounding')?.data ?? [],
      cost_ledger: artifact(result, 'cost_ledger')?.data ?? [],
      run_meta: runMeta ?? null,
    },
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(resolve(OUT_DIR, `${abbr}.json`), JSON.stringify(out, null, 2))
  const left = toResolve.length - resolveStats.resolved
  console.log(
    resolveStats.throttled
      ? `THROTTLED — resolved ${resolveStats.resolved}/${toResolve.length}, ${left} left as gnews (retry after cooldown)`
      : `ok (${resolveStats.resolved}/${toResolve.length} links resolved)`,
  )
  // built_at rides along in the index so CI's change gate can compare content
  // stamps across builds — generated_at is a fresh write-clock every run.
  return { abbr, state: name, generated_at: out.generated_at, built_at: builtAt }
}

// ── Main ─────────────────────────────────────────────────────────────────────
// A TARGETED run names its states (`pnpm news OH PA`) — in CI that's the daily
// refresh of the states whose data just moved (#233). A bare run sweeps them all.
// The distinction decides how loud a partial failure is; see the exit check.
const CLI_STATES = process.argv
  .slice(2)
  .filter((s) => !s.startsWith('--'))
  .map((s) => s.toUpperCase())
const TARGETED = CLI_STATES.length > 0

function statesToBuild(): Array<{ abbr: string; name: string }> {
  let abbrs: string[]
  if (TARGETED) {
    abbrs = CLI_STATES
  } else {
    // Every state the pipeline knows (all 50 + DC + GU/MP), NOT just the agency
    // roster — non-participating states get a summary too. For them the absence
    // IS the story (e.g. CA: "no agencies, state law bars joining, but sheriffs
    // and cities keep testing the line"). The program handles a zero-roster state.
    abbrs = Object.keys(STATE_NAMES).sort()
  }
  return abbrs
    .filter((a) => STATE_NAMES[a])
    .map((a) => ({ abbr: a, name: STATE_NAMES[a] }))
}

// ── Prefetch ─────────────────────────────────────────────────────────────────
// On a cold run (CI: the raw cache is gitignored → always cold) the program
// calls dominate — ~2 min each even when the API replays its server-side cache,
// which serially is ~2 h for 53 states (it blew the CI job timeout). The build
// loop below stays serial for gnews-resolution civility, so instead warm the
// raw-response cache with a bounded worker pool first; the serial pass then
// reads it back instantly. Skipped under --force, where runProgram must hit the
// API per call anyway. A prefetch failure is only logged, never fatal here: a
// state that doesn't land gets one retry round below, and failing that, the
// serial build pass calls it again — that call's error handling is the
// authoritative one. (This comment used to promise the serial pass would retry
// come what may. It couldn't: an errored reply was cached, so the serial pass
// replayed it instead of re-calling. That was #238 — hence the retry round.)
const PQL_CONCURRENCY = Number(process.env.PQL_CONCURRENCY) || 6
// Rounds of prefetch: the first pass plus one retry for whatever didn't land.
const PREFETCH_ROUNDS = 2

async function prefetchPrograms(list: Array<{ abbr: string; name: string }>) {
  // Only a completed run leaves a cache file, so "didn't land" is just an absent
  // file — and a second round retries exactly those. Worth the round: on
  // 2026-07-15 an upstream blip errored the 29 states the pool reached FIRST
  // (AK→MS) and had cleared by the time it reached NC, so a retry would have
  // recovered every one of them; instead they were cached as errors and lost
  // (#238). Bounded at one extra round: if a full second pass still can't land a
  // state, that's not a blip, and the build pass's own call is the last word.
  let pending = list
  for (let round = 1; round <= PREFETCH_ROUNDS && pending.length; round++) {
    if (round > 1) {
      console.log(`  retrying ${pending.length} that didn't land: ${pending.map((s) => s.abbr).join(' ')}`)
    }
    const batch = pending
    let next = 0
    const worker = async () => {
      while (next < batch.length) {
        const { abbr, name } = batch[next++]
        try {
          await runProgram(name, abbr, AFTER)
        } catch (e) {
          console.log(`  prefetch ${abbr} failed (${(e as Error).message})`)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PQL_CONCURRENCY, batch.length) }, worker))
    pending = batch.filter(({ abbr }) => !existsSync(resolve(RAW_DIR, `${abbr}.json`)))
  }
  // Count what actually LANDED, not what we attempted. The old counter tallied
  // attempts, so it cheerfully printed "prefetched 53/53" on the run where 29 of
  // them had errored — a number that reads like success and means nothing (#238).
  const landed = list.length - pending.length
  console.log(
    `  prefetched ${landed}/${list.length} program responses` +
      (pending.length ? ` — ${pending.map((s) => s.abbr).join(' ')} still not cached (the build pass calls them)` : '') +
      '\n',
  )
}

type IndexEntry = { abbr: string; state: string; generated_at: string; built_at: string }

// The index is DERIVED from the state files actually on disk, not accumulated
// from this run's manifest. Whatever `<abbr>.json` is present gets listed —
// freshly built, seeded by CI's carry-forward, or left by an earlier local run —
// and every state file already carries these four fields, so nothing has to be
// remembered across runs. That makes the index self-healing and impossible to
// shrink: writing `manifest` alone is what let `pnpm news WY` cut the index down
// to one state, and would have dropped failed states off the site once per-state
// failures became survivable. It also never advertises a file that isn't there.
// See #234.
function indexFromDisk(): IndexEntry[] {
  const entries: IndexEntry[] = []
  for (const file of readdirSync(OUT_DIR)) {
    if (!file.endsWith('.json') || file === 'index.json') continue
    try {
      const d = JSON.parse(readFileSync(resolve(OUT_DIR, file), 'utf8'))
      if (!d?.abbr) continue
      entries.push({
        abbr: d.abbr,
        state: d.state,
        generated_at: d.generated_at,
        built_at: d.built_at,
      })
    } catch {
      console.log(`  (news/${file} is unreadable — left out of the index)`)
    }
  }
  return entries.sort((a, b) => a.abbr.localeCompare(b.abbr))
}

const states = statesToBuild()
console.log(`Building news summaries for ${states.length} states (after=${AFTER})\n`)
if (!FORCE) await prefetchPrograms(states)

// One state's failure is survivable: log it, leave it out of the fresh manifest,
// move on. runProgram throws on any non-OK HTTP response, and buildState now
// throws on an errored program too (#238) — so every way a state can fail lands
// in failures[] and nothing slips through unnamed. Without this a single
// transient state would abort the run and lose every other state's work, and a
// bad token (which fails ALL of them) would lose the entire build. See #234.
const manifest: IndexEntry[] = []
const failures: Array<{ abbr: string; error: string }> = []
for (const { abbr, name } of states) {
  try {
    manifest.push(await buildState(abbr, name))
  } catch (e) {
    // buildState already wrote the "AB (Name)… " prefix — finish its line.
    console.log(`FAILED — ${(e as Error).message}`)
    failures.push({ abbr, error: (e as Error).message })
  }
}
writeFileSync(GNEWS_CACHE, JSON.stringify(gnewsCache, null, 2))
mkdirSync(OUT_DIR, { recursive: true }) // before indexFromDisk: readdirSync needs it to exist
const indexStates = indexFromDisk()
writeFileSync(
  resolve(OUT_DIR, 'index.json'),
  JSON.stringify({ generated_at: new Date().toISOString(), states: indexStates }, null, 2),
)

const carriedCount = indexStates.length - manifest.length
console.log(
  `\nWrote ${manifest.length} fresh states → ${OUT_DIR}` +
    (carriedCount > 0 ? ` (index lists ${indexStates.length}, ${carriedCount} carried)` : ''),
)
if (failures.length) {
  console.log(`\n⚠  ${failures.length}/${states.length} states FAILED — kept their previous copy:`)
  for (const f of failures) console.log(`   ${f.abbr}: ${f.error}`)
}
if (resolutionThrottled) {
  console.log(
    '\n⚠  Google throttled link resolution partway through — later states kept raw gnews links.\n' +
      '   They are uncached, so re-run WITHOUT --force after a cooldown to retry only the failures,\n' +
      '   ideally gentler: RESOLVE_CONCURRENCY=2 RESOLVE_DELAY_MS=500 pnpm news <states…>',
  )
}

// When does a partial build turn CI red? Quietly reporting success is what let
// #234 sit green for a week, but "any failure at all" would cry wolf over a lone
// undici timeout that the next run fixes by itself. So the line follows what the
// failure MEANS:
//
//   • A TARGETED run (#233) only asks for states whose data just changed, so
//     every failure is a concrete defect: that state now serves new numbers
//     under its previous prose. Red at any count.
//   • A FULL sweep is a catch-all. One flaky state is noise — the carry-forward
//     covers it and next week's sweep retries it — but a majority failing is the
//     signature of an outage or a dead token, not bad luck. Red past half.
//   • Zero fresh is red either way (that was the only line before, and it's why
//     a 24/53 build shipped green — #238).
//
// Red NOTIFIES, it never blocks: the site keeps its carried-forward summaries,
// the change gate sees no diff, and news-health is a separate job precisely so a
// news outage can't cancel the data deploy or the social post.
const redline = TARGETED ? failures.length > 0 : failures.length > states.length / 2
if (states.length > 0 && (manifest.length === 0 || redline)) {
  const scope = TARGETED ? 'targeted' : 'full'
  console.error(
    `\n✖ ${scope} news build FAILED ${failures.length}/${states.length} states` +
      (manifest.length === 0 ? ' — NOTHING built fresh' : '') +
      ` — refusing to exit 0.`,
  )
  process.exit(1)
}

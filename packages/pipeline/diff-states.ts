#!/usr/bin/env tsx
/**
 * Which states' news-relevant data changed against the live site?
 *
 * The data pipeline (ingest.ts) runs twice daily; the news/language pipeline
 * (build-news-summaries.ts) is expensive and only runs in full on the weekly
 * Monday cron. So for up to a week a state's numbers can be ahead of the prose
 * that describes them. This bridges the two: the daily runner diffs the roster
 * it just ingested against what's published and refreshes news for ONLY the
 * states that moved. See #233.
 *
 * The live site — not the last run, not the git tree — is the baseline, same as
 * the workflow's change gate. It's the only record of what readers can actually
 * see, so a skipped or failed deploy leaves the state flagged until its language
 * really does ship.
 *
 * Run: pnpm -F pipeline diff:states --host=287g.recoveredfactory.net
 *      pnpm -F pipeline diff:states --host=… --out=/tmp/changed-states.txt
 *
 * Writes the changed abbrs to --out (space-separated, ready to hand to
 * `pnpm news <states…>`); an empty file means nothing to refresh. Exits non-zero
 * ONLY on a genuine fault (unreadable local data) — a missing baseline is a
 * normal first-deploy state and reports "nothing to refresh".
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STATE_NAMES } from './states.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = resolve(__dirname, '../web/static/data/dist')

const arg = (name: string): string | undefined =>
  process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')

const HOST = arg('host')
const OUT = arg('out')
if (!HOST) {
  console.error('Usage: diff:states --host=<live host> [--out=<path>]')
  process.exit(2)
}

// The roster files the summaries describe. Their union is one state's "data" for
// this purpose: agency_index holds the active agencies, terminated_agencies the
// ones that left (a departure is news too, and the two files are disjoint).
const ROSTER_FILES = ['agency_index.json', 'terminated_agencies.json'] as const

type Agency = {
  slug?: string
  state?: string
  models?: string[]
  signed_date?: string | null
  terminated_date?: string | null
}

/**
 * What the news LANGUAGE is about: which agencies are in the program, under
 * which models, since when, and which ones left.
 *
 * Deliberately a narrow projection rather than the whole record — that
 * narrowness is what makes a daily refresh affordable. `snapshot_date` alone
 * would defeat it: it carries the ICE release date and is identical across every
 * agency in the file, so it bumps for all ~1,800 of them on every release and
 * would flag all 53 states every time, turning each daily tick into the full
 * ~20-minute news build. The contact/signer and geo fields are just as fatal for
 * a subtler reason — they churn on their own (a re-scrape, a fixed extraction,
 * #225's null-out and self-heal) without changing one word a summary would say.
 *
 * The flip side is the honest one: add a field the prose DOES lean on and it
 * belongs here, or its changes will never trigger a refresh.
 */
const fingerprint = (a: Agency): string =>
  [
    a.slug ?? '',
    [...(a.models ?? [])].sort().join('+'),
    a.signed_date ?? '',
    a.terminated_date ?? '',
  ].join('|')

async function fetchJson(url: string): Promise<unknown | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url)
      if (res.status === 403 || res.status === 404) return null // not published yet
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      if (attempt === 3) {
        console.error(`  ✖ ${url} — ${(e as Error).message} after 3 attempts`)
        return null
      }
      await new Promise((r) => setTimeout(r, 500 * attempt))
    }
  }
  return null
}

// state → its agencies' fingerprints, sorted so the comparison is order-blind
// (ingest's output order is stable today, but a reorder is not a data change and
// shouldn't read as one).
function byState(rosters: Agency[][]): Map<string, string> {
  const acc = new Map<string, string[]>()
  for (const roster of rosters) {
    for (const a of roster) {
      if (!a?.state) continue
      const list = acc.get(a.state) ?? []
      list.push(fingerprint(a))
      acc.set(a.state, list)
    }
  }
  return new Map([...acc].map(([state, prints]) => [state, prints.sort().join('\n')]))
}

const asAgencies = (data: unknown, label: string): Agency[] => {
  if (!Array.isArray(data)) throw new Error(`${label} is not an array of agencies`)
  return data as Agency[]
}

// ── Local: what ingest just produced ─────────────────────────────────────────
const local = byState(
  ROSTER_FILES.map((f) =>
    asAgencies(JSON.parse(readFileSync(resolve(DIST_DIR, f), 'utf8')), `local ${f}`),
  ),
)

// ── Baseline: what the live site serves ──────────────────────────────────────
console.log(`Diffing ${ROSTER_FILES.join(' + ')} against https://${HOST}\n`)
const remoteFiles = await Promise.all(
  ROSTER_FILES.map((f) => fetchJson(`https://${HOST}/data/dist/${f}`)),
)

// The baseline is the roster files TOGETHER, so anything short of all of them is
// no baseline at all — not "everything changed". Treating a half-fetched
// baseline as real is the expensive mistake here: comparing a full local roster
// against a missing terminated_agencies.json makes every state that has ever
// lost an agency look changed, and one transient 500 from the CDN would buy a
// ~30-state news build on a daily tick — the exact cost this targeting exists to
// avoid. Absent (a first deploy, an outage, a file we haven't published yet) is
// not a change; the weekly full build is the catch-all for it.
if (remoteFiles.some((r) => r === null)) {
  const missing = ROSTER_FILES.filter((_, i) => remoteFiles[i] === null)
  console.log(
    `No published baseline for ${missing.join(', ')} on https://${HOST} ` +
      `(first deploy, or the site is down) — nothing to refresh.`,
  )
  if (OUT) writeFileSync(OUT, '')
  process.exit(0)
}

const remote = byState(
  remoteFiles.map((data, i) => asAgencies(data, `remote ${ROSTER_FILES[i]}`)),
)

// ── Diff ─────────────────────────────────────────────────────────────────────
const changed: string[] = []
for (const state of [...new Set([...local.keys(), ...remote.keys()])].sort()) {
  const before = remote.get(state) ?? ''
  const after = local.get(state) ?? ''
  if (before === after) continue
  changed.push(state)
  // Log the substance, not just the verdict: the next person reading a refresh
  // log should be able to see WHY a state was rebuilt without re-running this.
  const beforeSet = new Set(before ? before.split('\n') : [])
  const afterSet = new Set(after ? after.split('\n') : [])
  const slugsOf = (s: Set<string>) => new Set([...s].map((p) => p.split('|')[0]))
  const beforeSlugs = slugsOf(beforeSet)
  const afterSlugs = slugsOf(afterSet)
  const added = [...afterSlugs].filter((s) => !beforeSlugs.has(s))
  const removed = [...beforeSlugs].filter((s) => !afterSlugs.has(s))
  // In both rosters but with a different fingerprint → a model or date moved.
  const amended = [...afterSet].filter(
    (p) => !beforeSet.has(p) && beforeSlugs.has(p.split('|')[0]),
  ).length
  const parts = [
    added.length && `+${added.length}`,
    removed.length && `-${removed.length}`,
    amended && `~${amended}`,
  ].filter(Boolean)
  console.log(`  ${state}: ${parts.join(' ')}`)
  for (const s of added.slice(0, 5)) console.log(`      + ${s}`)
  for (const s of removed.slice(0, 5)) console.log(`      − ${s}`)
  const hidden = Math.max(added.length - 5, 0) + Math.max(removed.length - 5, 0)
  if (hidden) console.log(`      … and ${hidden} more`)
}

// The sync check the two pipelines need (#233): a state in the roster that the
// news pipeline doesn't know has no summary at all — not from a refresh here,
// not from the weekly build — and `pnpm news <abbr>` would silently drop it
// (statesToBuild filters by STATE_NAMES). Check the WHOLE roster rather than
// just what changed, so the gap surfaces the day the state appears instead of
// lying dormant until it happens to move.
const unknown = [...local.keys()].filter((s) => !STATE_NAMES[s]).sort()
if (unknown.length) {
  const plural = unknown.length > 1
  console.log(
    `\n⚠  ${unknown.join(', ')} ${plural ? 'have' : 'has'} agencies but ${plural ? 'are' : 'is'} ` +
      `not in states.ts — ${plural ? 'they get' : 'it gets'} no news summary at all. ` +
      `Add ${plural ? 'them' : 'it'} there.`,
  )
}

const refreshable = changed.filter((s) => STATE_NAMES[s])
console.log(
  changed.length
    ? `\n${changed.length} state${changed.length > 1 ? 's' : ''} changed; ` +
        `${refreshable.length} to refresh: ${refreshable.join(' ') || '(none)'}`
    : '\nNo state roster changed — news is already in sync with the data.',
)
if (OUT) writeFileSync(OUT, refreshable.join(' '))

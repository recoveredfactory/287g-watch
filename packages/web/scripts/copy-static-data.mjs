#!/usr/bin/env node
/**
 * Stage tracked data files into static/data/dist before `vite build`.
 *
 * Why this exists: packages/web/static/data is gitignored, so the only files
 * SvelteKit sees at build time are whatever the pipeline just generated. Data
 * the pipeline *can't* regenerate in CI has to be copied in from a tracked path
 * or it silently drops out of the build.
 *
 * That drop is not a graceful degradation. A file missing from static/ is
 * missing from `manifest.assets`, so a server `load` that fetches it takes
 * SvelteKit's non-asset path and recurses back into the app instead of reading
 * a file — which returns a 200 whose body is already consumed, and `.json()`
 * throws "Body is unusable". That was the intermittent 500 on every agency page
 * (#267). Keep this list in sync with any tracked-but-not-generated data file.
 *
 * legislation_stance.json is the generated flavor of the same problem: its
 * source YAML is tracked but nothing else in CI builds the JSON, so it is built
 * here and the build fails if it doesn't appear.
 */
import { copyFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(__dirname, '../static/data/dist')

const FILES = [
  ['../../pipeline/data/muckrock_snapshot.json', 'muckrock_requests.json'],
]

mkdirSync(DIST, { recursive: true })
for (const [from, to] of FILES) {
  const src = resolve(__dirname, from)
  if (!existsSync(src)) {
    console.error(`copy-static-data: missing tracked source ${src}`)
    process.exit(1)
  }
  copyFileSync(src, resolve(DIST, to))
  console.log(`copy-static-data: ${to}`)
}

execFileSync('pnpm', ['-F', 'pipeline', 'build:legislation'], { stdio: 'inherit' })
if (!existsSync(resolve(DIST, 'legislation_stance.json'))) {
  console.error('copy-static-data: legislation_stance.json was not produced')
  process.exit(1)
}
console.log('copy-static-data: legislation_stance.json')

// Written by ingest (pipeline/lib/downloads.ts); the /downloads page links to them.
for (const f of ['287g-agencies-latest.csv', '287g-agencies-data-dictionary.csv']) {
  if (!existsSync(resolve(DIST, 'downloads', f))) {
    console.error(`copy-static-data: downloads/${f} was not produced by the pipeline`)
    process.exit(1)
  }
}
console.log('copy-static-data: downloads/*.csv')

// Stamp the commit this bundle was built from, so the CI change gate can tell a
// code change from a data change. Without it the gate only hashes the data
// files, and a code-only fix — like the one that made this script necessary —
// hashes identical to what's live and never deploys.
//
// Deliberately NOT part of the gate's data-hash loop: it moves on every commit,
// so hashing it there would deploy on every tick.
const commit =
  process.env.GITHUB_SHA ??
  (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    } catch {
      return 'unknown'
    }
  })()

writeFileSync(resolve(DIST, 'build_meta.json'), JSON.stringify({ commit }, null, 2) + '\n')
console.log(`copy-static-data: build_meta.json (commit=${commit.slice(0, 8)})`)

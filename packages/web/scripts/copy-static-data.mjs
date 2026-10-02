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
 */
import { copyFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(__dirname, '../static/data/dist')

const FILES = [
  ['../../pipeline/data/muckrock_snapshot.json', 'muckrock_requests.json'],
  ['../../pipeline/data/detainer_stats.json', 'detainer_stats.json'],
  ['../../pipeline/data/arrest_stats.json', 'arrest_stats.json'],
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

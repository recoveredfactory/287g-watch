// Dev helper: pre-warm .cache/sheets/ from raw.githubusercontent (no GitHub API
// rate limit, no token), so a subsequent `pnpm ingest` runs token-free and fast.
// Picks the alphabetically-first xlsx per dir to mirror the contents-API order
// the pipeline's files.find() sees. Skips dirs already cached.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = resolve(__dirname, '.cache/sheets')
mkdirSync(CACHE_DIR, { recursive: true })

const tree = await (await fetch('https://api.github.com/repos/appelson/Tracking_287g/git/trees/main?recursive=1')).json()
const byDir = new Map()
for (const node of tree.tree) {
  const m = node.path.match(/^sheets\/(sheets_\d{8}_\d+)\/(.+\.xlsx)$/)
  if (!m) continue
  const arr = byDir.get(m[1]) ?? []
  arr.push(m[2])
  byDir.set(m[1], arr)
}
const dirs = [...byDir.keys()].sort()
console.log(`${dirs.length} snapshot dirs with xlsx`)

const raw = (p) => `https://raw.githubusercontent.com/appelson/Tracking_287g/main/${p.split('/').map(encodeURIComponent).join('/')}`
let fetched = 0, skipped = 0
for (let i = 0; i < dirs.length; i += 8) {
  await Promise.all(dirs.slice(i, i + 8).map(async (dir) => {
    const cachePath = resolve(CACHE_DIR, `${dir}.xlsx`)
    if (existsSync(cachePath)) { skipped++; return }
    const file = byDir.get(dir).sort()[0] // alphabetically-first, mirrors contents API
    const resp = await fetch(raw(`sheets/${dir}/${file}`))
    if (!resp.ok) { console.error(`  miss ${dir}: ${resp.status}`); return }
    writeFileSync(cachePath, Buffer.from(await resp.arrayBuffer()))
    fetched++
  }))
  process.stderr.write(`  ${Math.min(i + 8, dirs.length)}/${dirs.length}\r`)
}
console.log(`\nwarmed: ${fetched} fetched, ${skipped} already cached → ${CACHE_DIR}`)

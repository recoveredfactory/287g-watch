#!/usr/bin/env tsx
/**
 * Build slim FBI Law Enforcement Employees snapshot.
 *
 * Reads the full LEE Master File CSV (1960–latest) and writes a per-ORI
 * latest-record slice with just the columns the ingest pipeline needs.
 *
 * Source: https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/downloads — "LEE Data"
 *
 * Run:
 *   pnpm tsx build-lee-snapshot.ts /path/to/lee_1960_2025.csv
 *
 * Output: packages/pipeline/data/fbi_lee_latest.csv
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, 'data/fbi_lee_latest.csv')
const MIN_YEAR = 2018

const srcPath = process.argv[2]
if (!srcPath) {
  console.error('Usage: tsx build-lee-snapshot.ts <path-to-lee-master-csv>')
  process.exit(1)
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else if (c === '\r') { /* skip */ }
      else field += c
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

function csvCell(s: unknown): string {
  const v = String(s ?? '')
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

console.log(`Reading ${srcPath}...`)
const text = readFileSync(srcPath, 'utf8')
const arr = parseCSV(text)
const headers = arr[0]
const idx = Object.fromEntries(headers.map((h, i) => [h, i]))
console.log(`  ${arr.length - 1} source rows`)

const SLIM_COLS = [
  'ori', 'data_year', 'pub_agency_name', 'state_abbr', 'county_name',
  'agency_type_name', 'population', 'officer_ct', 'civilian_ct',
  'total_pe_ct', 'pe_ct_per_1000',
]

// Pick latest record per ORI, only year ≥ MIN_YEAR
const latest = new Map<string, string[]>()
for (let i = 1; i < arr.length; i++) {
  const r = arr[i]
  const ori = r[idx.ori]
  const year = Number(r[idx.data_year])
  if (!ori || !year || year < MIN_YEAR) continue
  const prev = latest.get(ori)
  if (!prev || Number(prev[idx.data_year]) < year) latest.set(ori, r)
}
console.log(`  ${latest.size} ORIs with data since ${MIN_YEAR}`)

const out = [SLIM_COLS.join(',')]
for (const r of latest.values())
  out.push(SLIM_COLS.map((c) => csvCell(r[idx[c]])).join(','))
writeFileSync(OUT, out.join('\n') + '\n')
console.log(`Wrote ${out.length - 1} rows → ${OUT}`)

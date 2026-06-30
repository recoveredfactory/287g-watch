#!/usr/bin/env tsx
/**
 * check-agreements.ts  (the "test empirically" piece)
 *
 * Divergence report + regression sentinel for the per-agreement model. Reads
 * data/moa_extracts.json and, for every agency holding more than one agreement,
 * flags where the public-affairs POC / ICE signer / field office DIFFER across
 * its agreements — the whole reason the per-agreement view exists (the old
 * single-pick view silently hid these). See docs/AGREEMENTS_PER_AGREEMENT_PLAN.md.
 *
 * Divergence is expected to be a minority (~5% of multi-PDF agencies differ on
 * the POC; signer / field office are usually stable). This script makes that
 * concrete and catches regressions where a reshape accidentally collapses
 * agreements back to one.
 *
 * Usage:
 *   pnpm -F pipeline check:agreements
 *   pnpm -F pipeline check:agreements -- --assert   # exit 1 if no divergence found
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTRACTS = resolve(__dirname, "data/moa_extracts.json");
const ASSERT = process.argv.slice(2).includes("--assert");

type Agreement = {
  model: string | null;
  ice_signer_name: string | null;
  ice_field_office: string | null;
  lea_poc_name: string | null;
  lea_poc_email: string | null;
  error?: string;
};
type Extract = { agreements?: Agreement[] };

if (!existsSync(EXTRACTS)) {
  console.error(`moa_extracts.json not found at ${EXTRACTS}`);
  console.error("Run: pnpm -F pipeline build:agreement-index && pnpm -F pipeline extract:moa-signers");
  process.exit(1);
}

const data = JSON.parse(readFileSync(EXTRACTS, "utf8")) as Record<string, Extract>;

// Normalize a POC name for identity comparison: strip leading rank/title, drop
// punctuation, lowercase. So "Sheriff Mark B. Harrell" === "Mark B. Harrell".
function normName(s: string | null): string | null {
  if (!s) return null;
  const stripped = s
    .replace(/^(?:Sheriff|Chief Deputy|Chief|Deputy|Major|Captain|Lt\.?|Lieutenant|Col\.?|Commander|Sgt\.?|Sergeant)\s+/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || null;
}

const distinct = (xs: (string | null)[]) =>
  [...new Set(xs.filter((x): x is string => !!x))];

type Row = {
  key: string;
  models: string;
  poc: string[];
  signer: string[];
  fieldOffice: string[];
};
const pocDiv: Row[] = [];
const signerDiv: Row[] = [];
const foDiv: Row[] = [];

let multiCount = 0;
for (const [key, ex] of Object.entries(data)) {
  const ags = (ex.agreements ?? []).filter((a) => !a.error);
  if (ags.length < 2) continue;
  multiCount++;

  const models = ags.map((a) => a.model ?? "?").join("/");
  // POC identity: prefer email (stable), else normalized name.
  const emails = distinct(ags.map((a) => a.lea_poc_email?.toLowerCase() ?? null));
  const names = distinct(ags.map((a) => normName(a.lea_poc_name)));
  const signers = distinct(ags.map((a) => normName(a.ice_signer_name)));
  const offices = distinct(ags.map((a) => a.ice_field_office?.toLowerCase().trim() ?? null));

  const row: Row = {
    key,
    models,
    poc: distinct(ags.map((a) => a.lea_poc_name)),
    signer: distinct(ags.map((a) => a.ice_signer_name)),
    fieldOffice: distinct(ags.map((a) => a.ice_field_office)),
  };

  if (emails.length > 1 || (emails.length === 0 && names.length > 1)) pocDiv.push(row);
  if (signers.length > 1) signerDiv.push(row);
  if (offices.length > 1) foDiv.push(row);
}

function report(title: string, rows: Row[], field: keyof Row) {
  console.log(`\n${title}: ${rows.length} / ${multiCount} multi-agreement agencies`);
  for (const r of rows) {
    console.log(`  ${r.key}  [${r.models}]`);
    for (const v of r[field] as string[]) console.log(`      • ${v}`);
  }
}

console.log(`Multi-agreement agencies (≥2 PDFs parsed): ${multiCount}`);
report("⚠ Public-affairs POC DIVERGES", pocDiv, "poc");
report("⚠ ICE signer DIVERGES", signerDiv, "signer");
report("⚠ ICE field office DIVERGES", foDiv, "fieldOffice");

const pct = (n: number) => (multiCount ? Math.round((100 * n) / multiCount) : 0);
console.log(
  `\nSummary: POC ${pocDiv.length} (${pct(pocDiv.length)}%) | ` +
    `signer ${signerDiv.length} (${pct(signerDiv.length)}%) | ` +
    `field office ${foDiv.length} (${pct(foDiv.length)}%) divergent.`,
);

// Regression sentinel: the per-agreement model only earns its complexity if it
// surfaces divergence the single-pick view hid. If --assert and we found none,
// something collapsed agreements back to one — fail loudly.
if (ASSERT && pocDiv.length === 0 && signerDiv.length === 0 && foDiv.length === 0) {
  console.error("\n✗ --assert: expected some divergence across multi-agreement agencies, found none.");
  process.exit(1);
}

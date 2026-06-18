#!/usr/bin/env tsx
/**
 * extract-moa-signers.ts
 *
 * Downloads one PDF per agency from the MOA archive and extracts structured
 * signer data using pdftotext (must be installed: `brew install poppler`).
 *
 * Extracted per MOA:
 *   - ice_signer_name    — name typed under the ICE signature (right column)
 *   - ice_signer_title   — "Deputy Director", "Field Office Director", etc.
 *   - ice_field_office   — e.g. "New Orleans" (from Section VII POC line)
 *   - lea_signer_title   — "Sheriff", "Chief of Police", etc. (left column)
 *   - date_signed        — as written in the document, e.g. "9/22/2025"
 *   - lea_poc_name       — Appendix C public-affairs contact
 *   - lea_poc_email
 *   - lea_poc_phone
 *   - model              — JEM / TFM / WSO (from PDF filename)
 *
 * Runs incrementally: already-processed agencies are skipped unless --force.
 *
 * Usage:
 *   pnpm -F pipeline extract:moa-signers
 *   pnpm -F pipeline extract:moa-signers -- --force          # reprocess all
 *   pnpm -F pipeline extract:moa-signers -- --limit 50       # first N agencies
 *
 * Env:
 *   GH_TOKEN   GitHub personal access token (raises rate limit 60→5000/hr)
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOA_INDEX_PATH = resolve(__dirname, "data/moa_index.json");
const OUT_PATH = resolve(__dirname, "data/moa_extracts.json");

const GH_TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const ghHeaders: Record<string, string> = {
  "User-Agent": "287g-explorer-pipeline",
  ...(GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {}),
};
if (!GH_TOKEN) {
  console.warn("⚠  No GH_TOKEN — unauthenticated API (60 req/hr). Set GH_TOKEN for faster runs.\n");
}

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const limitArg = args.indexOf("--limit");
const LIMIT = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : Infinity;

// ── Types ─────────────────────────────────────────────────────────────────────

type MoaExtract = {
  agency_key: string;          // "AL|autauga county sheriffs office"
  pdf_url: string;             // raw.githubusercontent.com URL used
  model: string | null;        // JEM | TFM | WSO | null
  ice_signer_name: string | null;
  ice_signer_title: string | null;
  ice_field_office: string | null;
  lea_signer_name: string | null;   // present in old template; usually null in new (image sig)
  lea_signer_title: string | null;
  date_signed: string | null;
  lea_poc_name: string | null;
  lea_poc_email: string | null;
  lea_poc_phone: string | null;
  extracted_at: string;
  error?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ghContents(apiPath: string): Promise<Array<{ name: string; download_url: string | null; type: string }>> {
  const url = `https://api.github.com/repos/appelson/Tracking_287g/contents/${apiPath}`;
  const r = await fetch(url, { headers: ghHeaders });
  if (!r.ok) throw new Error(`GitHub API ${r.status} for ${apiPath}`);
  return r.json() as Promise<any[]>;
}

// Convert a GitHub tree URL → API path
// "https://github.com/appelson/Tracking_287g/tree/main/agreements/SNAP/STATE/AGENCY"
// → "agreements/SNAP/STATE/AGENCY"
function treeUrlToApiPath(treeUrl: string): string {
  return treeUrl
    .replace("https://github.com/appelson/Tracking_287g/tree/main/", "")
    .replace(/%27/g, "'");
}

async function downloadPdf(url: string, dest: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
  const buf = await r.arrayBuffer();
  writeFileSync(dest, Buffer.from(buf));
}

function pdfToText(pdfPath: string): string {
  try {
    return execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
      encoding: "utf8",
      timeout: 30_000,
    });
  } catch {
    return "";
  }
}

// Pick the preferred PDF from a directory listing: JEM > TFM > WSO > first
const MODEL_PRIORITY = ["JEM", "TFM", "WSO"];
type GhFile = { name: string; download_url: string | null };

function pickPdf(files: GhFile[]): GhFile | null {
  const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
  for (const model of MODEL_PRIORITY) {
    const match = pdfs.find((f) => f.name.toUpperCase().includes(`_${model}_`));
    if (match) return match;
  }
  return pdfs[0] ?? null;
}

function detectModel(filename: string): string | null {
  const up = filename.toUpperCase();
  if (up.includes("_JEM_")) return "JEM";
  if (up.includes("_TFM_")) return "TFM";
  if (up.includes("_WSO_")) return "WSO";
  return null;
}

// ── Parsers ───────────────────────────────────────────────────────────────────
//
// Two template families are in the wild:
//
//   NEW (June 2025+): "For ICE:" in Sec VII, typed "Name: {name}" in right
//     column, numeric dates, ICE title "Deputy Director".
//
//   OLD (pre-June 2025): "ForDHS:" / "For DHS:" in Sec VII, ICE name appears
//     as a right-indented standalone line above a blank "Name:" field, spelled-
//     out or numeric dates, ICE title "Acting Director" or "Field Office Director".
//
// We try both patterns and return the first hit.

const ICE_TITLE_RE = /Title:\s*[-– \t]*(Acting\s*Director|Deputy\s*Director|Field\s*Office\s*Director)/i;
// Matches "First Last", "First M. Last", "First Middle Last" — at least two words,
// each starting uppercase. Does NOT require a third word after a middle initial.
const FULL_NAME_RE = /[A-Z][a-zA-Z'-]+(?: +[A-Z](?:\.[a-zA-Z'-]*|[a-zA-Z'-]+))+/;

// Section VII POC line — field office city.
// New: "For ICE: New Orleans Field Office Director"
// Old: "ForDHS: New Orleans Field Office Director"
function parseFieldOffice(text: string): string | null {
  const m = text.match(/For\s*(?:ICE|DHS):\s*([A-Za-z][A-Za-z ]+?)\s*Field\s*Office\s*Director/i);
  return m ? m[1].trim() : null;
}

// ICE signer name. Two layouts (see template note above).
function parseIceName(text: string): string | null {
  // Locate the ICE title (most reliable anchor) and work outward from it.
  const titleIdx = text.search(ICE_TITLE_RE);
  if (titleIdx < 0) return null;

  // Scan backwards ~600 chars for a right-column "Name:" label (≥30 leading
  // spaces) followed by a name on the same line — new template pattern:
  //   "                                          Name: Madison Sheahan"
  // Left-column "Name: Bill Franklin" (LEA signer) has ≤10 spaces and is
  // intentionally excluded by the indentation requirement.
  // Use a 1200-char window so the sig page isn't missed when there are many
  // blank lines or table-border dashes between Name: and Title: in the layout.
  const before = text.slice(Math.max(0, titleIdx - 1200), titleIdx);
  const m1 = before.match(/^ {30,}Name:\s*[-– \t]*([A-Z][a-zA-Z'-]+(?: +[A-Z](?:\.[a-zA-Z'-]*|[a-zA-Z'-]+))+)\s*$/m);
  if (m1) return m1[1].trim();

  // Old template: ICE name is a right-indented standalone line (≥30 leading spaces)
  // that appears between "Signature:" and the "Name:" blank and ICE title.
  //   "                                                   Todd M. Lyons"
  //   "                                         Name:"
  const lines = before.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const leading = lines[i].match(/^(\s+)/)?.[1]?.length ?? 0;
    if (leading < 30) continue;
    const trimmed = lines[i].trim();
    if (FULL_NAME_RE.test(trimmed) && /^[A-Z]/.test(trimmed) && trimmed.split(/\s+/).length >= 2) {
      return trimmed;
    }
  }

  return null;
}

// ICE signer title from right column.
function parseIceTitle(text: string): string | null {
  const m = text.match(ICE_TITLE_RE);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

// LEA signer name — left column "Name: {name}" (present in old template;
// in new template the LEA signature is usually an image and returns null).
function parseLeaName(text: string): string | null {
  // The LEA "Name:" comes before the first "Title: Sheriff/Chief…" in the
  // signature block. We search for the signature section only.
  const sigIdx = text.search(/For the LEA:\s*\n[\s\S]{0,50}For ICE:/m);
  const chunk = sigIdx >= 0 ? text.slice(sigIdx, sigIdx + 1200) : text;

  // Left-column "Name:" (≤40 leading spaces)
  for (const line of chunk.split("\n")) {
    const leading = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (leading > 40) continue; // right column
    const m = line.match(/Name:\s*([-– ]*)\s*([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)+)/);
    if (m) return m[2].trim();
  }
  return null;
}

// LEA signer title from left column.
function parseLeaTitle(text: string): string | null {
  const m = text.match(/Title:\s+(Sheriff|Chief of Police|Police Chief|Chief|Director|Superintendent|Commissioner|Captain)\b(?!\s+Director)/i);
  return m ? m[1].trim() : null;
}

// Date signed — right column of signature block.
// Formats: "9/22/2025", "02/10/2026", "2/10/26", "March 17, 2025"
function parseDateSigned(text: string): string | null {
  // The signature block contains "Signature:" labels (unique to that section).
  // Walk backwards from the last "Signature:" to find "For the LEA:" above it.
  const sigLabelIdx = text.lastIndexOf("Signature:");
  const sigBlockStart = sigLabelIdx >= 0
    ? text.lastIndexOf("For the LEA:", sigLabelIdx)
    : text.lastIndexOf("For the LEA:");
  const sigStart = sigBlockStart >= 0 ? sigBlockStart : -1;
  const chunk = sigStart >= 0 ? text.slice(sigStart, sigStart + 1000) : text;

  // Numeric preceded by "Date:" label: "9/22/2025"
  const m1 = chunk.match(/Date:\s*[-–~\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  if (m1) return m1[1];

  // Spelled-out preceded by "Date:" label: "March 17, 2025"
  const m2 = chunk.match(/Date:\s*[-–~\s]*([A-Z][a-z]+ \d{1,2},?\s*\d{2,4})/);
  if (m2) return m2[1].trim();

  // Standalone date on its own line (new template: date appears on left-column
  // line before the right-column "Date:" label line, e.g. "9/22/2025" alone).
  // Restrict to first 600 chars of sig block to avoid footer "Revised" dates.
  const m3 = chunk.slice(0, 600).match(/^\s*(\d{1,2}\/\d{1,2}\/(?:20\d{2}|\d{2}))\s*$/m);
  if (m3) return m3[1];

  return null;
}

// Appendix C: LEA POC block.
// New template: name, then address, then phone, then email (separate lines).
// Old template: "Chief Deputy Jeremy Amerson 334-567-5546 ext.3008" (all on one line).
function parseLeaPoc(text: string): { lea_poc_name: string | null; lea_poc_email: string | null; lea_poc_phone: string | null } {
  const idx = text.search(/APPENDIX\s*C/);
  if (idx < 0) return { lea_poc_name: null, lea_poc_email: null, lea_poc_phone: null };
  const chunk = text.slice(idx, idx + 1200);

  const leaIdx = chunk.search(/For the LEA:/i);
  if (leaIdx < 0) return { lea_poc_name: null, lea_poc_email: null, lea_poc_phone: null };

  const iceIdx = chunk.indexOf("For ICE:", leaIdx);
  const after = chunk.slice(leaIdx + "For the LEA:".length, iceIdx > 0 ? iceIdx : undefined);

  // Name: first Title-Case line that isn't purely numeric/address.
  // Handle "Chief Deputy Tom Allen" (separate line) and
  // "Chief Deputy Jeremy Amerson 334-567-5546" (phone appended).
  const nameLines = after
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && /^[A-Z][a-z]/.test(l) && !/^\d/.test(l) && l.length > 4);

  let name: string | null = null;
  let phone: string | null = null;

  if (nameLines[0]) {
    // Strip trailing phone "(334) 335-4850" or "334-567-5546 ext.3008"
    const phoneInLine = nameLines[0].match(/\s+\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}.*/);
    if (phoneInLine) {
      phone = phoneInLine[0].trim();
      name = nameLines[0].slice(0, phoneInLine.index).trim();
    } else {
      name = nameLines[0];
    }
  }

  const emailM = after.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/);
  if (!phone) {
    const phoneM = after.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/);
    if (phoneM) phone = phoneM[0];
  }

  return {
    lea_poc_name: name,
    lea_poc_email: emailM ? emailM[0] : null,
    lea_poc_phone: phone,
  };
}

function parseMoa(text: string): Omit<MoaExtract, "agency_key" | "pdf_url" | "model" | "extracted_at"> {
  return {
    ice_signer_name: parseIceName(text),
    ice_signer_title: parseIceTitle(text),
    ice_field_office: parseFieldOffice(text),
    lea_signer_name: parseLeaName(text),
    lea_signer_title: parseLeaTitle(text),
    date_signed: parseDateSigned(text),
    ...parseLeaPoc(text),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (!existsSync(MOA_INDEX_PATH)) {
  console.error(`moa_index.json not found at ${MOA_INDEX_PATH}`);
  console.error("Run: pnpm -F pipeline build:moa-index");
  process.exit(1);
}

const moaIndex: Record<string, string> = JSON.parse(readFileSync(MOA_INDEX_PATH, "utf8"));

// Load existing extracts (incremental mode)
const existing: Record<string, MoaExtract> = existsSync(OUT_PATH)
  ? JSON.parse(readFileSync(OUT_PATH, "utf8"))
  : {};

const entries = Object.entries(moaIndex);
const toProcess = FORCE
  ? entries
  : entries.filter(([key]) => !existing[key] || existing[key].error);

console.log(`${entries.length} total agencies | ${toProcess.length} to process (${Object.keys(existing).length} already done)`);

const tmpPdf = resolve(tmpdir(), "moa_extract_tmp.pdf");
let done = 0, errors = 0;

for (const [agencyKey, treeUrl] of toProcess.slice(0, isFinite(LIMIT) ? LIMIT : undefined)) {
  process.stdout.write(`[${done + 1}/${Math.min(toProcess.length, LIMIT)}] ${agencyKey} … `);

  let extract: MoaExtract = {
    agency_key: agencyKey,
    pdf_url: "",
    model: null,
    ice_signer_name: null,
    ice_signer_title: null,
    ice_field_office: null,
    lea_signer_name: null,
    lea_signer_title: null,
    date_signed: null,
    lea_poc_name: null,
    lea_poc_email: null,
    lea_poc_phone: null,
    extracted_at: new Date().toISOString(),
  };

  try {
    const apiPath = treeUrlToApiPath(treeUrl);
    const files = await ghContents(apiPath);
    const pdf = pickPdf(files as GhFile[]);

    if (!pdf?.download_url) {
      throw new Error("no PDF found in directory");
    }

    extract.pdf_url = pdf.download_url;
    extract.model = detectModel(pdf.name);

    await downloadPdf(pdf.download_url, tmpPdf);
    const text = pdfToText(tmpPdf);

    if (!text.trim()) throw new Error("pdftotext returned empty text");

    Object.assign(extract, parseMoa(text));
    process.stdout.write(`✓ ${extract.ice_field_office ?? "?"} FOD / ${extract.ice_signer_name ?? "?"}\n`);
  } catch (e: any) {
    extract.error = e.message ?? String(e);
    process.stdout.write(`✗ ${extract.error}\n`);
    errors++;
  }

  existing[agencyKey] = extract;
  done++;

  // Write after every 10 to preserve progress
  if (done % 10 === 0) {
    writeFileSync(OUT_PATH, JSON.stringify(existing, null, 2));
  }

  // Avoid hammering GitHub API — polite delay
  await new Promise((r) => setTimeout(r, 400));
}

writeFileSync(OUT_PATH, JSON.stringify(existing, null, 2));
mkdirSync(resolve(__dirname, "data"), { recursive: true });

console.log(`\nDone. ${done} processed, ${errors} errors → ${OUT_PATH}`);

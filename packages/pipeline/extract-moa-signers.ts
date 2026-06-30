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
  lea_poc_address: string | null;   // street + city/state/zip from Appendix C
  addendum_date: string | null;     // date of embedded addendum (if any)
  addendum_signer: string | null;   // ICE official who signed the addendum
  extracted_at: string;
  error?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Convert a GitHub tree URL → repo-relative path
// "https://github.com/appelson/Tracking_287g/tree/main/agreements/SNAP/STATE/AGENCY"
// → "agreements/SNAP/STATE/AGENCY"
function treeUrlToPath(treeUrl: string): string {
  const path = treeUrl.replace("https://github.com/appelson/Tracking_287g/tree/main/", "");
  // Fully decode percent-encoding (%E2%80%99 curly apostrophe, %26 &, %2C comma,
  // %27 straight quote, …) so this key matches the decodeURIComponent'd keys in
  // pdfCache. A partial decode (e.g. only %27) silently misses those agencies →
  // Contents-API fallback → 404.
  try {
    return decodeURIComponent(path);
  } catch {
    return path; // malformed %-sequence: fall back to the raw path
  }
}

// ── Pre-fetch PDF file lists per snapshot via the GitHub Trees API ─────────────
// The recursive trees API returns all files in a subtree in ONE call, reducing
// per-agency directory listings (1428 calls) to ~2 calls per unique snapshot
// (~39 snapshots → ~78 calls total instead of 1428).
//
// Structure: snapshot → agency dir path → [{ name, download_url }]
const pdfCache = new Map<string, GhFile[]>(); // key: agency dir path (decoded)

async function prefetchSnapshot(snapPath: string): Promise<void> {
  // Step 1: get the SHA of the snapshot directory from its Contents entry
  const contentsUrl = `https://api.github.com/repos/appelson/Tracking_287g/contents/${encodeURIComponent(snapPath)}`;
  const cr = await fetch(contentsUrl, { headers: ghHeaders });
  if (!cr.ok) {
    console.warn(`  ⚠ Contents ${cr.status} for ${snapPath}`);
    return;
  }
  // Contents on a directory returns an array of entries; each has a SHA.
  // We want the SHA of the snapshot directory ITSELF — use the parent path trick:
  // ask for the parent and find this dir's entry.
  const parentPath = snapPath.split("/").slice(0, -1).join("/");
  const snapName = snapPath.split("/").at(-1)!;
  const pr = await fetch(
    `https://api.github.com/repos/appelson/Tracking_287g/contents/${parentPath}`,
    { headers: ghHeaders }
  );
  if (!pr.ok) {
    console.warn(`  ⚠ Parent ${pr.status} for ${parentPath}`);
    return;
  }
  const parentEntries: any[] = await pr.json();
  const snapEntry = parentEntries.find((e: any) => e.name === snapName);
  if (!snapEntry?.sha) return;

  // Step 2: recursive tree — returns every file path under this snapshot
  const treeUrl = `https://api.github.com/repos/appelson/Tracking_287g/git/trees/${snapEntry.sha}?recursive=1`;
  const tr = await fetch(treeUrl, { headers: ghHeaders });
  if (!tr.ok) {
    console.warn(`  ⚠ Tree ${tr.status} for snapshot ${snapName}`);
    return;
  }
  const { tree }: { tree: Array<{ path: string; type: string; sha: string }> } = await tr.json();

  // Index by agency directory (two levels: STATE/AGENCY_DIR)
  for (const item of tree) {
    if (item.type !== "blob" || !item.path.toLowerCase().endsWith(".pdf")) continue;
    // path is "STATE/AGENCY_DIR/filename.pdf"
    const parts = item.path.split("/");
    if (parts.length < 3) continue;
    const agencyDir = decodeURIComponent(`${snapPath}/${parts.slice(0, 2).join("/")}`);
    const filename = parts[parts.length - 1];
    const downloadUrl = `https://raw.githubusercontent.com/appelson/Tracking_287g/main/${snapPath}/${parts.join("/")}`;
    const existing = pdfCache.get(agencyDir) ?? [];
    existing.push({ name: filename, download_url: downloadUrl, sha: item.sha });
    pdfCache.set(agencyDir, existing);
  }
}

async function getPdfsForAgency(treeUrl: string): Promise<GhFile[]> {
  const agencyPath = treeUrlToPath(treeUrl);
  if (pdfCache.has(agencyPath)) return pdfCache.get(agencyPath)!;
  // Cache miss — fall back to direct Contents API (e.g. if snapshot wasn't prefetched)
  const url = `https://api.github.com/repos/appelson/Tracking_287g/contents/${encodeURIComponent(agencyPath)}`;
  const r = await fetch(url, { headers: ghHeaders });
  if (!r.ok) throw new Error(`GitHub API ${r.status} for ${agencyPath}`);
  const files: any[] = await r.json();
  return files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
}

async function downloadPdf(file: GhFile, dest: string): Promise<void> {
  // Prefer the authenticated git-blobs API: it draws on the token's 5000 req/hr
  // budget and is NOT subject to raw.githubusercontent.com's burst throttling
  // (which otherwise blocks the IP after a handful of concurrent downloads).
  // Fall back to the raw URL only when we have no blob SHA.
  const useApi = !!file.sha;
  const url = useApi
    ? `https://api.github.com/repos/appelson/Tracking_287g/git/blobs/${file.sha}`
    : file.download_url!;
  const headers = useApi
    ? { ...ghHeaders, Accept: "application/vnd.github.raw" }
    : {};

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // 30s deadline (covers connect + body) so one stalled download can't
      // wedge the worker; AbortSignal aborts the response stream too.
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
      const buf = await r.arrayBuffer();
      writeFileSync(dest, Buffer.from(buf));
      return;
    } catch (e: any) {
      // Don't retry real HTTP status errors (404 etc.) — only timeouts/network.
      const isHttp = typeof e?.message === "string" && e.message.startsWith("HTTP ");
      if (isHttp || attempt === MAX_ATTEMPTS) throw e;
    }
  }
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
type GhFile = { name: string; download_url: string | null; sha?: string | null };

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
// Three template families are in the wild:
//
//   JEM NEW (June 2025+): "For ICE:" in Sec VII, typed "Name: {name}" in right
//     column, numeric dates, ICE title "Deputy Director".
//
//   JEM OLD (pre-June 2025): "ForDHS:" / "For DHS:" in Sec VII, ICE name appears
//     as a right-indented standalone line above a blank "Name:" field, spelled-
//     out or numeric dates, ICE title "Acting Director" or "Field Office Director".
//
//   TFM (Task Force Model, 2025): Sec VII is "NOMINATION OF PERSONNEL" — no FOD
//     POC line at all. Field office only mentioned in the OPLA paragraph:
//     "OPLA field location at Miami Field Office". Sig block has no typed ICE name.
//     Appendix C contact appears on the SAME LINE as "For the LEA:" (or "For LEA:").
//
// We try all patterns for each field and return the first hit.

// US state abbreviations + full names — used to validate a parsed "City, State"
// so we don't mistake template prose ("OPLA, through") for a field-office city.
const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida",
  "Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine",
  "Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska",
  "Nevada","Ohio","Oklahoma","Oregon","Pennsylvania","Tennessee","Texas","Utah","Vermont","Virginia",
  "Washington","Wisconsin","Wyoming",
]);

const ICE_TITLE_RE = /Title:\s*[-– \t]*(Acting\s*Director|Deputy\s*Director|Field\s*Office\s*Director|Assistant\s*Director)/i;
// Matches "First Last", "First M. Last", "First Middle Last" — at least two words,
// each starting uppercase. Does NOT require a third word after a middle initial.
const FULL_NAME_RE = /[A-Z][a-zA-Z'-]+(?: +[A-Z](?:\.[a-zA-Z'-]*|[a-zA-Z'-]+))+/;

// Field office city. Multiple sources:
//
// 1. Section VII POC (JEM template): "For ICE: New Orleans Field Office Director"
//    or "For DHS: New Orleans, Field Office Director" (comma variant)
// 2. OPLA paragraph (TFM template): "OPLA field location at Miami Field Office"
// 3. Termination notice clause (all templates): "written notice to the … Field Office"
//    — too generic, skip
function parseFieldOffice(text: string): string | null {
  // Pattern 1: Sec VII FOD line — allow optional comma/punctuation before "Field"
  const m1 = text.match(/For\s*(?:ICE|DHS):\s*([A-Za-z][A-Za-z ]+?)[,\s]*Field\s*Office\s*Director/i);
  if (m1) return m1[1].trim();

  // Pattern 2: OPLA location paragraph (TFM)
  const m2 = text.match(/OPLA[^.]*?field\s+location\s+at\s+([A-Za-z][A-Za-z ]+?)\s*Field\s*Office/i);
  if (m2) return m2[1].trim();

  // Pattern 3: "local ICE {City} Field Office" — sometimes in body text
  const m3 = text.match(/local\s+ICE\s+([A-Za-z][A-Za-z ]+?)\s+Field\s+Office\b(?!\s+Director)/i);
  if (m3 && m3[1].toLowerCase() !== "the") return m3[1].trim();

  // Pattern 4: TFM fill-in "…OPLA field location at <City, State>". The blank is
  // usually empty, OCR garbage, or the default "OPLA-DCLD-TortClaims@ice.dhs.gov";
  // only accept a genuine "City, State" (validated against US_STATES) and reject
  // the default email text. City can wrap to the next line in -layout output, so
  // scan a 180-char window. Conservative by design — precision over recall.
  const fl = text.search(/field\s+location\s+at\b/i);
  if (fl >= 0) {
    const region = text.slice(fl, fl + 180)
      .replace(/field\s+location\s+at\b/i, " ")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const cm = region.match(/\b([A-Z][a-zA-Z.]+(?:\s+[A-Z][a-zA-Z.]+){0,3}),\s*([A-Z]{2}|[A-Z][a-z]{3,})\b/);
    if (cm && US_STATES.has(cm[2])) {
      const city = cm[1].replace(/\s+/g, " ").trim();
      // Reject address fragments: when the blank holds a street address (e.g. the
      // ICE HQ "…12th St SW, Washington, DC"), the city capture is junk. Street
      // suffixes / directionals signal an address. "St"/"Saint" leading the city
      // (St Petersburg, St Louis) is fine — only reject a TRAILING "… St".
      const hasStreetWord = /\b(?:Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Lane|Court|Suite|Ste|Floor|NW|NE|SW|SE|Street)\b/i.test(city);
      const hasTrailingSt = /\w+\s+St\b/i.test(city);
      const isDefault = /@|TortClaims|DCLD|ice\.dhs|OPLA-/i.test(region.slice(0, cm.index));
      if (!hasStreetWord && !hasTrailingSt && !isDefault) {
        return `${city}, ${cm[2]}`;
      }
    }
  }

  return null;
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

// Appendix C: LEA POC block. Three layouts:
//   JEM new:  name on next line after "For the LEA:" (separate line)
//   JEM old:  "Chief Deputy Tom Allen 334-361-2500" (name+phone on one line)
//   TFM:      "For the LEA:        Sean Scheller" (name on SAME line as label)
//             "For LEA:            Sheriff Boyd" (no "the")
function parseLeaPoc(text: string): { lea_poc_name: string | null; lea_poc_email: string | null; lea_poc_phone: string | null; lea_poc_address: string | null } {
  const idx = text.search(/APPENDIX\s*C/);
  if (idx < 0) return { lea_poc_name: null, lea_poc_email: null, lea_poc_phone: null, lea_poc_address: null };
  const chunk = text.slice(idx, idx + 1200);

  // Match "For [the] LEA:" with optional "the" (TFM drops "the")
  const leaIdx = chunk.search(/For (?:the )?LEA:/i);
  if (leaIdx < 0) return { lea_poc_name: null, lea_poc_email: null, lea_poc_phone: null, lea_poc_address: null };

  // Check if there's a name on the SAME line (TFM pattern):
  //   "For the LEA:        Sean Scheller"
  //   "For LEA:            Sheriff Marty Boyd"  ← strip title prefix
  const leaLine = chunk.slice(leaIdx).split("\n")[0];
  const sameLineMatch = leaLine.match(/For (?:the )?LEA:\s+(.+?)\s*$/i);
  let inlineContact: string | null = null;
  if (sameLineMatch) {
    let candidate = sameLineMatch[1].trim();
    // Skip pure role lines like "Sheriff - Walton County SO" or "Public Affairs Officer"
    if (/ - /.test(candidate) || /County|Office|Dept|Police\b|Public Affairs/.test(candidate)) {
      candidate = "";
    }
    // Strip title prefixes that precede the actual name: "Sheriff Marty Boyd" → "Marty Boyd"
    candidate = candidate.replace(/^(?:Sheriff|Chief Deputy|Chief|Deputy|Major|Captain|Lt\.?|Lieutenant|Col\.?|Commander)\s+/i, "");
    if (FULL_NAME_RE.test(candidate) && candidate.split(/\s+/).length >= 2) {
      inlineContact = candidate;
    }
  }

  // Slice after the label to the "For ICE:" boundary
  const leaLabelLen = chunk.slice(leaIdx).match(/^For (?:the )?LEA:/i)![0].length;
  const iceIdx = chunk.indexOf("For ICE:", leaIdx + leaLabelLen);
  const after = chunk.slice(leaIdx + leaLabelLen, iceIdx > 0 ? iceIdx : undefined);

  let name: string | null = inlineContact;
  let phone: string | null = null;

  if (!name) {
    // Name from next lines: first Title-Case line that isn't numeric/address.
    const nameLines = after
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && /^[A-Z][a-z]/.test(l) && !/^\d/.test(l) && l.length > 4);

    if (nameLines[0]) {
      const phoneInLine = nameLines[0].match(/\s+\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}.*/);
      if (phoneInLine) {
        phone = phoneInLine[0].trim();
        name = nameLines[0].slice(0, phoneInLine.index!).trim();
      } else {
        name = nameLines[0];
      }
    }
  }

  const emailM = after.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/);
  if (!phone) {
    const phoneM = after.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/);
    if (phoneM) phone = phoneM[0];
  }

  // Address: lines between name and phone/email that look like a street address.
  // Typical format: "162 West Fourth Street\nPrattville, Alabama 36067"
  // Collect lines after the name line, stopping at phone/email/For ICE.
  const afterLines = after.split("\n").map((l) => l.trim()).filter(Boolean);
  const nameLineIdx = name ? afterLines.findIndex((l) => l.includes(name!.split(" ")[0])) : -1;
  let address: string | null = null;
  if (nameLineIdx >= 0) {
    const addrLines: string[] = [];
    for (const l of afterLines.slice(nameLineIdx + 1)) {
      if (/^\d{3}[-.\s]\d{3}|@|For (the )?ICE:|For (the )?LEA:/i.test(l)) break;
      // Street: starts with a house number, or looks like "City, State(abbr or full) ZIP"
      if (
        /^\d+\s+[A-Za-z]/.test(l) ||            // "162 West Fourth Street"
        /,\s*[A-Z]{2}\s+\d{5}/.test(l) ||       // "Prattville, AL 36067"
        /,\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+\d{5}/.test(l)  // "Prattville, Alabama 36067"
      ) {
        addrLines.push(l);
      }
      if (addrLines.length >= 2) break; // street + city/state/zip is enough
    }
    if (addrLines.length > 0) address = addrLines.join(", ");
  }

  return {
    lea_poc_name: name,
    lea_poc_email: emailM ? emailM[0] : null,
    lea_poc_phone: phone,
    lea_poc_address: address,
  };
}

// Addendum: some PDFs embed a modification agreement after the main text.
// Extract the addendum's effective date and ICE signer.
function parseAddendum(text: string): { addendum_date: string | null; addendum_signer: string | null } {
  const idx = text.search(/ADDENDUM\s+TO\s+(?:MODIFY\s+)?MEMORANDUM/i);
  if (idx < 0) return { addendum_date: null, addendum_signer: null };

  const chunk = text.slice(idx, idx + 2000);

  // Date: look for a standalone date or "Date:" label in the addendum sig block
  const sigIdx = chunk.lastIndexOf("For the LEA:");
  const sigChunk = sigIdx >= 0 ? chunk.slice(sigIdx) : chunk.slice(-600);

  let addendum_date: string | null = null;
  const dm = sigChunk.match(/Date:\s*[-–~\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)
    ?? sigChunk.match(/Date:\s*[-–~\s]*([A-Z][a-z]+ \d{1,2},?\s*\d{2,4})/i)
    ?? sigChunk.match(/^\s*(\d{1,2}\/\d{1,2}\/(?:20\d{2}|\d{2}))\s*$/m);
  if (dm) addendum_date = dm[1].trim();

  // ICE signer: look for the same patterns as the main sig block
  let addendum_signer: string | null = null;
  const titleMatch = sigChunk.search(ICE_TITLE_RE);
  if (titleMatch >= 0) {
    const before = sigChunk.slice(Math.max(0, titleMatch - 600), titleMatch);
    const m1 = before.match(/^ {30,}Name:\s*[-– \t]*([A-Z][a-zA-Z'-]+(?: +[A-Z](?:\.[a-zA-Z'-]*|[a-zA-Z'-]+))+)\s*$/m);
    if (m1) {
      addendum_signer = m1[1].trim();
    } else {
      for (const line of before.split("\n").reverse()) {
        const lead = line.match(/^(\s+)/)?.[1]?.length ?? 0;
        if (lead < 30) continue;
        const t = line.trim();
        if (FULL_NAME_RE.test(t) && t[0] === t[0].toUpperCase() && t.split(/\s+/).length >= 2) {
          addendum_signer = t;
          break;
        }
      }
    }
  }

  // Fallback: typed name near ICE org affiliation ("C. M. Cronen" above
  // "Assistant Director, Enforcement…U.S. Immigration and Customs Enforcement").
  // Use the LAST occurrence — the first is in the addendum preamble, the last
  // is in the signature block where the actual signer name appears.
  if (!addendum_signer) {
    const iceOrgMatches = [...chunk.matchAll(/U\.S\.\s*Immigration\s+and\s+Customs\s+Enforcement/gi)];
    const iceOrgIdx = iceOrgMatches.length > 0 ? iceOrgMatches[iceOrgMatches.length - 1].index! : -1;
    if (iceOrgIdx >= 0) {
      const nearby = chunk.slice(Math.max(0, iceOrgIdx - 400), iceOrgIdx);
      // Typed name: short line (≤40 chars), Title Case, not "For the LEA/ICE/DHS"
      const nameLines = nearby.split("\n").reverse();
      for (const l of nameLines) {
        const t = l.trim();
        if (!t || t.length > 50 || /^For\s|^Date|^By\s|^All\s|^The\s/i.test(t)) continue;
        // Allow "C. M. Cronen" style (initial + period is OK)
        if (/^[A-Z]\.?\s+[A-Z]/.test(t) && t.split(/\s+/).length >= 2) {
          addendum_signer = t;
          break;
        }
      }
    }
  }

  // Digital signature metadata: "Digitally signed by FIRSTNAME LASTNAME"
  if (!addendum_signer) {
    const digM = chunk.match(/Digitally\s+signed\s+by\s+([A-Z][A-Z\s.'-]{3,40})/i);
    if (digM) addendum_signer = digM[1].trim().replace(/\s+/g, " ");
  }

  return { addendum_date, addendum_signer };
}

// Labels and fragments that look like names but aren't
const SIGNER_BLOCKLIST = /^(?:For ICE:|Department of Homeland|U\.S\. Immigration|Name:|Title:)/i;

function parseMoa(text: string): Omit<MoaExtract, "agency_key" | "pdf_url" | "model" | "extracted_at"> {
  const ice = parseIceName(text);
  return {
    ice_signer_name: ice && !SIGNER_BLOCKLIST.test(ice) ? ice : null,
    ice_signer_title: parseIceTitle(text),
    ice_field_office: parseFieldOffice(text),
    lea_signer_name: parseLeaName(text),
    lea_signer_title: parseLeaTitle(text),
    date_signed: parseDateSigned(text),
    ...parseLeaPoc(text),
    ...parseAddendum(text),
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
// --force: reprocess all | default: skip successfully-extracted entries
// --retry: reprocess only past errors + entries still missing key fields
const RETRY = args.includes("--retry");
const toProcess = FORCE
  ? entries
  : RETRY
  ? entries.filter(([key]) => {
      const v = existing[key];
      if (!v || v.error) return true; // errors always retry
      // Retry if PDF downloaded but all signer/office fields are empty
      return !v.ice_field_office && !v.ice_signer_name && !v.lea_poc_name;
    })
  : entries.filter(([key]) => !existing[key] || existing[key].error);

console.log(`${entries.length} total agencies | ${toProcess.length} to process (${Object.keys(existing).length} already done)`);

// Pre-fetch snapshot file trees to collapse 1428 API calls → ~78
// Only prefetch snapshots that have agencies we're actually processing.
const snapsToPrefetch = new Set<string>();
for (const [, treeUrl] of toProcess.slice(0, isFinite(LIMIT) ? LIMIT : undefined)) {
  const path = treeUrlToPath(treeUrl);
  // snapshot is at depth 1 of agreements/: "agreements/SNAP_NAME"
  const parts = path.split("/");
  if (parts.length >= 2) snapsToPrefetch.add(`${parts[0]}/${parts[1]}`);
}
if (snapsToPrefetch.size > 0) {
  process.stdout.write(`Pre-fetching ${snapsToPrefetch.size} snapshot tree(s)…`);
  for (const snap of snapsToPrefetch) {
    await prefetchSnapshot(snap);
    process.stdout.write(" ✓");
    await new Promise((r) => setTimeout(r, 300)); // polite between tree calls
  }
  process.stdout.write(`\nCached ${pdfCache.size} agency PDF lists\n\n`);
}

const CONCURRENCY = 6;
const work = toProcess.slice(0, isFinite(LIMIT) ? LIMIT : undefined);
let done = 0, errors = 0;
let cursor = 0;

async function processAgency(agencyKey: string, treeUrl: string, tmpPdf: string): Promise<MoaExtract> {
  const extract: MoaExtract = {
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
    lea_poc_address: null,
    addendum_date: null,
    addendum_signer: null,
    extracted_at: new Date().toISOString(),
  };

  try {
    const files = await getPdfsForAgency(treeUrl);
    const pdf = pickPdf(files);

    if (!pdf?.download_url) {
      throw new Error("no PDF found in directory");
    }

    extract.pdf_url = pdf.download_url;
    extract.model = detectModel(pdf.name);

    await downloadPdf(pdf, tmpPdf);
    const text = pdfToText(tmpPdf);

    if (!text.trim()) throw new Error("pdftotext returned empty text");

    Object.assign(extract, parseMoa(text));
  } catch (e: any) {
    extract.error = e.message ?? String(e);
  }

  return extract;
}

// Worker pool: each worker pulls the next agency off a shared cursor and uses
// its own temp file so concurrent downloads never clobber one another.
async function worker(slot: number): Promise<void> {
  const tmpPdf = resolve(tmpdir(), `moa_extract_tmp_${slot}.pdf`);
  while (true) {
    const i = cursor++;            // synchronous claim — no interleaving here
    if (i >= work.length) return;
    const [agencyKey, treeUrl] = work[i];

    const extract = await processAgency(agencyKey, treeUrl, tmpPdf);

    existing[agencyKey] = extract;
    done++;
    if (extract.error) errors++;

    const status = extract.error
      ? `✗ ${extract.error}`
      : `✓ ${extract.ice_field_office ?? "?"} FOD / ${extract.ice_signer_name ?? "?"}`;
    process.stdout.write(`[${done}/${work.length}] ${agencyKey} … ${status}\n`);

    // Write periodically to preserve progress
    if (done % 25 === 0) {
      writeFileSync(OUT_PATH, JSON.stringify(existing, null, 2));
    }
  }
}

await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, work.length) }, (_, s) => worker(s)),
);

writeFileSync(OUT_PATH, JSON.stringify(existing, null, 2));
mkdirSync(resolve(__dirname, "data"), { recursive: true });

console.log(`\nDone. ${done} processed, ${errors} errors → ${OUT_PATH}`);

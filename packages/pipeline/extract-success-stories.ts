#!/usr/bin/env tsx
/**
 * extract-success-stories.ts
 *
 * Extracts narrative "encounter" paragraphs from ICE's own public 287(g)
 * Monthly/FY Encounter Report PDFs into structured records — the raw
 * extraction stage only. No agency matching happens here (see
 * match-success-stories.ts); every story is written with agency_slug absent,
 * for a human to sanity-check extraction quality before anything downstream
 * depends on it.
 *
 * Source PDFs: packages/pipeline/data/success_stories_pdfs/ (gitignored —
 * not yet committed to the repo; drop ICE's PDFs there before running).
 *
 * Two distinct narrative templates exist across the PDF set:
 *   - FY2020-era ("encounterReport_FY2020*.pdf"): "On [date], the [Agency]
 *     287(g) Program encountered a citizen of [country] [charged with/
 *     convicted of] [offense] and placed an immigration detainer and warrant
 *     on the subject. ..." — no model-type phrase.
 *   - 2025/2026-era ("monthlyEncounter_*.pdf"): "On [date], a 287(g) [Jail
 *     Enforcement Model/Task Force Model/Designated Immigration Officer/
 *     Warrant Service Officer] Officer from the [Agency] ... encountered a
 *     citizen of [country]. ..."
 * A single set of field-extraction regexes handles both — model_type is
 * simply null when the older template's phrasing doesn't match.
 *
 * pdftotext (poppler) is used WITHOUT -layout. These are two-column PDFs;
 * -layout interleaves the columns and mangles sentences (verified by direct
 * comparison). Plain mode reconstructs correct single-stream reading order.
 * This is the opposite flag choice from extract-moa-signers.ts, which is
 * correct for that script's differently-shaped single-column PDFs.
 *
 * Usage:
 *   pnpm -F pipeline extract:success-stories -- --print --limit 2   # Phase 1: dry-run, prints only, writes nothing
 *   pnpm -F pipeline extract:success-stories                        # incremental, writes data/success_stories_raw.json
 *   pnpm -F pipeline extract:success-stories -- --force              # reprocess all PDFs
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "data/success_stories_raw.json");

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const PRINT = args.includes("--print");
const limitArg = args.indexOf("--limit");
const LIMIT = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : Infinity;
const dirArg = args.indexOf("--dir");
const PDF_DIR = dirArg >= 0 ? resolve(args[dirArg + 1]) : resolve(__dirname, "data/success_stories_pdfs");

// ── Types ─────────────────────────────────────────────────────────────────

export type Story = {
  id: string;
  source_pdf: string;
  source_period: string; // "2026-08" (monthly) or "FY2020-07" (fiscal-year era)
  page_number: number | null;
  state_header: string;
  raw_text: string;
  date_encountered: string | null; // ISO YYYY-MM-DD
  model_type: string | null;
  agency_text_raw: string;
  facility_name: string | null;
  agency_state_hint: string | null; // 2-letter, if explicitly stated
  subject_nationality: string | null;
  offense_description: string | null;
  conviction_or_charge: "convicted" | "charged" | "arrested" | "record_check" | null;
  sentence_description: string | null;
  entry_history: string | null;
  extracted_at: string;
  parse_warnings: string[];
};

// ── State name table (closed vocabulary for header detection) ──────────────
// Deliberately self-contained rather than importing from ingest.ts, which
// doesn't export its own copy — this is a small, static, unlikely-to-drift
// list, not worth coupling two unrelated pipeline scripts over.
const STATE_NAMES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV",
  Wisconsin: "WI", Wyoming: "WY", "District of Columbia": "DC",
  "Puerto Rico": "PR", Guam: "GU", "Virgin Islands": "VI",
};
const STATE_HEADER_SET = new Set(Object.keys(STATE_NAMES));

const MODEL_PHRASES = [
  "Jail Enforcement Model",
  "Task Force Model",
  "Designated Immigration Officer",
  "Warrant Service Officer",
  "Deportation Officer",
];

const MONTHS: Record<string, string> = {
  January: "01", February: "02", March: "03", April: "04", May: "05", June: "06",
  July: "07", August: "08", September: "09", October: "10", November: "11", December: "12",
};

// ── pdftotext wrapper (plain mode — see header comment for why) ────────────
function pdfToText(pdfPath: string, pageFrom?: number, pageTo?: number): string {
  const flags = pageFrom != null && pageTo != null ? ["-f", String(pageFrom), "-l", String(pageTo)] : [];
  try {
    return execFileSync("pdftotext", [...flags, pdfPath, "-"], {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

function pdfPageCount(pdfPath: string): number {
  try {
    const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8", timeout: 10_000 });
    const m = info.match(/^Pages:\s+(\d+)/m);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  }
}

// ── Filename → period parsing ───────────────────────────────────────────────
function parsePeriod(filename: string): string | null {
  // "monthlyEncounter_Aug2026.pdf" / "monthlyEncounter_Sept2025.pdf" (note: some
  // files spell September in full, not just "Sep")
  let m = filename.match(/monthlyEncounter_([A-Za-z]+)(\d{4})/);
  if (m) {
    const [, monAbbr, year] = m;
    const monthNum = monthAbbrToNum(monAbbr);
    if (monthNum) return `${year}-${monthNum}`;
  }
  // "encounterReport_FY2020Jul.pdf" / "encounterReport_FY2020_Dec.pdf"
  m = filename.match(/encounterReport_FY(\d{4})_?([A-Za-z]+)/);
  if (m) {
    const [, fy, monAbbr] = m;
    const monthNum = monthAbbrToNum(monAbbr);
    if (monthNum) return `FY${fy}-${monthNum}`;
  }
  return null;
}

function monthAbbrToNum(abbr: string): string | null {
  const norm = abbr.toLowerCase();
  for (const [full, num] of Object.entries(MONTHS)) {
    if (full.toLowerCase().startsWith(norm) || norm.startsWith(full.toLowerCase().slice(0, 3))) return num;
  }
  return null;
}

// ── Preprocessing ────────────────────────────────────────────────────────────
function cleanText(raw: string): string {
  return raw
    // Running footer + bare page-number lines.
    .replace(/^ENFORCEMENT AND REMOVAL OPERATIONS \(ERO\).*$/gm, "")
    .replace(/^\d{1,3}$/gm, "")
    // Decorative zero-width-character runs and bullet separators seen between
    // state sections.
    .replace(/[​-‏⁠﻿]/g, "")
    .replace(/^[‧•]+$/gm, "")
    // Curly quotes → straight, for consistent regex matching downstream.
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // A handful of source PDFs have font/kerning issues (visible as
    // "Syntax Warning: Invalid Font Weight" from pdftotext) that
    // occasionally glue a word directly onto "287(g)" with no space
    // (e.g. "Office287(g) Program"). Insert the missing space rather than
    // let it break agency-phrase extraction.
    .replace(/([a-z])287\(g\)/g, "$1 287(g)")
    // Same font-issue PDFs occasionally inject a stray capital "A" right at
    // a line-wrap after "from"/"Program" (verified: "Officer fromA\nthe..."
    // / "287(g) ProgramA\nencountered..." — real content never has "A" glued
    // onto these specific words). Strip it rather than let it corrupt
    // agency-phrase extraction.
    .replace(/\b(from|Program)A(\n|\s)/g, "$1$2")
    // Collapse 3+ blank lines to exactly 2 (paragraph separator), but never
    // collapse a single blank line to zero — that's the story boundary signal.
    .replace(/\n{3,}/g, "\n\n");
}

function stripIntro(text: string): string {
  // The anchor sentence sometimes wraps across a line break in the raw
  // pdftotext output (two-column layout), so match with whitespace treated
  // as flexible rather than a literal substring search.
  const anchorRe = /The\s+cases\s+that\s+follow\s+are\s+a\s+sampling\s+of\s+criminal\s+aliens/;
  const m = text.match(anchorRe);
  if (!m || m.index == null) return text; // no intro found — process whole text, flagged via empty result upstream
  const afterSentence = text.indexOf(".", m.index);
  return afterSentence === -1 ? text : text.slice(afterSentence + 1);
}

// ── Splitting into state sections ───────────────────────────────────────────
type StateSection = { state: string; text: string };

// A real story never continues past a page break mid-sentence in ICE's own
// layout intent, but pdftotext's plain-mode output does sometimes land a
// state-header line ("North Carolina") ahead of a short orphaned fragment
// that's actually the tail end of the PREVIOUS state's last story — verified:
// a story ending "...last entered the United" wraps mid-WORD across a page
// break, and the continuation "States on an unknown date..." lands after the
// new page's header. The continuation can start with an uppercase word
// (here "States" — literally the second half of "United States"), so
// "starts lowercase" isn't a reliable signal. What IS reliable: the
// PREVIOUS section's last line, right before the header, doesn't end in
// terminal punctuation (a real story boundary always does — every sampled
// story ends in a period) — that means the story was cut off mid-sentence
// by the page break, so whatever comes immediately after the next header is
// almost certainly that same sentence's continuation, not new content.
function splitStateSections(text: string): StateSection[] {
  const lines = text.split("\n");
  const sections: StateSection[] = [];
  let current: StateSection | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (STATE_HEADER_SET.has(trimmed)) {
      if (current) sections.push(current);
      current = { state: trimmed, text: "" };
    } else if (current) {
      const isFirstLineOfSection = current.text.trim() === "";
      const prevSectionEndedMidSentence =
        sections.length > 0 && !/[.!?]\s*$/.test(sections[sections.length - 1].text.trim());
      const looksLikeOrphanedContinuation = isFirstLineOfSection && prevSectionEndedMidSentence && trimmed !== "";
      if (looksLikeOrphanedContinuation) {
        sections[sections.length - 1].text += line + "\n";
      } else {
        current.text += line + "\n";
      }
    }
  }
  if (current) sections.push(current);
  return sections;
}

// ── Splitting a state section into individual stories ───────────────────────
const STORY_START_RE = /^On [A-Z][a-z]+ \d{1,2}, \d{4},/;

function splitStories(sectionText: string): string[] {
  const lines = sectionText.split("\n");
  const stories: string[] = [];
  let current = "";
  for (const line of lines) {
    if (STORY_START_RE.test(line.trim())) {
      if (current.trim()) stories.push(current.trim());
      current = line + "\n";
    } else {
      current += line + "\n";
    }
  }
  if (current.trim()) stories.push(current.trim());
  // Join wrapped lines within each story into flowing text, collapsing the
  // pdftotext-introduced line breaks (not paragraph breaks — those were
  // already used as split points above) into single spaces.
  return stories.map((s) => s.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim());
}

// ── Per-story field extraction ──────────────────────────────────────────────
function parseDate(monthName: string, day: string, year: string): string | null {
  const num = MONTHS[monthName];
  if (!num) return null;
  return `${year}-${num}-${day.padStart(2, "0")}`;
}

function extractStory(
  raw: string,
  ctx: { source_pdf: string; source_period: string; page_number: number | null; state_header: string },
): Story {
  const warnings: string[] = [];

  // Leading date.
  const dateMatch = raw.match(/^On ([A-Z][a-z]+) (\d{1,2}), (\d{4}),/);
  const date_encountered = dateMatch ? parseDate(dateMatch[1], dateMatch[2], dateMatch[3]) : null;
  if (!date_encountered) warnings.push("date_encountered unparseable");

  // Model type (2025/2026-era template only).
  const modelMatch = MODEL_PHRASES.find((m) => raw.includes(m));
  const model_type = modelMatch ?? null;
  if (!model_type) warnings.push("no model_type found (expected for FY2020-era PDFs)");

  // Agency phrase: text between "from the"/"from"/"with the"/"at the"
  // (2025/26 template) or "the ... 287(g) Program[,] encountered" (FY2020
  // template — a comma sometimes precedes "encountered"/"arrested"), up to
  // "encountered" or "arrested".
  let agency_text_raw = "";
  let m = raw.match(/\b(?:from|with|at) (?:the )?([^.]+?),? encountered\b/);
  if (!m) m = raw.match(/\b(?:from|with|at) (?:the )?([^.]+?),? arrested\b/);
  if (!m) {
    // FY2020 template: "On [date], the [Agency] 287(g) Program[,] encountered..."
    m = raw.match(/^On [A-Z][a-z]+ \d{1,2}, \d{4}, the ([^.]+?) 287\(g\) Program,? (?:encountered|arrested)\b/);
  }
  if (m) {
    agency_text_raw = m[1].trim().replace(/,\s*$/, "");
  } else {
    warnings.push("agency_text_raw not found — story may not match the known template");
  }

  // Facility clause split-out.
  let facility_name: string | null = null;
  const facilityMatch = agency_text_raw.match(
    /\bat the ([A-Z][^,.]+?(?:Facility|Center|Jail|Detention Center|Correctional Facility|Correctional Institution|Institution))\b/i,
  );
  if (facilityMatch) {
    facility_name = facilityMatch[1].trim();
    agency_text_raw = agency_text_raw.slice(0, facilityMatch.index).trim().replace(/,\s*$/, "");
  }

  // Strip a trailing "287(g) program/Program" suffix — appears constantly
  // ("...Rehabilitation and Reentry 287(g) program", "...Department 287(g)
  // Program") and is never part of a real agency's registered name. Must
  // happen BEFORE state-hint detection below: several stories have the
  // shape "..., North Carolina 287(g) Program", where the state name sits
  // before this suffix, not at the true end of the string.
  agency_text_raw = agency_text_raw.replace(/\s*287\(g\)\s*[Pp]rogram\s*$/, "").trim();

  // Trailing state signal, e.g. "Collier County Sheriff's Office, FL" or
  // "Blaine County Sheriff's Office, Oklahoma" (full name, no comma always
  // present — the 2025/26 template mixes both forms). Important: ICE's own
  // documents sometimes place a story under the WRONG state_header (verified
  // directly — "Blaine County Sheriff's Office, Oklahoma" appears in a "New
  // York" section in one PDF), so this explicit in-text signal is the more
  // trustworthy source when it's present and should win over state_header
  // in the matching phase, not just supplement it.
  let agency_state_hint: string | null = null;
  const stateAbbrMatch = agency_text_raw.match(/,\s*([A-Z]{2})\s*,?$/);
  if (stateAbbrMatch) {
    agency_state_hint = stateAbbrMatch[1];
    agency_text_raw = agency_text_raw.slice(0, stateAbbrMatch.index).trim();
  } else {
    const stateNameMatch = agency_text_raw.match(/,?\s*([A-Z][a-zA-Z ]+?)\s*$/);
    if (stateNameMatch && STATE_NAMES[stateNameMatch[1].trim()]) {
      agency_state_hint = STATE_NAMES[stateNameMatch[1].trim()];
      agency_text_raw = agency_text_raw.slice(0, stateNameMatch.index).trim().replace(/,\s*$/, "");
    } else {
      // Leading state name, but ONLY for a narrow set of recognizable
      // state-agency phrase shapes ("Nebraska State Patrol", "Oklahoma
      // Department of Corrections") — deliberately NOT a general "state
      // name anywhere in the text" check, since that produces false
      // positives on county names that happen to share a state's name
      // (e.g. "Washington County Sheriff's Office" is a real county in
      // Arkansas, not a reference to Washington state).
      const leadingStateMatch = agency_text_raw.match(
        /^([A-Z][a-zA-Z ]+?)\s+(?:State Patrol|Highway Patrol|Department of (?:Corrections|Public Safety))\b/,
      );
      if (leadingStateMatch && STATE_NAMES[leadingStateMatch[1].trim()]) {
        agency_state_hint = STATE_NAMES[leadingStateMatch[1].trim()];
      }
    }
  }
  if (agency_state_hint && agency_state_hint !== STATE_NAMES[ctx.state_header]) {
    warnings.push(
      `state_header ("${ctx.state_header}") disagrees with in-text agency_state_hint ` +
      `(${agency_state_hint}) — ICE's own document places this story under the wrong ` +
      `state heading at least twice elsewhere; trust agency_state_hint for matching.`,
    );
  }

  // Nationality.
  let subject_nationality: string | null = null;
  // Country names are one or more capitalized tokens (allowing internal
  // hyphens, e.g. "Bosnia-Herzegovina") — stop at the first lowercase word,
  // not just the next comma/period, since the FY2020 template often has no
  // punctuation between the country and the next clause ("citizen of Mexico
  // sentenced to...").
  const natMatch = raw.match(/\bcitizen(?: and national)? of ((?:[A-Z][a-zA-Z'-]*\s?)+)/);
  if (natMatch) subject_nationality = natMatch[1].trim();
  else warnings.push("subject_nationality not found");

  // Disposition signal for the CURRENT encounter (rough, not a legal
  // judgment — raw_text is always kept verbatim for a human to check). Some
  // stories mention the subject's unrelated prior convictions later in the
  // same paragraph ("...charged with simple battery... The subject has
  // previous convictions for..."), which would wrongly flip this to
  // "convicted" if any keyword match anywhere in the text counted — so take
  // whichever signal appears FIRST in the story, not just any match.
  let conviction_or_charge: Story["conviction_or_charge"] = null;
  const dispositionPatterns: Array<[Story["conviction_or_charge"], RegExp]> = [
    ["convicted", /\bconvicted (?:of|in)\b|\bconviction(?:s)? (?:of|for)\b|\bsentenced to\b/i],
    ["charged", /\bcharged with\b/i],
    ["record_check", /\brecord checks? reveal/i],
    ["arrested", /\barrested\b/i],
  ];
  let earliestIdx = Infinity;
  for (const [label, re] of dispositionPatterns) {
    const idx = raw.search(re);
    if (idx !== -1 && idx < earliestIdx) {
      earliestIdx = idx;
      conviction_or_charge = label;
    }
  }

  return {
    id: "", // filled by caller once index-within-pdf is known
    source_pdf: ctx.source_pdf,
    source_period: ctx.source_period,
    page_number: ctx.page_number,
    state_header: ctx.state_header,
    raw_text: raw,
    date_encountered,
    model_type,
    agency_text_raw,
    facility_name,
    agency_state_hint,
    subject_nationality,
    // Offense/sentence/entry-history are deliberately left as the full raw
    // text rather than further split — see header comment / plan rationale:
    // forcing highly variable free text into rigid sub-fields risks silent
    // misparsing. A reader/reviewer can find these clauses in raw_text.
    offense_description: null,
    conviction_or_charge,
    sentence_description: null,
    entry_history: null,
    extracted_at: new Date().toISOString(),
    parse_warnings: warnings,
  };
}

// ── Per-PDF processing ───────────────────────────────────────────────────────
function processPdf(pdfPath: string): Story[] {
  const filename = basename(pdfPath);
  const source_period = parsePeriod(filename);
  if (!source_period) {
    console.warn(`⚠ ${filename}: couldn't parse a period from the filename — skipping`);
    return [];
  }

  const fullText = cleanText(pdfToText(pdfPath));
  if (!fullText.trim()) {
    console.warn(`⚠ ${filename}: pdftotext produced no text`);
    return [];
  }
  const body = stripIntro(fullText);
  const sections = splitStateSections(body);

  // Best-effort page attribution: re-run pdftotext per page and find which
  // page each story's date-anchor text appears on. Cheap at this volume
  // (32 PDFs × ~5-10 pages), and citation fidelity was an explicit ask.
  const pageCount = pdfPageCount(pdfPath);
  const pageTexts: string[] = [];
  for (let p = 1; p <= pageCount; p++) {
    pageTexts.push(cleanText(pdfToText(pdfPath, p, p)));
  }
  // Match against whitespace-collapsed versions of both sides — the per-page
  // text still has the original mid-sentence line wraps (from the two-column
  // layout), which the already-collapsed story text won't literally contain.
  const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
  const pageTextsCollapsed = pageTexts.map(collapse);
  const findPage = (snippet: string): number | null => {
    const key = collapse(snippet).slice(0, 50);
    for (let i = 0; i < pageTextsCollapsed.length; i++) {
      if (pageTextsCollapsed[i].includes(key)) return i + 1;
    }
    return null;
  };

  const stories: Story[] = [];
  let indexInPdf = 0;
  for (const section of sections) {
    const rawStories = splitStories(section.text);
    for (const raw of rawStories) {
      const page_number = findPage(raw);
      const story = extractStory(raw, {
        source_pdf: filename,
        source_period,
        page_number,
        state_header: section.state,
      });
      story.id = createHash("sha1").update(`${filename}|${indexInPdf}`).digest("hex").slice(0, 16);
      indexInPdf++;
      stories.push(story);
    }
  }
  return stories;
}

// ── Main ──────────────────────────────────────────────────────────────────
function main() {
  if (!existsSync(PDF_DIR)) {
    console.error(`✗ PDF directory not found: ${PDF_DIR}`);
    console.error(`  Drop ICE's 287(g) Encounter Report PDFs there before running.`);
    process.exit(1);
  }

  const pdfFiles = readdirSync(PDF_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    // Dedupe the observed "(1)" duplicate-download filename variant.
    .filter((f) => !/\(\d+\)\.pdf$/i.test(f))
    .sort();

  const existing: Record<string, Story> = existsSync(OUT_PATH) && !FORCE
    ? JSON.parse(readFileSync(OUT_PATH, "utf8"))
    : {};
  const processedPdfs = new Set(Object.values(existing).map((s) => s.source_pdf));

  const toProcess = pdfFiles.filter((f) => FORCE || PRINT || !processedPdfs.has(f)).slice(0, LIMIT);
  if (!toProcess.length) {
    console.log("Nothing to do — all PDFs already processed (use --force to reprocess).");
    return;
  }

  console.log(`Processing ${toProcess.length} PDF(s)${PRINT ? " (--print: dry-run, no files written)" : ""}...\n`);

  const allStories: Story[] = PRINT ? [] : Object.values(existing);
  let totalNew = 0;
  for (const filename of toProcess) {
    const pdfPath = resolve(PDF_DIR, filename);
    const stories = processPdf(pdfPath);
    totalNew += stories.length;
    console.log(`  ${filename}: ${stories.length} stories`);
    if (PRINT) {
      for (const s of stories) {
        console.log(`\n--- ${s.id} | ${s.state_header} | p.${s.page_number} | ${s.date_encountered ?? "?"} | model=${s.model_type ?? "none"} ---`);
        console.log(`agency_text_raw: "${s.agency_text_raw}"`);
        if (s.facility_name) console.log(`facility_name: "${s.facility_name}"`);
        if (s.agency_state_hint) console.log(`agency_state_hint: ${s.agency_state_hint}`);
        console.log(`nationality: ${s.subject_nationality ?? "?"} | disposition: ${s.conviction_or_charge ?? "?"}`);
        if (s.parse_warnings.length) console.log(`⚠ warnings: ${s.parse_warnings.join("; ")}`);
        console.log(`raw_text: ${s.raw_text}`);
      }
    } else {
      allStories.push(...stories);
    }
  }

  console.log(`\n${totalNew} new stories extracted from ${toProcess.length} PDF(s).`);

  if (!PRINT) {
    const keyed: Record<string, Story> = {};
    for (const s of allStories) keyed[s.id] = s;
    writeFileSync(OUT_PATH, JSON.stringify(keyed, null, 2));
    console.log(`Wrote ${Object.keys(keyed).length} total stories → ${OUT_PATH}`);
  }
}

main();

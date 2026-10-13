#!/usr/bin/env node
// One-time (re-runnable) fix for a real UX bug: every agency's `moa_url`
// points at a GitHub *directory* listing (.../tree/main/agreements/...), not
// the actual document — so clicking "MOA" dumps the reader onto a raw GitHub
// folder they have to click through themselves. Resolves each directory via
// the GitHub API (gh CLI's auth, so 5000/hr not the unauthenticated 60/hr)
// to the real file(s) inside, tagged by model (JEM/TFM/WSO) parsed from the
// filename where possible. Output is committed (packages/web/src/lib/data/
// moa-documents.json), not regenerated per deploy — agency_index.json's
// moa_url set changes slowly, and re-running this is one command when it
// does. Agencies not yet in the lookup (new since the last run) just fall
// back to the raw directory link — no worse than today.
import { readFileSync, writeFileSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const DATA_PATH = new URL("../static/data/dist/agency_index.json", import.meta.url);
const OUT_PATH = new URL("../src/lib/data/moa-documents.json", import.meta.url);

const agencies = JSON.parse(readFileSync(DATA_PATH, "utf8"));
const urls = [...new Set(agencies.map((a) => a.moa_url).filter(Boolean))];
console.log(`Resolving ${urls.length} unique MOA directories...`);

const TREE_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/;
// Filenames are underscore-separated (e.g. "..._JEM_MOA_...") — `_` is a
// word character, so a `\bJEM\b`-style regex never matches (no boundary
// between two word chars). Split on non-letters instead.
const MODEL_BY_TAG = { JEM: "Jail Enforcement Model", TFM: "Task Force Model", WSO: "Warrant Service Officer" };
const modelTagFrom = (filename) => {
  const parts = filename.toUpperCase().split(/[^A-Z]+/);
  for (const p of parts) if (MODEL_BY_TAG[p]) return p;
  return null;
};

async function resolveOne(url) {
  const m = url.match(TREE_RE);
  if (!m) return null;
  const [, owner, repo, ref, path] = m;
  try {
    const { stdout } = await execFileAsync("gh", [
      "api",
      `repos/${owner}/${repo}/contents/${path}?ref=${ref}`,
    ]);
    const entries = JSON.parse(stdout);
    if (!Array.isArray(entries)) return null;
    const files = entries.filter((e) => e.type === "file");
    return files.map((f) => {
      const tag = modelTagFrom(f.name);
      return { name: f.name, url: f.html_url, model: tag ? MODEL_BY_TAG[tag] : null };
    });
  } catch (err) {
    console.warn(`  failed: ${url} (${err.message.split("\n")[0]})`);
    return null;
  }
}

// Bounded concurrency — gh api calls are network-bound, 12 in flight keeps
// this well inside the authenticated 5000/hr rate limit while not taking
// forever serially.
const CONCURRENCY = 12;
const result = {};
let done = 0;
let i = 0;
async function worker() {
  while (i < urls.length) {
    const idx = i++;
    const url = urls[idx];
    const resolved = await resolveOne(url);
    if (resolved) result[url] = resolved;
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${urls.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

writeFileSync(OUT_PATH, JSON.stringify(result));
console.log(`Resolved ${Object.keys(result).length}/${urls.length}. Wrote ${OUT_PATH.pathname}`);

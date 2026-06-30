// Prototype for #2 — cross-snapshot agreement index.
// Unions agreement PDFs across ALL snapshots and reports model coverage per agency.
// This is the basis for build-agreement-index.ts (see docs/AGREEMENTS_PER_AGREEMENT_PLAN.md).
//
// Run:  export GITHUB_TOKEN="$(grep -E '^GITHUB_TOKEN=' ../../.env | head -1 | cut -d= -f2-)"
//       node packages/pipeline/scratch/agreement-union.mjs   (from repo root)
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENCY_INDEX = resolve(__dirname, "../../web/static/data/dist/agency_index.json");
const a = JSON.parse(readFileSync(AGENCY_INDEX, "utf8"));
const TOKEN = process.env.GITHUB_TOKEN;
const gh = { Authorization: `Bearer ${TOKEN}`, "User-Agent": "union" };
const REPO = "appelson/Tracking_287g";
const TAG = { JEM: "Jail Enforcement Model", TFM: "Task Force Model", WSO: "Warrant Service Officer" };
const norm = (s) => decodeURIComponent(s).toLowerCase().replace(/[^a-z0-9]/g, "");

const snaps = (await (await fetch(`https://api.github.com/repos/${REPO}/contents/agreements`, { headers: gh })).json())
  .filter((s) => s.type === "dir" && /agreements_\d/.test(s.name));
console.log(`unioning ${snaps.length} snapshots…`);

// agency key -> Map(model tag -> {pdf_url, sha, snapshot, dateStr})  (dedupe by model+filename)
const cover = new Map();
let totalPdfs = 0, cursor = 0;
async function worker() {
  while (cursor < snaps.length) {
    const s = snaps[cursor++];
    try {
      const t = await (await fetch(`https://api.github.com/repos/${REPO}/git/trees/${s.sha}?recursive=1`, { headers: gh, signal: AbortSignal.timeout(25000) })).json();
      for (const it of t.tree || []) {
        if (it.type !== "blob" || !it.path.toLowerCase().endsWith(".pdf")) continue;
        const parts = it.path.split("/");
        if (parts.length < 3) continue;
        totalPdfs++;
        const key = `${norm(parts[0])}|${norm(parts[1])}`;
        const file = parts[parts.length - 1];
        const tag = (file.match(/_(JEM|TFM|WSO)_/i) || [])[1]?.toUpperCase();
        if (!cover.has(key)) cover.set(key, new Map());
        if (tag && !cover.get(key).has(tag)) {
          cover.get(key).set(tag, {
            pdf_url: `https://raw.githubusercontent.com/${REPO}/main/agreements/${s.name}/${it.path}`,
            sha: it.sha, snapshot: s.name, date: (file.match(/(\d{6,8})/) || [])[1] || null,
          });
        }
      }
    } catch { /* skip */ }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`indexed ${cover.size} agency folders, ${totalPdfs} total PDFs\n`);

const multi = a.filter((x) => Array.isArray(x.models) && x.models.length > 1 && x.moa_url);
let full = 0, partial = 0, none = 0;
for (const ag of multi) {
  const after = ag.moa_url.split("/tree/main/agreements/")[1]?.split("/") || [];
  const key = `${norm(after[1] || "")}|${norm(after.slice(2).join("/") || "")}`;
  const tags = cover.get(key) || new Map();
  const covered = ag.models.filter((m) => [...tags.keys()].some((t) => TAG[t] === m));
  if (tags.size === 0) none++;
  else if (covered.length >= ag.models.length) full++;
  else partial++;
}
const tot = multi.length;
console.log(`multi-model agencies: ${tot} | full ${full} (${Math.round(100*full/tot)}%) | partial ${partial} | none ${none}`);
console.log("Next: emit data/moa_agreements.json = { [agency_key]: [{model, pdf_url, sha, snapshot, date}] }");

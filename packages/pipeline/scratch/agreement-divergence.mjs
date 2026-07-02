// Prototype for the divergence check (the "test empirically" piece).
// For one agency, extracts the public-affairs POC from EVERY agreement PDF in its
// linked folder and reports whether they diverge. Proven case: autauga (JEM Tom Allen
// vs WSO Mark B. Harrell). Generalize this into `check:agreements`.
//
// Run:  export GITHUB_TOKEN="$(grep -E '^GITHUB_TOKEN=' ../../.env | head -1 | cut -d= -f2-)"
//       node packages/pipeline/scratch/agreement-divergence.mjs <slug>   (default: autauga)
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const a = JSON.parse(readFileSync(resolve(__dirname, "../../web/static/data/dist/agency_index.json"), "utf8"));
const TOKEN = process.env.GITHUB_TOKEN;
const tmp = resolve(tmpdir(), "agreement_divergence_tmp.pdf");
const gh = { Authorization: `Bearer ${TOKEN}`, "User-Agent": "div" };

// rough public-affairs POC (Appendix C "For [the] LEA:" name/email) — replace with
// the real parseLeaPoc when productionizing.
function leaPoc(text) {
  const idx = text.search(/APPENDIX\s*C/);
  if (idx < 0) return { name: null, email: null };
  const chunk = text.slice(idx, idx + 1500);
  const li = chunk.search(/For (?:the )?LEA:/i);
  const region = li >= 0 ? chunk.slice(li, li + 400) : chunk;
  const email = (region.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [])[0] || null;
  const nm = region.match(/For (?:the )?LEA:\s*([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,3})/i);
  return { name: nm ? nm[1].trim() : null, email };
}

const slug = process.argv[2] || "autauga-county-sheriffs-office-al";
const ag = a.find((x) => x.slug === slug);
const path = ag.moa_url.replace("https://github.com/appelson/Tracking_287g/tree/main/", "");
const enc = path.split("/").map((s) => encodeURIComponent(decodeURIComponent(s))).join("/");
const dir = await (await fetch(`https://api.github.com/repos/appelson/Tracking_287g/contents/${enc}?ref=main`, { headers: gh })).json();
console.log(`${slug} | stored POC: ${JSON.stringify(ag.moa_poc_name)}`);
const names = new Set(), emails = new Set();
for (const p of dir.filter((f) => f.name.toLowerCase().endsWith(".pdf"))) {
  const rr = await fetch(`https://api.github.com/repos/appelson/Tracking_287g/git/blobs/${p.sha}`, { headers: { ...gh, Accept: "application/vnd.github.raw" } });
  writeFileSync(tmp, Buffer.from(await rr.arrayBuffer()));
  const t = execFileSync("pdftotext", ["-layout", tmp, "-"], { encoding: "utf8", timeout: 30000 });
  const model = (p.name.match(/_(JEM|TFM|WSO)_/i) || ["", "?"])[1];
  const poc = leaPoc(t);
  if (poc.name) names.add(poc.name); if (poc.email) emails.add(poc.email);
  console.log(`  ${model.padEnd(4)} → ${JSON.stringify(poc.name)}  ${JSON.stringify(poc.email)}`);
}
console.log(names.size > 1 || emails.size > 1 ? "⚠ DIVERGENT" : "✓ consistent");

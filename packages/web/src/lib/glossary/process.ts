import { GLOSSARY_TERMS, termSlug } from "./terms";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Sort longest-first so "Jail Enforcement Model" matches before "Jail Enforcement"
const sorted = [...GLOSSARY_TERMS].sort((a, b) => b.term.length - a.term.length);

// Use lookahead/lookbehind instead of \b — handles terms like "287(g)" that end with non-word chars
const pattern = sorted.map((t) => `(?<!\\w)${escapeRegex(t.term)}(?!\\w)`).join("|");
const regex = new RegExp(pattern, "gi");

// Glosses the first occurrence of each glossary term in `text`. Subsequent
// mentions of the same term in the same call are left as plain text so the
// reading surface doesn't fill with repeated dotted underlines. Pass a shared
// `seen` Set to dedupe across multiple calls on the same page (e.g. several
// paragraphs in the same article).
export function processGloss(text: string, seen: Set<string> = new Set()): string {
  if (!text) return text;
  return text.replace(regex, (match) => {
    const entry = sorted.find((t) => t.term.toLowerCase() === match.toLowerCase());
    if (!entry) return match;
    const key = entry.term.toLowerCase();
    if (seen.has(key)) return match;
    seen.add(key);
    const slug = termSlug(entry.term);
    const encoded = encodeURIComponent(entry.term);
    return `<a class="gloss-term" href="/glossary#term-${slug}" data-term="${encoded}">${match}</a>`;
  });
}

// HTML-safe variant for pre-rendered prose (the AI-generated state news
// tldr_html/body_html) — processGloss's plain regex-replace isn't safe to run
// on markup: it could match inside an existing tag's attributes, or nest a
// <a class="gloss-term"> inside an existing <a href="...ICE coverage...">,
// producing invalid HTML. This walks the string once, tracking whether we're
// inside a tag (skip) or inside an existing <a>...</a> (skip — never nest
// anchors, and a linked mention already has its own destination), and only
// runs the term regex against genuine text-node segments in between.
export function processGlossHtml(html: string, seen: Set<string> = new Set()): string {
  if (!html) return html;
  let out = "";
  let i = 0;
  let anchorDepth = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      const textSeg = html.slice(i);
      out += anchorDepth > 0 ? textSeg : processGloss(textSeg, seen);
      break;
    }
    const textSeg = html.slice(i, lt);
    out += anchorDepth > 0 ? textSeg : processGloss(textSeg, seen);

    const gt = html.indexOf(">", lt);
    if (gt === -1) {
      // Malformed/truncated tag — bail and emit the remainder verbatim
      // rather than risk mangling it further.
      out += html.slice(lt);
      break;
    }
    const tag = html.slice(lt, gt + 1);
    out += tag;
    if (/^<a[\s>]/i.test(tag)) anchorDepth++;
    else if (/^<\/a>/i.test(tag)) anchorDepth = Math.max(0, anchorDepth - 1);
    i = gt + 1;
  }
  return out;
}

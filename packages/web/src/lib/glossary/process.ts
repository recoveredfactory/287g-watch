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

import { GLOSSARY_TERMS, termSlug } from "./terms";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Sort longest-first so "Jail Enforcement Model" matches before "Jail Enforcement"
const sorted = [...GLOSSARY_TERMS].sort((a, b) => b.term.length - a.term.length);

// Use lookahead/lookbehind instead of \b — handles terms like "287(g)" that end with non-word chars
const pattern = sorted.map((t) => `(?<!\\w)${escapeRegex(t.term)}(?!\\w)`).join("|");
const regex = new RegExp(pattern, "gi");

export function processGloss(text: string): string {
  if (!text) return text;
  return text.replace(regex, (match) => {
    const entry = sorted.find((t) => t.term.toLowerCase() === match.toLowerCase());
    if (!entry) return match;
    const slug = termSlug(entry.term);
    const encoded = encodeURIComponent(entry.term);
    return `<a class="gloss-term" href="/glossary#term-${slug}" data-term="${encoded}">${match}</a>`;
  });
}

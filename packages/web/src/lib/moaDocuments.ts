import moaDocuments from "./data/moa-documents.json";

// ~10% of agencies (133/1345 at last count) have no structured
// `agreements[]` records, so their only MOA link is the flat `moa_url`
// field — which upstream is a GitHub *directory* listing, not a document
// (scripts/resolve-moa-documents.mjs resolves the real file(s) inside it
// into src/lib/data/moa-documents.json). Agencies WITH structured
// agreements already carry a correct per-model `pdf_url` blob link
// straight from the pipeline — this is a safe no-op passthrough for those,
// since a /blob/ URL simply won't be a key in this /tree/-keyed lookup.
type ResolvedDoc = { name: string; url: string; model: string | null };
const DOCS = moaDocuments as Record<string, ResolvedDoc[]>;

export function resolveMoaUrl(url: string | undefined, preferModel?: string | null): string | undefined {
  if (!url) return url;
  const files = DOCS[url];
  if (!files || files.length === 0) return url;
  const preferred = preferModel ? files.find((f) => f.model === preferModel) : null;
  return (preferred ?? files[0]).url;
}

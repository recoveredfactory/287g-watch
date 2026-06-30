# Per-agreement agreements index + UX — implementation plan

**Branch:** `agreements/per-agreement-index` (off `tory-split/moa-signers-fields`)
**Scope:** #2 cross-snapshot agreement index (the data foundation) + #3 per-agreement
"agreements on file" UX on the agency page.
**Status:** spec only — not yet implemented. This doc is the handoff for a fresh session.

---

## Why

An agency can hold multiple 287(g) agreements (one per model: JEM / TFM / WSO).
Today the pipeline collapses to **one** signed MOA per agency (`pickPdf` prefers
JEM > TFM > WSO > first) and the agency page shows that single agreement's ICE
signer, date, and public-affairs POC as if it were *the* agency's contact.

**That is sometimes wrong.** Proven example — Autauga County SO (AL), 3 agreements
signed the same day:

| model | public-affairs POC |
|---|---|
| JEM | Chief Deputy Tom Allen — tom.allen@autauga.com |
| TFM | Mark Harrell — mark.harrell@autauga.com |
| WSO | Sheriff Mark B. Harrell — mark.harrell@autauga.com |

The site shows only "Chief Deputy Tom Allen" (JEM) — but two of three agreements
name a different person.

## Hard constraints (measured — see "Empirical facts" below)

- The **archive itself is incomplete.** Even unioning all 83 snapshots, only **51%**
  of multi-model agencies have a PDF for every model; 34% partial, 15% none.
  **163 model-agreements have no signed PDF anywhere.** ICE's published roster
  (the source of the `models` array) lists models for which no MOA was posted.
- Therefore the per-agreement view can only ever be **"agreements on file"**, never
  "the agency's complete agreements." Frame all copy accordingly and never imply
  completeness.
- Divergence (the reason to do this) is a **minority**: ~5% of multi-PDF agencies
  differ on the POC; field office and ICE signer are almost always stable
  (agencies usually sign all models as a same-day bundle).

---

## Empirical facts (from the spike — keep for sanity checks)

- Archive repo: `appelson/Tracking_287g`, path
  `agreements/<snapshot>/<STATE_FULL>/<AGENCY_DIR>/<file>.pdf`.
- **83 snapshots**, and they are **incremental** — each snapshot folder contains
  only the PDFs *new* in that capture (latest had 31 PDFs, a mid-2025 one had 1).
  So a single folder is never the full picture; you must union across snapshots.
- File name encodes model + date: `..._JEM_MOA_09222025.pdf` (tags `_JEM_`/`_TFM_`/
  `_WSO_`; date `MMDDYY` or `MMDDYYYY`).
- Whole archive holds **1,691 PDFs** total across **1,434** agency folders.
- Coverage of the **234 multi-model agencies** unioned across all snapshots:
  full 119 (51%), partial 79 (34%), none 36 (15%). Missing-model tally:
  TFM 67, WSO 62, JEM 34.
- Re-pointing to a single newer snapshot does NOT help (they're incremental);
  unioning is required and lifts full coverage from ~27% (one folder) to ~51%.

---

## Architecture / data flow

```
appelson/Tracking_287g (83 incremental snapshots)
  │  [#2] build-agreement-index.ts  — union PDFs across ALL snapshots, per agency
  ▼
data/moa_agreements.json            agency_key -> [{model, pdf_url, sha, snapshot, date_filename}]
  │  [#1] extract-moa-signers.ts     — extract EVERY agreement PDF (not pickPdf)
  ▼
data/moa_extracts.json (reshaped)   agency_key -> { agreements: [{model, signer, title,
                                                     field_office, date_signed, poc_*, addendum_*}],
                                                     primary: <representative for summary cards> }
  │  [ingest §7b] ingest.ts          — attach agreements[]; keep top-level primary fields
  ▼
web/static/data/dist/agency_index.json   agency.agreements[] + existing primary fields
  │  [#3]
  ▼
agency/[slug]/+page.svelte          loop agreements grouped by model
```

Keep the existing **top-level** `ice_signer_name` / `moa_poc_*` / `ice_field_office`
fields populated from a chosen "primary" agreement so current consumers don't break
(map assets, OG bake, state/model pages, sitemap all read agency_index — grep first).

---

## Step-by-step

### #2 — cross-snapshot agreement index (do first; it's the foundation)
1. New `packages/pipeline/build-agreement-index.ts` (prototype already written —
   see `packages/pipeline/scratch/agreement-union.mjs`, copied from the spike).
   - List `agreements/` dirs (83), fetch each `git/trees/<sha>?recursive=1`,
     concurrency ~6, authenticated.
   - Per PDF: parse `STATE/AGENCY/file.pdf`, model tag, date from filename, blob sha.
   - Key agencies by `norm(state)|norm(agency)` where `norm = lower, strip non-alnum`
     (matches across snapshot folder-name drift).
   - Dedupe agreements by (model, normalized filename); if the same model recurs with
     different dates, keep all and let the UI show the newest (or all — decide).
   - Output `data/moa_agreements.json`. Log coverage stats; assert ≈51% full as a guard.
2. Add script to `packages/pipeline/package.json`: `"build:agreement-index": "tsx build-agreement-index.ts"`.

### #1 — per-agreement extraction (reshape extract-moa-signers)
3. Replace the single-`pickPdf` path: iterate **all** PDFs for an agency (from
   moa_agreements.json), run the existing `parseMoa(text)` per PDF, and emit an
   `agreements: [...]` array per agency. Reuse `downloadPdf` (blob API), `cleanSignerName`,
   `parseFieldOffice` (incl. the TFM pattern), `parseLeaPoc`, `parseAddendum` unchanged.
4. Choose a **primary** agreement for back-compat (mirror today's JEM>TFM>WSO>first)
   and keep emitting the flat fields the rest of the stack reads.
5. Keep it incremental + `--force`; keep blob-API downloads + concurrency.

### ingest
6. `ingest.ts` §7b: attach `a.agreements = ex.agreements`; keep mapping the primary
   into the existing flat fields. Add `a.agreement_coverage` = {onFile, modelsListed}
   so the UI can caption "N of M models on file".

### types + UX (#3)
7. `web/src/lib/homeData.types.ts`: add `Agreement` type + `agreements: Agreement[]`.
8. `web/src/routes/agency/[slug]/+page.svelte`:
   - Loop `agreements` grouped by model. Each shows signer / date / field office /
     public-affairs POC. When only one, render as today.
   - The "Public affairs contact (MOA)" block becomes per-agreement (label by model).
   - Add an "agreements on file" caption + a note when `onFile < modelsListed`.
9. i18n: new strings in `messages/en.json` + `messages/es.json` (mirror the existing
   `agency_pa_contact_*` keys). Spanish "press contact" = "prensa" per project pref.

---

## Environment / gotchas (read before running anything)

- **Token:** `GITHUB_TOKEN` lives in repo-root `.env`; `tsx` does NOT auto-load it.
  Run pipeline scripts as:
  `export GITHUB_TOKEN="$(grep -E '^GITHUB_TOKEN=' .env | head -1 | cut -d= -f2-)" && pnpm -F pipeline <script>`
- **Always `pnpm -F pipeline <script>`** (root has no such scripts).
- **Downloads:** use the authenticated git-blobs API
  (`api.github.com/repos/appelson/Tracking_287g/git/blobs/<sha>` + header
  `Accept: application/vnd.github.raw`). Do NOT use raw.githubusercontent.com — it
  throttles bursts and wedges. Concurrency ~6, `AbortSignal.timeout`.
- **pdftotext** (poppler) required: `pdftotext -layout`.
- **State naming:** archive paths use FULL state names (ALABAMA); agency_index/keys
  use 2-letter (AL). Normalize when joining.
- **ingest is slow** (~3-4 min: re-fetches snapshots + Census gazetteers) and writes
  to `web/static/data/dist/`. It only writes at the end, so a mid-run failure won't
  corrupt the served file.
- Dev server: `pnpm -F web dev` (Vite + SvelteKit, paraglide i18n). Agency page
  `fetch`es `/data/dist/agency_index.json` fresh per request — no restart after ingest.

---

## Acceptance criteria

- `moa_agreements.json` exists; coverage log ≈ 51% full / 34% partial / 15% none.
- Agencies with multiple agreements on file render each one (Autauga shows JEM/TFM/WSO
  with their distinct POCs).
- Copy uses "agreements on file" and captions "N of M models on file" when partial.
- Top-level flat fields still populated (no regression on map/OG/state/model pages).
- i18n parity (en + es) for all new strings.

## Tests to add (the "test empirically" ask)
- **Divergence check** `pnpm -F pipeline check:agreements`: per agency, flag where
  POC / signer differ across agreements; print count + list. Regression sentinel.
- **Golden parser tests:** committed fixture pdftotext `.txt` → expected
  `{signer, field_office, poc}` for `cleanSignerName` / `parseFieldOffice` / `parseLeaPoc`.
- **Render audit:** sample agency pages, diff displayed fields vs agency_index.json.

## Prototype scripts (preserved from the spike)
- `packages/pipeline/scratch/agreement-union.mjs` — cross-snapshot union (basis for #2).
- `packages/pipeline/scratch/agreement-divergence.mjs` — per-PDF POC divergence probe.
Both expect `GITHUB_TOKEN` exported and read `web/static/data/dist/agency_index.json`.

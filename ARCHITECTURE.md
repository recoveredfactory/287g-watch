# Architecture

## What this is

287(g) Explorer is a public-interest journalism tool tracking every local law enforcement agency that has signed a 287(g) agreement with ICE. Under Section 287(g) of the Immigration and Nationality Act, local sheriffs and police can sign deals authorizing their officers to perform federal immigration enforcement. The program expanded dramatically starting in 2017. As of mid-2026, roughly 1,500+ agencies have signed.

The project has two jobs: **ingest** and **display**.

---

## Packages

### `packages/pipeline`

A Node.js/TypeScript script that builds the agency dataset. Run with `pnpm pipeline`.

Steps:

1. Queries the GitHub API to list snapshot directories under [`appelson/Tracking_287g/sheets/`](https://github.com/appelson/Tracking_287g/tree/main/sheets)
2. Downloads the most recent xlsx file (snapshots land daily)
3. Parses and normalizes columns (full state names → abbreviations, date formatting, model deduplication)
4. Groups rows by `(state, agency name)` to produce one record per agency with all models listed
5. Geocodes each agency by county using centroids from the Census Bureau Gazetteer (ZIP file, TSV inside)
6. Writes `agency_index.json` to `packages/web/static/data/dist/`

The pipeline is a full rebuild every run — no incremental updates, no caching, no state.

**Data source note:** The `agreements.csv` at the root of the appelson repo is stale (last updated July 2025). Do not use it. The `sheets/` snapshots are current.

### `packages/web`

A SvelteKit 2 app. On each request, `+page.server.ts` fetches `agency_index.json` from the static asset bundle — the pipeline writes the file into `packages/web/static/data/dist/`, so it ships with the SvelteKit deploy. Refreshing the data means re-running the pipeline and redeploying.

Key routes:

| Route | Purpose |
|-------|---------|
| `/` | Hero stats, national MapLibre map, model explainers, search/filter/paginate |
| `/agency/[slug]` | Individual agency — name, location, models, signed date, MOA if available |
| `/glossary` | Key terms |
| `/about` | About the project |
| `/methodology` | How the data was collected and what's missing |

The map uses MapLibre GL with a CartoDB Positron basemap. Agencies are clustered at low zoom; individual colored dots at higher zoom. Color encodes primary model (Jail Enforcement, Task Force, Warrant Service).

### `sst.config.ts`

SST v3 configuration for AWS deployment. The SvelteKit app runs as a Lambda-backed site behind CloudFront (`svelte-kit-sst` adapter); the JSON data file is served as a static asset from that same CloudFront distribution. Two stages — `prod` and `staging` — with custom domains configured via `.env`.

Also defines `MapArchive`, a per-stage public S3 bucket for the downloadable map assets (see [Map assets & releasing](#map-assets--releasing)).

---

## Data flow

```
appelson/Tracking_287g (GitHub)
  └── sheets/sheets_YYYYMMDD_HHMMSS/participatingAgencies*.xlsx
        │
        ▼
  packages/pipeline/ingest.ts   (pnpm pipeline)
        │
        ▼
  packages/web/static/data/dist/agency_index.json
        │
        │  (bundled with the SvelteKit deploy)
        ▼
  SvelteKit +page.server.ts  (SSR fetch on each request)
        │
        ▼
  Browser — map + agency list
```

---

## Map assets & releasing

The downloadable map video/gif/png (the baked homepage timeline) do **not** ride in the site deploy. They live in a per-stage public S3 bucket (`MapArchive`), served via direct S3 URLs — no CloudFront, no custom domain (keeps clear of the account's CloudFront cache-policy quota, and the big files out of the deploy). Each cut is baked **per language** (the title/labels/watermark are injected by the bake, not read from the page), and the licensing page (`/use-the-map`) offers both language downloads on every page version. It reads `PUBLIC_MAP_ASSETS_URL` (set by SST per stage) and links the bucket's `-latest-<lang>` copies, falling back to bundled `/video/` in local dev.

Naming, per ICE release × language (`en`, `es`):

- `map-latest-<lang>.{mp4,gif,png}` — overwritten each release; short cache; linked publicly.
- `map-<release-date>-<hash8>-<lang>.{mp4,gif,png}` — immutable archive copy; long cache; **unlinked** (unguessable name).

**Release flow, per stage** (`staging` shown; repeat with `:prod`):

```
pnpm pipeline                                       # regenerate agency_index.json + terminated_agencies.json (GITHUB_TOKEN)
pnpm diff:staging                                   # sanity-check infra changes
pnpm deploy:staging                                 # site + MapArchive bucket
pnpm -F web bake:map-video --lang=en --url=…/en     # bake EN cut (add --still for a fast PNG-only check)
pnpm -F web bake:map-video --lang=es --url=…/es     # bake ES cut
pnpm publish:map-assets:staging                     # upload both langs: -latest + dated-hash archive
```

A warm xlsx cache makes the pipeline token-free and ~15s (`pnpm -F pipeline cache:warm`). The licensing-page video 404s in the window between `deploy` and `publish` (bucket is empty until published) — run them back-to-back.

---

## Data model

Each entry in `agency_index.json`:

```ts
{
  slug: string           // URL key: /agency/[slug]
  name: string           // display name, title-cased
  state: string          // 2-letter abbreviation (uppercase)
  county: string | null
  city: string | null    // not yet populated
  agency_type: string    // "County", "City", "State", etc.
  models: string[]       // one or more of the three 287(g) models
  primary_model: string | null  // highest-priority model present
  signed_date: string | null    // ISO "YYYY-MM-DD"
  population: null       // not currently populated
  lat: number | null     // from county centroid
  lng: number | null
  moa_url: string | null // MOA PDF link when available
  ori: null              // not in sheets data
  snapshot_date: string | null  // "YYYY-MM-DD" of the source snapshot
}
```

**Slug stability matters.** Slugs are used as permanent URL identifiers and may be linked externally. Changing slug generation logic is a breaking change.

---

## Key decisions

**Node.js pipeline, not Python.** The whole stack is TypeScript. Adding a Python runtime for a script this simple adds operational drag. If the pipeline ever needs scheduling or orchestration (Dagster, Airflow, prefect), it can be re-implemented in Python then. Not now.

**Static JSON, not a database.** The dataset is small (~1,500 agencies) and changes slowly. A flat JSON file is simple, cheap to host, and serves directly from a CDN with no query latency.

**County centroid geocoding.** The sheets data has no ZIP codes, so we geocode at the county level using the Census Bureau Gazetteer. This covers ~83% of agencies. The remainder (mostly territories and independent cities) appear in search but not on the map.

**No population data.** The sheets source doesn't include it. Could be re-added later via a crosswalk to the CSLLEA or another law enforcement census.

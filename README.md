# 287(g) Explorer

A public-interest journalism tool tracking local law enforcement agencies that have signed 287(g) agreements with ICE.

## Quick start

```bash
# Install dependencies
pnpm install

# Run the data pipeline (generates agency_index.json from appelson/Tracking_287g)
pnpm pipeline

# Start the local dev server (no AWS needed)
pnpm dev:web
```

Open [http://localhost:5173](http://localhost:5173).

## Project structure

```
packages/
  web/        SvelteKit app (map, agency pages, search, glossary)
  pipeline/   TypeScript scripts that pull and normalize 287(g) data
sst.config.ts SST v3 deployment config (AWS)
```

## Data pipeline

`pnpm pipeline` runs `packages/pipeline/ingest.ts`, which pulls from [appelson/Tracking_287g](https://github.com/appelson/Tracking_287g), merges contact data, and writes `packages/web/static/data/dist/agency_index.json`.

A `GITHUB_TOKEN` in `.env` (read-only GitHub token) is optional but recommended — it raises the GitHub API rate limit from 60 to 5,000 requests/hour. The pipeline runs unauthenticated without one, just more slowly.

## Contact data enrichment

Contact info (phone, address, website) is built from three sources in `packages/pipeline/data/`:

| File | What it contains | How to refresh |
|------|-----------------|----------------|
| `scraped_contacts.json` | Phone/address/website from state sheriff association sites + CO, ID, NH, WV scrapers | `cd packages/pipeline && pnpm exec tsx scrape-contacts.ts` |
| `wikidata_websites.json` | Official websites matched from Wikidata | `cd packages/pipeline && pnpm exec tsx build-wikidata-websites.ts` |
| `scraped_contacts.json` (websites) | Sheriff + police dept websites found via URL pattern testing | `cd packages/pipeline && pnpm exec tsx test-url-patterns.ts && pnpm exec tsx test-pd-patterns.ts` |

All three scripts are **idempotent** — they merge into the existing files and skip already-found entries, so you can re-run safely to pick up new data.

After refreshing any of these, re-run the full pipeline to rebuild `agency_index.json`:

```bash
pnpm pipeline
```

**Full refresh order** (if rebuilding from scratch):

```bash
cd packages/pipeline
pnpm exec tsx scrape-contacts.ts          # ~15 min, scrapes state sheriff association sites
pnpm exec tsx build-wikidata-websites.ts  # ~2 min, queries Wikidata SPARQL
pnpm exec tsx test-url-patterns.ts        # ~20 min, tests URL patterns for sheriff offices
pnpm exec tsx test-pd-patterns.ts         # ~20 min, tests URL patterns for police departments
cd ../..
pnpm pipeline                             # rebuilds agency_index.json
```

## Deployment

Uses [SST v3](https://sst.dev) on AWS, with two stages:

- `prod` — `287g.recoveredfactory.net`
- `staging` — `staging.287g.recoveredfactory.net`

The agency JSON ships as a static asset bundled with the SvelteKit build, so refreshing the data means re-running the pipeline and redeploying. Copy `.env.example` to `.env` and fill in the two domains.

```bash
cp .env.example .env
pnpm pipeline          # rebuild static/data/dist/agency_index.json
pnpm deploy:staging    # or: pnpm deploy:prod
```

Non-prod stages (including local dev) render an orange staging favicon and a persistent banner above the header, so it's hard to mistake for the real site.

## License

MIT — see [LICENSE](LICENSE).

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
  pipeline/   Python scripts that pull and normalize 287(g) data
sst.config.ts SST v3 deployment config (AWS)
```

## Data pipeline

The pipeline pulls from [appelson/Tracking_287g](https://github.com/appelson/Tracking_287g) and geocodes agencies by zip code. Output goes to `packages/web/static/data/dist/agency_index.json`.

```bash
cd packages/pipeline
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python ingest.py
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

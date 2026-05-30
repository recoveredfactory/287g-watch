import { env } from "$env/dynamic/public";

// OG/social card images live in the public asset bucket (PUBLIC_MAP_ASSETS_URL,
// set by SST per stage), kept out of the site deploy (~487MB of per-agency
// cards). Returns an absolute URL, as og:image requires. Falls back to the
// site origin for local dev — the cards aren't served locally, but og:image
// only matters to scrapers on the deployed site. See scripts/publish-og.mjs.
const FALLBACK_ORIGIN = "https://287g.recoveredfactory.net";

export function ogImage(file: string): string {
  const base = env.PUBLIC_MAP_ASSETS_URL || FALLBACK_ORIGIN;
  return `${base}/og/${file}`;
}

/**
 * Agency URLs that no longer exist, and where they went.
 *
 * Upstream spelled six Texas sheriff's offices with a curly apostrophe in one
 * row and a straight one in another. The pipeline keyed agencies on the raw
 * name, so each became two records, and the slug generator — which strips both
 * apostrophes — silently de-collided the twin as `…-tx-1` (#240). Deduping
 * removed the twins; the surviving record keeps the canonical slug.
 *
 * These URLs were in the sitemap, so they are indexable and possibly linked.
 * Send them to the record that absorbed them rather than 404.
 *
 * A one-time migration list, not a mechanism: it stays until the twins age out
 * of the index. If it ever needs a new entry, the pipeline's slug collision
 * warning is what should tell you.
 */
export const AGENCY_SLUG_REDIRECTS: Record<string, string> = {
  "calhoun-county-sheriffs-office-tx-1": "calhoun-county-sheriffs-office-tx",
  "galveston-county-sheriffs-office-tx-1": "galveston-county-sheriffs-office-tx",
  "goliad-county-sheriffs-office-tx-1": "goliad-county-sheriffs-office-tx",
  "grayson-county-sheriffs-office-tx-1": "grayson-county-sheriffs-office-tx",
  "lavaca-county-sheriffs-office-tx-1": "lavaca-county-sheriffs-office-tx",
  "wharton-county-sheriffs-office-tx-1": "wharton-county-sheriffs-office-tx",
};

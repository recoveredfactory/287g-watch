// Shared resolvers for the social-posting scripts: where the published video
// lives (the public MapArchive bucket), the ICE snapshot date for the caption,
// and the default Instagram caption. Kept in one place so the YouTube poster,
// the Instagram poster, and the "ready to publish" notifier all agree.
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(__dirname, "../static/data/dist/agency_index.json");

// Public base URL of the MapArchive bucket — resolved like publish-map-assets.mjs:
// explicit env, else the SST resource (under `sst shell`), else a bucket-name env.
export async function assetBaseUrl() {
  if (process.env.MAP_ASSETS_URL) return process.env.MAP_ASSETS_URL.replace(/\/+$/, "");
  try {
    const { Resource } = await import("sst");
    if (Resource?.MapArchive?.name) return `https://${Resource.MapArchive.name}.s3.amazonaws.com`;
  } catch {
    /* not under sst shell — fall through */
  }
  if (process.env.MAP_ARCHIVE_BUCKET) return `https://${process.env.MAP_ARCHIVE_BUCKET}.s3.amazonaws.com`;
  return null;
}

// The public `-latest` cut for a language, or an explicit override. null when the
// bucket can't be resolved (e.g. run outside `sst shell` with no env fallback).
export async function resolveVideoUrl(lang, override) {
  if (override) return override;
  const base = await assetBaseUrl();
  return base ? `${base}/map-trend-latest-${lang}.mp4` : null;
}

// Public video URL for the notification email. Prefers the IMMUTABLE per-release
// archive object (`map-trend-<date>-<hash>-<lang>.mp4`) when its key is known, so
// a delayed manual IG post links the exact cut this release published — `-latest`
// is overwritten by the next refresh and would drift. Falls back to `-latest`
// when no archive key is available. `override` wins over both.
export async function resolveArchiveUrl(lang, archiveKey, override) {
  if (override) return override;
  const base = await assetBaseUrl();
  if (!base) return null;
  return `${base}/${archiveKey || `map-trend-latest-${lang}.mp4`}`;
}

// ICE release date for the caption: explicit (flag), else $SNAPSHOT_DATE, else
// the latest snapshot_date in the local pipeline output, else null.
export function snapshotDate(explicit) {
  const e = explicit || process.env.SNAPSHOT_DATE;
  if (e) return e.slice(0, 10);
  if (existsSync(INDEX_PATH)) {
    try {
      const idx = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
      const d = idx.find((a) => a.snapshot_date)?.snapshot_date;
      if (d) return d.slice(0, 10);
    } catch {
      /* fall through to null */
    }
  }
  return null;
}

// Default Instagram caption — one field (no separate title), minimal and
// link-forward. Hashtags inline (IG: ≤30 tags, ≤2200 chars).
export function igCaption(date, site) {
  const asOf = date ? ` (data as of ${date})` : "";
  return [
    `287(g) agreements between local law enforcement and ICE, across the U.S.${asOf}`,
    "",
    `Explore the full tracker: https://${site}`,
    "",
    "#287g #ICE #immigration #data",
  ].join("\n");
}

// Publish the baked map assets to the public archive bucket (#118 follow-up).
//
// Run AFTER `pnpm bake:map-video`, through SST so the bucket name + AWS creds
// resolve:
//
//   pnpm publish:map-assets          # = sst shell node scripts/publish-map-assets.mjs
//
// Uploads the square map cut (map.{mp4,gif,png}) and, when present, the
// vertical map+trend social video (map-trend.{mp4,gif}, #167). For each file:
//   • <prefix>-latest-<lang>.<ext>          — overwritten every release; the
//                                             licensing page links these (short cache).
//   • <prefix>-<date>-<hash8>-<lang>.<ext>  — immutable archive copy per ICE
//                                             release, unguessable name, long
//                                             cache. Not linked — the archive.
//
// MVP: direct S3, no CloudFront/CDN. Bucket is `access: "public"` so its policy
// grants public read — no per-object ACL needed.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIDEO_DIR = resolve(__dirname, "../.assets/video");
const INDEX_PATH = resolve(__dirname, "../static/data/dist/agency_index.json");

// Bucket name: from the SST link when run via `sst shell`, else an env override.
async function bucketName() {
  try {
    const { Resource } = await import("sst");
    if (Resource?.MapArchive?.name) return Resource.MapArchive.name;
  } catch {
    /* not running under sst shell — fall through */
  }
  if (process.env.MAP_ARCHIVE_BUCKET) return process.env.MAP_ARCHIVE_BUCKET;
  throw new Error(
    "Can't resolve the archive bucket. Run via `pnpm publish:map-assets` (sst shell), " +
      "or set MAP_ARCHIVE_BUCKET=<bucket-name>.",
  );
}

// ICE release date = the latest snapshot date the pipeline recorded.
function releaseDate() {
  if (existsSync(INDEX_PATH)) {
    const idx = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
    const d = idx.find((a) => a.snapshot_date)?.snapshot_date;
    if (d) return d.slice(0, 10);
  }
  throw new Error(`No snapshot_date in ${INDEX_PATH} — run the pipeline first.`);
}

const LANGS = ["en", "es"];
const MP4 = { ext: "mp4", type: "video/mp4" };
const GIF = { ext: "gif", type: "image/gif" };
const PNG = { ext: "png", type: "image/png" };

// Each asset group bakes to `<prefix>-<lang>.<ext>` and publishes to
// `<prefix>-latest-<lang>.<ext>` (+ a dated-hash archive copy).
//   map        — the square, map-only cut (bake:map-video). Required.
//   map-trend  — the vertical map+trend social video (bake:map-trend-video,
//                #167). Optional: skipped with a note if it wasn't baked, so a
//                square-only publish still works.
const ASSETS = [
  { prefix: "map", bake: "map-video", required: true, formats: [MP4, GIF, PNG] },
  { prefix: "map-trend", bake: "map-trend-video", required: false, formats: [MP4, GIF] },
];

const bucket = await bucketName();
const date = releaseDate();
console.log(`Publishing to s3://${bucket} (release ${date})`);

const put = (localPath, key, type, cacheControl) =>
  execFileSync("aws", [
    "s3", "cp", localPath, `s3://${bucket}/${key}`,
    "--content-type", type,
    "--cache-control", cacheControl,
    "--only-show-errors",
  ], { stdio: ["ignore", "inherit", "inherit"] });

for (const asset of ASSETS) {
  for (const lang of LANGS) {
    for (const { ext, type } of asset.formats) {
      const file = resolve(VIDEO_DIR, `${asset.prefix}-${lang}.${ext}`);
      if (!existsSync(file)) {
        if (asset.required) {
          throw new Error(`Missing ${file} — run \`pnpm bake:${asset.bake} --lang=${lang} --url=…/${lang}\` first.`);
        }
        console.log(`  (skip) ${asset.prefix}-${lang}.${ext} — not baked`);
        continue;
      }
      const hash = createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 8);
      const latestKey = `${asset.prefix}-latest-${lang}.${ext}`;
      const archiveKey = `${asset.prefix}-${date}-${hash}-${lang}.${ext}`;

      put(file, latestKey, type, "public, max-age=300");
      put(file, archiveKey, type, "public, max-age=31536000, immutable");
      console.log(`  ${asset.prefix}-${lang}.${ext} → ${latestKey} + ${archiveKey}`);
    }
  }
}

console.log(`\nDone. Latest (en): https://${bucket}.s3.amazonaws.com/map-latest-en.mp4`);

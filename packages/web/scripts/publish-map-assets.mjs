// Publish the baked map assets to the public archive bucket (#118 follow-up).
//
// Run AFTER `pnpm bake:map-video`, through SST so the bucket name + AWS creds
// resolve:
//
//   pnpm publish:map-assets          # = sst shell node scripts/publish-map-assets.mjs
//
// Uploads each of map.{mp4,gif,png}:
//   • map-latest.<ext>            — overwritten every release; the licensing
//                                   page links these (short cache).
//   • map-<date>-<hash8>.<ext>    — immutable archive copy per ICE release,
//                                   unguessable name, long cache. Not linked
//                                   anywhere — that's the for-money archive.
//
// MVP: direct S3, no CloudFront/CDN. Bucket is `access: "public"` so its policy
// grants public read — no per-object ACL needed.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIDEO_DIR = resolve(__dirname, "../static/video");
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
const FORMATS = [
  { ext: "mp4", type: "video/mp4" },
  { ext: "gif", type: "image/gif" },
  { ext: "png", type: "image/png" },
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

for (const lang of LANGS) {
  for (const { ext, type } of FORMATS) {
    const path = resolve(VIDEO_DIR, `map-${lang}.${ext}`);
    if (!existsSync(path)) {
      throw new Error(`Missing ${path} — run \`pnpm bake:map-video --lang=${lang} --url=…/${lang}\` first.`);
    }
    const hash = createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 8);
    const latestKey = `map-latest-${lang}.${ext}`;
    const archiveKey = `map-${date}-${hash}-${lang}.${ext}`;

    put(path, latestKey, type, "public, max-age=300");
    put(path, archiveKey, type, "public, max-age=31536000, immutable");
    console.log(`  map-${lang}.${ext} → ${latestKey} + ${archiveKey}`);
  }
}

console.log(`\nDone. Latest (en): https://${bucket}.s3.amazonaws.com/map-latest-en.mp4`);

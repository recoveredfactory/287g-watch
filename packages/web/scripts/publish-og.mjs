// Publish baked OG/social cards to the public asset bucket, under og/ (#118).
// The cards (~1,600 per-agency PNGs, ~487MB) are baked to .assets/og and must
// NOT ride the site deploy — they live in the bucket and pages reference them
// via PUBLIC_MAP_ASSETS_URL (see src/lib/ogImage.ts).
//
// Run AFTER `pnpm bake:og`, through SST so the bucket + creds resolve:
//   pnpm publish:og:staging   (or :prod)
//
// aws s3 sync only uploads changed files; Content-Type is auto-guessed from the
// .png extension. No CloudFront — direct S3 is plenty for OG scraper traffic.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OG_DIR = resolve(__dirname, "../.assets/og");

async function bucketName() {
  try {
    const { Resource } = await import("sst");
    if (Resource?.MapArchive?.name) return Resource.MapArchive.name;
  } catch {
    /* not under sst shell — fall through */
  }
  if (process.env.MAP_ARCHIVE_BUCKET) return process.env.MAP_ARCHIVE_BUCKET;
  throw new Error(
    "Can't resolve the archive bucket. Run via `pnpm publish:og:<stage>` (sst shell), " +
      "or set MAP_ARCHIVE_BUCKET=<bucket-name>.",
  );
}

if (!existsSync(OG_DIR)) {
  throw new Error(`Missing ${OG_DIR} — run \`pnpm bake:og\` first.`);
}
const bucket = await bucketName();
console.log(`Syncing ${OG_DIR} → s3://${bucket}/og`);

execFileSync(
  "aws",
  [
    "s3", "sync", OG_DIR, `s3://${bucket}/og`,
    "--cache-control", "public, max-age=86400",
    "--no-progress",
  ],
  { stdio: ["ignore", "inherit", "inherit"] },
);
console.log(`\nDone. e.g. https://${bucket}.s3.amazonaws.com/og/home.png`);

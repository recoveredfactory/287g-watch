// Publish the vertical map+trend social video (#167) to Instagram as a Reel,
// via the Meta Graph API Content Publishing API (v25.0, Facebook-Login path).
//
// SAFE BY DEFAULT: this is a DRY RUN unless you pass --confirm. The dry run
// resolves the video URL + caption and prints the exact post it *would* make
// (and which IG account), then stops without publishing.
//
//   pnpm social:instagram:staging                      # dry run: plan only, no API calls
//   pnpm social:instagram:staging -- --container-only  # build + process the video, no publish
//   pnpm social:instagram:staging -- --confirm         # real PUBLIC post to the staging account
//
// ⚠️ NO PRIVATE MODE: unlike YouTube (which force-locks unverified uploads to
// private), Instagram has no private-post API — a --confirm post is PUBLIC the
// instant it publishes. The safety model is therefore: dry-run default + a
// BURNER account for staging + the prod required-reviewer gate. A staging
// --confirm posts a real public Reel to the burner; delete it after testing.
//
// Credentials come from the ENVIRONMENT (GitHub Actions environment secrets
// supply them per-stage — staging=burner account, prod=real account):
//   INSTAGRAM_ACCESS_TOKEN   per-account Page token (non-expiring; mint with
//                            instagram-auth.mjs)
//   INSTAGRAM_USER_ID        the IG Business account id the token posts as
//   INSTAGRAM_APP_SECRET     (optional, shared) — if set, appsecret_proof is
//                            attached to every call (required when the app has
//                            "Require app secret" on; harmless otherwise)
//
// The video is pulled from the public MapArchive bucket (the same `-latest` mp4
// the licensing page links). Instagram cURLs `video_url` server-side, so it MUST
// be a public HTTPS URL — the bucket is public. Override with --video-url.
//
// Flags:
//   --confirm              actually publish (default: dry run)
//   --container-only       create + process the Reels container, then STOP before
//                          publishing — validates the app, token, and video with
//                          nothing made public (an unused container expires in ~24h)
//   --lang <en|es>         which language cut to post (default: en)
//   --caption <s>          override the generated caption
//   --date <YYYY-MM-DD>    snapshot date for the caption (default: $SNAPSHOT_DATE
//                          env, else read from the local agency_index.json)
//   --video-url <url>      use this URL instead of resolving the bucket
//   --api-version <v>      Graph API version (default v25.0)
import { createHmac } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { notify } from "./social-notify.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(__dirname, "../static/data/dist/agency_index.json");

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const die = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const confirm = has("--confirm");
const containerOnly = has("--container-only");
const lang = valueOf("--lang") || "en";
const apiVersion = valueOf("--api-version") || "v25.0";
const stage = process.env.STAGE || process.env.SST_STAGE || "(unknown)";
const GRAPH = `https://graph.facebook.com/${apiVersion}`;

if (!["en", "es"].includes(lang)) die(`--lang must be en or es (got "${lang}").`);

// ICE release date for the caption: explicit flag, else env (CI job output),
// else read the local pipeline output, else omit.
function snapshotDate() {
  const explicit = valueOf("--date") || process.env.SNAPSHOT_DATE;
  if (explicit) return explicit.slice(0, 10);
  if (existsSync(INDEX_PATH)) {
    try {
      const idx = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
      const d = idx.find((a) => a.snapshot_date)?.snapshot_date;
      if (d) return d.slice(0, 10);
    } catch {
      /* fall through */
    }
  }
  return null;
}

// Public base URL of the MapArchive bucket — resolved like publish-map-assets.mjs.
async function assetBaseUrl() {
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

async function videoUrl() {
  const url = valueOf("--video-url");
  if (url) return url;
  const base = await assetBaseUrl();
  return base ? `${base}/map-trend-latest-${lang}.mp4` : null;
}

// Default caption — one field on IG (no separate title). Minimal, link-forward;
// the reviewer adjusts before posting. Hashtags inline (IG: ≤30, ≤2200 chars).
const SITE = process.env.WEB_DOMAIN || "287g.recoveredfactory.net";
function defaultCaption(date) {
  const asOf = date ? ` (data as of ${date})` : "";
  return [
    `287(g) agreements between local law enforcement and ICE, across the U.S.${asOf}`,
    "",
    `Explore the full tracker: https://${SITE}`,
    "",
    "#287g #ICE #immigration #data",
  ].join("\n");
}

const date = snapshotDate();
const caption = valueOf("--caption") || process.env.CAPTION_DESCRIPTION || defaultCaption(date);
const video = await videoUrl();

const token = process.env.INSTAGRAM_ACCESS_TOKEN;
const igUserId = process.env.INSTAGRAM_USER_ID;
const appSecret = process.env.INSTAGRAM_APP_SECRET;

// Graph requires appsecret_proof when the app has "Require app secret" enabled.
// Attach it whenever the secret is available — harmless if not required.
function withProof(params) {
  const p = new URLSearchParams(params);
  p.set("access_token", token);
  if (appSecret) p.set("appsecret_proof", createHmac("sha256", appSecret).update(token).digest("hex"));
  return p;
}

async function graphGet(path, fields) {
  const p = withProof({});
  if (fields) p.set("fields", fields);
  const res = await fetch(`${GRAPH}/${path}?${p}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `GET ${path} → ${res.status}`);
  return json;
}

async function graphPost(path, params) {
  const res = await fetch(`${GRAPH}/${path}`, { method: "POST", body: withProof(params) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `POST ${path} → ${res.status}`);
  return json;
}

// Best-effort: which IG account would this go to? Resolves only when creds are
// present. Never fatal — a no-creds caption preview must still work.
async function previewAccount() {
  if (!token || !igUserId) return "(set INSTAGRAM_ACCESS_TOKEN + INSTAGRAM_USER_ID to preview the account)";
  try {
    const me = await graphGet(igUserId, "username,name");
    return me.username ? `@${me.username}${me.name ? ` (${me.name})` : ""} [${igUserId}]` : `id ${igUserId}`;
  } catch (e) {
    return `(couldn't resolve: ${e?.message || e})`;
  }
}
const accountLine = await previewAccount();

// --- Print the plan (shown for both dry run and real post) -----------------
const mode = containerOnly
  ? "CONTAINER-ONLY (build + process, no publish)"
  : confirm
    ? "LIVE (--confirm)"
    : "DRY RUN (no --confirm)";
console.log(`\nInstagram Reel — ${mode}`);
console.log(`  stage:    ${stage}`);
console.log(`  account:  ${accountLine}`);
console.log(`  language: ${lang}`);
console.log(`  video:    ${video || "(UNRESOLVED — run via sst shell, or pass --video-url)"}`);
console.log("  caption:  |");
for (const line of caption.split("\n")) console.log(`    ${line}`);
if (confirm && !containerOnly)
  console.log("\n  ⚠️ Instagram has no private mode — this posts a PUBLIC Reel.");
if (containerOnly)
  console.log("\n  Container-only: builds + processes the video, then stops before publishing (nothing public).");

if (!confirm && !containerOnly) {
  console.log("\nDry run — nothing posted. Re-run with --container-only to build +");
  console.log("validate the container without publishing, or --confirm to post.\n");
  process.exit(0);
}

// --- Real publish (only past here with --confirm) --------------------------
if (!token || !igUserId)
  die("Missing INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_USER_ID in the environment.");
if (!video)
  die("Couldn't resolve the video. Run via `sst shell` (resolves MapArchive), or pass --video-url.");

try {
  // 1. Create the REELS media container (Instagram fetches video_url server-side).
  console.log(`\n▶ Creating media container for ${video}`);
  const { id: creationId } = await graphPost(`${igUserId}/media`, {
    media_type: "REELS",
    video_url: video,
    caption,
    share_to_feed: "true",
  });
  if (!creationId) die("No container id returned.");
  console.log(`  container: ${creationId}`);

  // 2. Poll status until FINISHED (Meta transcodes async; publishing early errors).
  console.log("▶ Waiting for Instagram to process the video…");
  const DEADLINE = Date.now() + 8 * 60 * 1000; // 8 min ceiling
  let status = "IN_PROGRESS";
  while (Date.now() < DEADLINE) {
    await sleep(8000);
    const s = await graphGet(creationId, "status_code,status");
    status = s.status_code;
    console.log(`  status: ${status}`);
    if (status === "FINISHED") break;
    if (status === "ERROR" || status === "EXPIRED")
      die(`Container ${status}: ${s.status || "(no detail)"}`);
  }
  if (status !== "FINISHED") die("Timed out waiting for the container to finish processing.");

  // Container-only: a FINISHED container proves the app, token, and video all
  // work end-to-end — that's the whole staging check. Stop before publishing;
  // nothing reaches the profile and the unused container expires in ~24h.
  if (containerOnly) {
    console.log(`\n✓ Container built and processed (id ${creationId}).`);
    console.log("  Nothing published — this never appears on the profile.");
    console.log("  Re-run with --confirm to actually post.\n");
    process.exit(0);
  }

  // 3. Publish.
  console.log("▶ Publishing");
  const { id: mediaId } = await graphPost(`${igUserId}/media_publish`, { creation_id: creationId });
  if (!mediaId) die("No media id returned from media_publish.");

  // 4. Fetch the permalink.
  let permalink = `https://www.instagram.com/ (media ${mediaId})`;
  try {
    const m = await graphGet(mediaId, "permalink");
    if (m.permalink) permalink = m.permalink;
  } catch {
    /* non-fatal — we still posted */
  }

  console.log(`\n✓ Posted: ${permalink}`);
  await notify({
    platform: "instagram",
    status: "posted",
    stage,
    url: permalink,
    detail: `lang=${lang}, account=${accountLine}`,
  });
} catch (e) {
  die(`Instagram publish failed: ${e?.message || e}`);
}

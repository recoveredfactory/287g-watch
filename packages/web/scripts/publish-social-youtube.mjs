// Upload the vertical map+trend social video (#167) to YouTube as a Short.
//
// SAFE BY DEFAULT: this is a DRY RUN unless you pass --confirm. The dry run
// resolves the video URL and prints the exact caption (title/description/tags/
// privacy) it *would* post — so you can eyeball and adjust the caption before
// anything goes out — then stops without authenticating or uploading.
//
//   # dry run — prints the planned post, uploads nothing:
//   pnpm social:youtube:staging
//   # real upload to the channel behind YOUTUBE_REFRESH_TOKEN:
//   pnpm social:youtube:staging -- --confirm
//
// Credentials come from the ENVIRONMENT (so GitHub Actions environment secrets
// supply them per-stage — staging=burner channel, prod=real channel; the script
// never sees the other stage's token):
//   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET  — the OAuth app (shared)
//   YOUTUBE_REFRESH_TOKEN                      — per-account; mint with youtube-auth.mjs
//
// The video is pulled from the public MapArchive bucket (the same `-latest` mp4
// the licensing page links), resolved like publish-map-assets.mjs. Override with
// --file <path> (local) or --video-url <url>.
//
// PRIVACY: defaults to `private`. Note YouTube force-locks uploads from an
// UNVERIFIED API project to private regardless — going public needs Google's
// API audit (or a manual flip in YT Studio). So --privacy public is best-effort.
//
// Flags:
//   --confirm              actually upload (default: dry run)
//   --lang <en|es>         which language cut to post (default: en)
//   --privacy <p>          private | unlisted | public (default: private)
//   --title <s>            override the generated title
//   --description <s>      override the generated description
//   --date <YYYY-MM-DD>    snapshot date for the caption (default: $SNAPSHOT_DATE
//                          env, else read from the local agency_index.json)
//   --file <path>          upload a local file instead of fetching from S3
//   --video-url <url>      fetch this URL instead of resolving the bucket
import { execFileSync } from "node:child_process";
import { createReadStream, readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
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

const confirm = has("--confirm");
const lang = valueOf("--lang") || "en";
const privacy = valueOf("--privacy") || "private";
const stage = process.env.STAGE || process.env.SST_STAGE || "(unknown)";

if (!["en", "es"].includes(lang)) die(`--lang must be en or es (got "${lang}").`);
if (!["private", "unlisted", "public"].includes(privacy))
  die(`--privacy must be private | unlisted | public (got "${privacy}").`);

// ICE release date for the caption: explicit flag, else env (CI passes it as a
// job output), else read the local pipeline output, else a placeholder.
function snapshotDate() {
  const explicit = valueOf("--date") || process.env.SNAPSHOT_DATE;
  if (explicit) return explicit.slice(0, 10);
  if (existsSync(INDEX_PATH)) {
    try {
      const idx = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
      const d = idx.find((a) => a.snapshot_date)?.snapshot_date;
      if (d) return d.slice(0, 10);
    } catch {
      /* fall through to placeholder */
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

// Where the video bytes come from: a local file, an explicit URL, or the
// resolved bucket's `-latest` cut for this language.
async function videoSource() {
  const file = valueOf("--file");
  if (file) return { kind: "file", value: resolve(file) };
  const url = valueOf("--video-url");
  if (url) return { kind: "url", value: url };
  const base = await assetBaseUrl();
  if (base) return { kind: "url", value: `${base}/map-trend-latest-${lang}.mp4` };
  return { kind: "unresolved", value: null };
}

// Default caption — deliberately minimal and link-forward; the reviewer adjusts
// it before posting (that's the point of the gate). No headline stats here:
// claims about counts belong in copy a human signed off on.
const SITE = process.env.WEB_DOMAIN || "287g.recoveredfactory.net";
function defaultCaption(date) {
  const asOf = date ? ` (data as of ${date})` : "";
  const title = `287(g) agreements across the U.S.${asOf}`;
  const description = [
    `An animated map of local law-enforcement agencies with active 287(g) agreements with ICE${asOf}.`,
    "",
    `Explore the full tracker: https://${SITE}`,
    "",
    "#287g #ICE #immigration",
  ].join("\n");
  return { title, description };
}

const date = snapshotDate();
const base = defaultCaption(date);
const title = valueOf("--title") || process.env.CAPTION_TITLE || base.title;
const description = valueOf("--description") || process.env.CAPTION_DESCRIPTION || base.description;
const tags = ["287g", "ICE", "immigration", "data", "map"];

const src = await videoSource();

// Best-effort: which channel would this go to? Resolves only when creds are
// present and the token carries read scope (minted by youtube-auth.mjs). Never
// fatal — a no-creds caption preview must still work.
async function previewChannel() {
  const id = process.env.YOUTUBE_CLIENT_ID;
  const secret = process.env.YOUTUBE_CLIENT_SECRET;
  const token = process.env.YOUTUBE_REFRESH_TOKEN;
  if (!id || !secret || !token) return "(set YOUTUBE_* in env/.env to preview the channel)";
  try {
    const { auth: googleAuth, youtube: youtubeApi } = await import("@googleapis/youtube");
    const oauth2 = new googleAuth.OAuth2(id, secret);
    oauth2.setCredentials({ refresh_token: token });
    const yt = youtubeApi({ version: "v3", auth: oauth2 });
    const { data } = await yt.channels.list({ part: ["snippet"], mine: true });
    const ch = data.items?.[0];
    return ch ? `${ch.snippet.title} (${ch.id})` : "(token valid, but no channel returned)";
  } catch (e) {
    return `(couldn't resolve: ${e?.message || e})`;
  }
}
const channelLine = await previewChannel();

// --- Print the plan (shown for both dry run and real upload) ---------------
console.log(`\nYouTube Short upload — ${confirm ? "LIVE (--confirm)" : "DRY RUN (no --confirm)"}`);
console.log(`  stage:       ${stage}`);
console.log(`  channel:     ${channelLine}`);
console.log(`  language:    ${lang}`);
console.log(`  privacy:     ${privacy}${privacy === "public" ? "  (unverified API projects force private — best-effort)" : ""}`);
console.log(`  video:       ${src.kind === "unresolved" ? "(UNRESOLVED — run via sst shell, or pass --file / --video-url)" : src.value}`);
console.log(`  title:       ${title}`);
console.log("  description: |");
for (const line of description.split("\n")) console.log(`    ${line}`);
console.log(`  tags:        ${tags.join(", ")}`);

if (!confirm) {
  console.log("\nDry run — nothing uploaded. Re-run with --confirm to post to the");
  console.log("channel behind YOUTUBE_REFRESH_TOKEN. Adjust copy with --title/--description.\n");
  process.exit(0);
}

// --- Real upload (only past here with --confirm) ---------------------------
const clientId = process.env.YOUTUBE_CLIENT_ID;
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
if (!clientId || !clientSecret || !refreshToken)
  die("Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN in the environment.");
if (src.kind === "unresolved")
  die("Couldn't resolve the video. Run via `sst shell` (resolves MapArchive), or pass --file / --video-url.");

// Get the bytes onto local disk so we can stream a known-length file.
let localPath;
if (src.kind === "file") {
  if (!existsSync(src.value)) die(`No such file: ${src.value}`);
  localPath = src.value;
} else {
  console.log(`\n▶ Fetching ${src.value}`);
  const res = await fetch(src.value);
  if (!res.ok) die(`Fetch failed (${res.status}) for ${src.value}`);
  localPath = resolve(tmpdir(), `map-trend-${lang}.mp4`);
  writeFileSync(localPath, Buffer.from(await res.arrayBuffer()));
}

// @googleapis/youtube is imported lazily so the dry run needs no dependency.
console.log("▶ Authenticating");
const { auth: googleAuth, youtube: youtubeApi } = await import("@googleapis/youtube");
const oauth2 = new googleAuth.OAuth2(clientId, clientSecret);
oauth2.setCredentials({ refresh_token: refreshToken });
const youtube = youtubeApi({ version: "v3", auth: oauth2 });

console.log("▶ Uploading");
const { data } = await youtube.videos.insert({
  part: ["snippet", "status"],
  requestBody: {
    snippet: { title, description, tags, categoryId: "25" }, // 25 = News & Politics
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
  },
  media: { body: createReadStream(localPath) },
});

const videoUrl = `https://youtu.be/${data.id}`;
console.log(`\n✓ Uploaded: ${videoUrl}  (privacy: ${data.status?.privacyStatus})`);
if (data.status?.privacyStatus !== privacy)
  console.log(`  Note: requested "${privacy}" but YouTube set "${data.status?.privacyStatus}" (unverified project → private until audited).`);

// Best-effort email notification (never fails the post — see social-notify.mjs).
await notify({
  platform: "youtube",
  status: "posted",
  stage,
  url: videoUrl,
  detail: `lang=${lang}, privacy=${data.status?.privacyStatus}, channel=${channelLine}`,
});

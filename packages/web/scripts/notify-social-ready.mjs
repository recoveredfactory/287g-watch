// Email the human the two manual steps to FINISH a release, after the data
// refresh + bake have published a fresh map+trend video (#167):
//
//   1. Instagram — grab the public video URL and post it as a Reel by hand.
//      (We don't auto-post IG for now; it's manual.)
//   2. YouTube  — the pipeline already uploaded it PRIVATELY to the prod
//      channel; here's the Studio "publish" page to review and make it public.
//
// Safe/quiet by design: it sends via social-notify.sendEmail, which is
// best-effort (logs and swallows on any SES/config error, never throws). It
// always sends — even if the YouTube upload failed (no id), so you still get
// the Instagram link; the YouTube section then points you at the run logs.
//
//   pnpm social:notify-ready:prod -- --lang=en --youtube-id <id>
//
// Flags:
//   --lang <en|es>        which cut the post uses (default: en)
//   --youtube-id <id>     the just-uploaded video id (omit if the upload failed)
//   --youtube-url <url>   override the watch URL (default: https://youtu.be/<id>)
//   --date <YYYY-MM-DD>   snapshot date for the caption (default: $SNAPSHOT_DATE / data)
//   --archive-en <key>    immutable per-release object key for the en cut (e.g.
//                         map-trend-2026-06-24-ab12cd34-en.mp4). CI passes this so
//                         the IG link is pinned to this release, not the moving
//                         -latest. --archive-es likewise. Omitted → -latest.
//   --video-url <url>     override the primary IG video URL entirely
import { sendEmail } from "./social-notify.mjs";
import { resolveArchiveUrl, snapshotDate, igCaption } from "./social-assets.mjs";

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

const lang = valueOf("--lang") || "en";
const stage = process.env.STAGE || process.env.SST_STAGE || "(unknown)";
const SITE = process.env.WEB_DOMAIN || "287g.recoveredfactory.net";
const date = snapshotDate(valueOf("--date"));

// A blank --youtube-id (CI passes "" when the upload step failed) means "no upload".
const ytId = (valueOf("--youtube-id") || "").trim();
const ytWatch = valueOf("--youtube-url") || (ytId ? `https://youtu.be/${ytId}` : "");
const ytStudio = ytId ? `https://studio.youtube.com/video/${ytId}/edit` : "";

// Link the immutable per-release archive URL (not the moving -latest) so a
// delayed manual IG post still grabs the exact video this release was about;
// falls back to -latest when the archive key wasn't passed. Other language too.
const otherLang = lang === "en" ? "es" : "en";
const archiveKey = (l) => valueOf(`--archive-${l}`);
const igVideo = await resolveArchiveUrl(lang, archiveKey(lang), valueOf("--video-url"));
const igVideoOther = await resolveArchiveUrl(otherLang, archiveKey(otherLang), null);
const caption = igCaption(date, SITE);

const asOf = date ? ` (data as of ${date})` : "";
const subject = `[287g social] 📹 New video ready${date ? ` — ${date}` : ""} — your move (${stage})`;

const lines = [
  `A fresh 287(g) map + trend video was baked and published${asOf}.`,
  "Two manual steps to finish the release:",
  "",
  "1) INSTAGRAM — grab this video and post it as a Reel by hand:",
  `   Video:    ${igVideo || "(unresolved — check the MapArchive bucket)"}`,
];
if (igVideoOther) lines.push(`   ${lang === "en" ? "Español:" : "English:"}  ${igVideoOther}`);
lines.push("   Suggested caption:");
for (const c of caption.split("\n")) lines.push(`     ${c}`);
lines.push("");
if (ytStudio) {
  lines.push("2) YOUTUBE — uploaded privately to the prod channel; review & publish:");
  lines.push(`   Publish:  ${ytStudio}`);
  lines.push(`   Watch:    ${ytWatch}`);
} else {
  lines.push("2) YOUTUBE — the automatic upload did NOT complete (see the workflow run logs).");
  lines.push("   Re-run the workflow, or upload the cut above to the channel by hand.");
}
lines.push("", "— 287(g) Watch social pipeline (#167)");

await sendEmail({ subject, body: lines.join("\n") });

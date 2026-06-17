// Email notifier for the social-posting pipeline (#167). Sends a short email
// via Amazon SES when a real post goes out (with its live URL) or when a post
// job fails. Importable by the publish scripts, and runnable as a CLI so the
// workflow can fire a failure notice in an `if: failure()` step.
//
// SAFE/QUIET BY DESIGN: notifying is best-effort. A missing config or an SES
// error NEVER throws back into the caller — a video that posted successfully
// must not be reported as failed just because the email didn't send. The
// failure is logged and swallowed.
//
// The sender is managed by SST (`sst.aws.Email` named "Notify" in
// sst.config.ts) and resolved from `Resource.Notify.sender` when running under
// `sst shell`; NOTIFY_EMAIL_FROM overrides it for non-SST contexts.
//
// Config (env, all optional — if there's no resolvable sender or no TO, this
// no-ops with a log so dry runs and local runs without SES don't break):
//   NOTIFY_EMAIL_FROM   override sender (else Resource.Notify.sender)
//   NOTIFY_EMAIL_TO      recipient(s), comma-separated
//   AWS_REGION           SES region (default us-east-1)
//
// As a library:
//   import { notify } from "./social-notify.mjs";
//   await notify({ platform: "youtube", status: "posted", stage: "prod",
//                  url: "https://youtu.be/…", detail: "lang=en" });
//
// As a CLI (used by the workflow's failure step):
//   node social-notify.mjs --platform youtube --status failed --stage prod \
//     --detail "see the run logs"
import { fileURLToPath } from "node:url";

const STATUS_PREFIX = {
  posted: "✅ Posted",
  failed: "❌ Post FAILED",
  skipped: "⏭️ Skipped",
};

// Build the subject + body once, so the CLI and library paths read identically.
function render({ platform, status, stage, url, detail }) {
  const label = STATUS_PREFIX[status] || status;
  const plat = (platform || "social").toUpperCase();
  const subject = `[287g social] ${label} — ${plat} (${stage || "?"})`;
  const lines = [
    `Platform: ${plat}`,
    `Stage:    ${stage || "(unknown)"}`,
    `Status:   ${status}`,
  ];
  if (url) lines.push(`URL:      ${url}`);
  if (detail) lines.push(`Detail:   ${detail}`);
  lines.push("", "— 287(g) Watch social pipeline (#167)");
  return { subject, body: lines.join("\n") };
}

// Sender precedence: explicit env override, else the SST-managed identity
// (Resource.Notify.sender, present under `sst shell`).
async function resolveSender() {
  if (process.env.NOTIFY_EMAIL_FROM) return process.env.NOTIFY_EMAIL_FROM;
  try {
    const { Resource } = await import("sst");
    if (Resource?.Notify?.sender) return Resource.Notify.sender;
  } catch {
    /* not under sst shell — fall through */
  }
  return null;
}

export async function notify(opts) {
  const from = await resolveSender();
  const to = process.env.NOTIFY_EMAIL_TO;
  const { subject, body } = render(opts);

  // Always echo to the job log, so there's a record even when email is off.
  console.log(`\n[notify] ${subject}`);
  for (const line of body.split("\n")) console.log(`[notify]   ${line}`);

  if (!from || !to) {
    const missing = [!from && "sender (Resource.Notify.sender / NOTIFY_EMAIL_FROM)", !to && "NOTIFY_EMAIL_TO"]
      .filter(Boolean)
      .join(" + ");
    console.log(`[notify] no ${missing} — logged only, no email sent.`);
    return { sent: false, reason: "unconfigured" };
  }

  try {
    const { SESv2Client, SendEmailCommand } = await import("@aws-sdk/client-sesv2");
    const client = new SESv2Client({ region: process.env.AWS_REGION || "us-east-1" });
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: to.split(",").map((s) => s.trim()).filter(Boolean) },
        Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: body } } } },
      }),
    );
    console.log("[notify] email sent.");
    return { sent: true };
  } catch (e) {
    // Best-effort: log and swallow, never fail the caller.
    console.log(`[notify] email send failed (non-fatal): ${e?.message || e}`);
    return { sent: false, reason: "send-error" };
  }
}

// CLI entry — only when run directly (not when imported).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const valueOf = (flag) => {
    const eq = args.find((a) => a.startsWith(`${flag}=`));
    if (eq) return eq.slice(flag.length + 1);
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  await notify({
    platform: valueOf("--platform"),
    status: valueOf("--status") || "failed",
    stage: valueOf("--stage") || process.env.STAGE,
    url: valueOf("--url"),
    detail: valueOf("--detail"),
  });
}

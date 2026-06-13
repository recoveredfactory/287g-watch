// One-time helper: mint a YouTube refresh token via a localhost OAuth consent.
//
// Run this ONCE per account (your burner channel for staging, the real channel
// for prod). It opens a consent page, you sign in AS THAT CHANNEL'S Google
// account, approve, and it prints a refresh token to stash as a secret.
//
//   YOUTUBE_CLIENT_ID=... YOUTUBE_CLIENT_SECRET=... \
//     node packages/web/scripts/youtube-auth.mjs
//
// Then save the printed token as the per-environment GitHub Actions secret:
//   gh secret set YOUTUBE_REFRESH_TOKEN --env staging   # paste burner token
//   gh secret set YOUTUBE_REFRESH_TOKEN --env prod       # paste real token
//
// Prereqs (Google Cloud, done by hand — see docs/SOCIAL_UPLOAD.md):
//   • a project with the YouTube Data API v3 enabled
//   • OAuth consent screen set to "In production" (else refresh tokens expire
//     after 7 days — fatal for an unattended pipeline)
//   • an OAuth client of type "Desktop app" → its client id + secret
//
// Flags: --port <n> (default 4180; must match an allowed redirect for the
// Desktop client — loopback http://localhost:<port> is allowed by default).
import { createServer } from "node:http";
import { execFile } from "node:child_process";

const args = process.argv.slice(2);
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

const clientId = process.env.YOUTUBE_CLIENT_ID || valueOf("--client-id");
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || valueOf("--client-secret");
if (!clientId || !clientSecret)
  die("Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET (env or --client-id/--client-secret).");

const port = Number(valueOf("--port") || 4180);
const redirectUri = `http://localhost:${port}`;

const { auth: googleAuth } = await import("@googleapis/youtube");
const oauth2 = new googleAuth.OAuth2(clientId, clientSecret, redirectUri);
const authUrl = oauth2.generateAuthUrl({
  access_type: "offline", // ask for a refresh token
  prompt: "consent", // force a fresh refresh token even if previously granted
  scope: ["https://www.googleapis.com/auth/youtube.upload"],
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("No ?code in callback.");
    return;
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { "content-type": "text/plain" }).end(
      "Got it. Refresh token printed in the terminal — you can close this tab.",
    );
    if (!tokens.refresh_token) {
      console.error(
        "\n✗ No refresh_token returned. Revoke prior access at " +
          "https://myaccount.google.com/permissions and re-run (consent must be fresh).\n",
      );
    } else {
      console.log("\n✓ Refresh token (save as the YOUTUBE_REFRESH_TOKEN secret):\n");
      console.log(tokens.refresh_token + "\n");
    }
  } catch (err) {
    res.writeHead(500).end("Token exchange failed; see terminal.");
    console.error("\n✗ Token exchange failed:", err?.message || err, "\n");
  } finally {
    server.close();
  }
});

server.listen(port, () => {
  console.log(`\nOpen this URL, sign in as the target channel's account, and approve:\n`);
  console.log(authUrl + "\n");
  console.log(`(Listening on ${redirectUri} for the callback…)\n`);
  // Best-effort auto-open; ignore if no opener is available (headless/WSL).
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  execFile(opener, [authUrl], () => {});
});

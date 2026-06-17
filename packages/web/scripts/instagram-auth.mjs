// One-time helper: mint a non-expiring Instagram Page token + resolve the IG
// Business account id, via a localhost Facebook-Login OAuth consent.
//
// Run ONCE per account (burner for staging, the real one for prod). It opens a
// Facebook consent page: sign in with the account that manages the Facebook
// Page linked to the target IG Business/Creator account, approve, and it prints
// the Page access token (which does NOT expire when derived from a long-lived
// user token) and the IG user id the token posts as.
//
//   INSTAGRAM_APP_ID=... INSTAGRAM_APP_SECRET=... \
//     node packages/web/scripts/instagram-auth.mjs
//
// Then save them as the per-environment GitHub Actions secrets:
//   gh secret set INSTAGRAM_ACCESS_TOKEN --env staging   # burner Page token
//   gh secret set INSTAGRAM_USER_ID      --env staging   # burner IG user id
//   gh secret set INSTAGRAM_ACCESS_TOKEN --env prod        # real Page token
//   gh secret set INSTAGRAM_USER_ID      --env prod        # real IG user id
//
// Prereqs (Meta app, done by hand — see docs/SOCIAL_UPLOAD.md):
//   • a Meta app with the "Facebook Login" product
//   • the target IG account is Business/Creator, linked to a Facebook Page
//   • http://localhost:<port> added to the app's Valid OAuth Redirect URIs
//   • your login holds an admin/dev/tester role on the app (Standard Access is
//     enough to post to an account you manage — no App Review needed)
//
// Flags:
//   --app-id / --app-secret   override the env creds
//   --port <n>                loopback port (default 4180; must match a Valid
//                             OAuth Redirect URI)
//   --api-version <v>         Graph API version (default v25.0)
//   --page <page-id>          pick a specific Page when you manage several
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
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

const appId = process.env.INSTAGRAM_APP_ID || valueOf("--app-id");
const appSecret = process.env.INSTAGRAM_APP_SECRET || valueOf("--app-secret");
if (!appId || !appSecret)
  die("Set INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET (env or --app-id/--app-secret).");

const port = Number(valueOf("--port") || 4180);
const apiVersion = valueOf("--api-version") || "v25.0";
const wantPage = valueOf("--page");
const redirectUri = `http://localhost:${port}`;
const GRAPH = `https://graph.facebook.com/${apiVersion}`;

// Scopes for content publishing on the Facebook-Login path. Standard Access
// covers these for an account you manage; no App Review required.
const scope = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
].join(",");

const authUrl =
  `https://www.facebook.com/${apiVersion}/dialog/oauth?` +
  new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, scope, response_type: "code" });

const proof = (tok) => createHmac("sha256", appSecret).update(tok).digest("hex");

async function getJson(url) {
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `${res.status} for ${url}`);
  return json;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get("code");
  if (!code) {
    const err = url.searchParams.get("error_description");
    res.writeHead(400).end(err ? `OAuth error: ${err}` : "No ?code in callback.");
    if (err) console.error(`\n✗ OAuth error: ${err}\n`);
    return;
  }
  try {
    // 1. code → short-lived user token
    const short = await getJson(
      `${GRAPH}/oauth/access_token?` +
        new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }),
    );
    // 2. short-lived → long-lived user token (~60d). Page tokens derived from
    //    it don't expire — that's what makes the pipeline unattended.
    const long = await getJson(
      `${GRAPH}/oauth/access_token?` +
        new URLSearchParams({
          grant_type: "fb_exchange_token",
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: short.access_token,
        }),
    );
    const userToken = long.access_token;

    // 3. list Pages + their (non-expiring) Page tokens + linked IG account
    const accounts = await getJson(
      `${GRAPH}/me/accounts?` +
        new URLSearchParams({
          fields: "name,id,access_token,instagram_business_account{id,username}",
          access_token: userToken,
          appsecret_proof: proof(userToken),
        }),
    );
    res.writeHead(200, { "content-type": "text/plain" }).end(
      "Got it. Token + IG id printed in the terminal — you can close this tab.",
    );

    const pages = (accounts.data || []).filter((p) => p.instagram_business_account);
    if (pages.length === 0) {
      console.error(
        "\n✗ No Page with a linked Instagram Business account was returned.\n" +
          "  Make sure the IG account is Business/Creator and linked to a Facebook\n" +
          "  Page you manage, and that you granted the Pages on the consent screen.\n",
      );
      return;
    }

    const chosen = wantPage ? pages.find((p) => p.id === wantPage) : pages.length === 1 ? pages[0] : null;
    if (!chosen) {
      console.log("\nYou manage several IG-linked Pages — re-run with --page <id> to pick one:\n");
      for (const p of pages)
        console.log(`  --page ${p.id}   ${p.name}  →  @${p.instagram_business_account.username}`);
      console.log("");
      return;
    }

    const ig = chosen.instagram_business_account;
    console.log(`\n✓ Posts as: @${ig.username}  (IG user id ${ig.id}) — via Page "${chosen.name}"`);
    console.log("  Wrong account? Re-run with --page <id>, or revoke at");
    console.log("  https://www.facebook.com/settings?tab=business_tools and re-auth.\n");
    console.log("Save these as the per-environment GitHub secrets (staging=burner, prod=real):\n");
    console.log(`  INSTAGRAM_USER_ID      = ${ig.id}`);
    console.log(`  INSTAGRAM_ACCESS_TOKEN = ${chosen.access_token}\n`);
    console.log("  (The Page token above does not expire. INSTAGRAM_APP_ID/APP_SECRET are");
    console.log("   shared repo-level secrets.)\n");
  } catch (err) {
    res.writeHead(500).end("Token exchange failed; see terminal.");
    console.error("\n✗ Failed:", err?.message || err, "\n");
  } finally {
    server.close();
  }
});

server.listen(port, () => {
  console.log("\nOpen this URL, sign in as the account that manages the Page, and approve:\n");
  console.log(authUrl + "\n");
  console.log(`(Listening on ${redirectUri} for the callback…)\n`);
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  execFile(opener, [authUrl.toString()], () => {});
});

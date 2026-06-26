# Social upload — YouTube + Instagram

Handles the vertical map+trend social video (`map-trend-latest-<lang>.mp4`,
baked by #167) on each data refresh:

- **YouTube** (Shorts) — **auto-uploaded PRIVATELY** to the prod channel.
- **Instagram** (Reels) — **manual for now.** The pipeline does *not* auto-post
  IG; instead it **emails you** the public video URL + a suggested caption to
  post by hand, alongside the YouTube Studio "publish" page for the upload.

So a data change lands one "your move" email: grab the video → post the IG Reel,
and click publish on the already-uploaded (private) YouTube Short. Nothing goes
public unattended.

Three parts below: the **YouTube** setup, then **Instagram**, then
**notifications**. The safety model and GitHub-Actions wiring are shared.

## Safety model

Why auto-running on every cron is safe — nothing reaches the public without you:

1. **Change gate** — the `data-refresh` workflow only acts when the dataset
   actually moved (no-op refreshes do nothing).
2. **YouTube is private** — an **unverified** Google API project force-locks
   every upload to **private**, even prod, until you pass Google's API audit. The
   auto-upload lands private; you flip it public from the Studio link in the email.
3. **Instagram isn't posted at all** — it's a manual step you do by hand from the
   email, so there's no automated public IG post to guard.
4. **Environment-scoped secret** — `YOUTUBE_REFRESH_TOKEN` is a *per-environment*
   secret. A `staging` run physically cannot read the `prod` channel's token.

`post_social` defaults to `post` (upload + email); pick `dry-run` on a manual
dispatch to print the YouTube plan and send no email.

## One-time setup (manual — mostly clicking)

### 1. Google Cloud project + OAuth app

1. New (or existing) Google Cloud project.
2. **APIs & Services → Library →** enable **YouTube Data API v3**.
3. **OAuth consent screen** (newer consoles call this **Google Auth Platform**).
   Two separate settings live here, asked at different moments — both matter:
   - **User type / Audience: choose External.** "Internal" only exists for
     Google Workspace *org* accounts; a personal `@gmail.com` only offers
     **External**. External + unverified is fine — uploads just stay private.
   - **Publishing status: In production** — a *separate explicit click* the
     console defaults OFF. Under **Audience**, click **Publish app → Push to
     production**. If you skip this the app stays in **Testing**, and consent
     fails with **`Error 403: access_denied` ("app is being tested… only
     developer-approved testers")** for anyone not on the Test-users list. Two
     more reasons to publish: in Testing, refresh tokens silently expire after
     **7 days** (fatal for an unattended pipeline); in production they don't.
   You do **not** submit anything for verification — leave it unverified. The
   first time you authorize you'll see a **"Google hasn't verified this app"**
   warning; click **Advanced → Go to <app> (unsafe)** to continue. Uploads stay
   locked to private regardless, so that's the feature, not a blocker.
4. **Credentials → Create credentials → OAuth client ID → Desktop app.** Copy
   the **client ID** and **client secret**.

### 2. The Brand Account channel

Use a **Brand Account** channel (not your personal one). Ownership can be added
or transferred later without re-uploading anything — the channel, its videos,
and the channel ID all survive; you just re-mint the refresh token as the new
owner. Use a **burner** Brand Account for staging and the real channel for prod.

You authorize with a normal Google login that *manages* the Brand Account. The
catch is binding the token to the brand channel and not your personal one — the
minter (next step) handles this: during consent YouTube shows a **"Choose a
channel"** screen (your personal channel plus every brand you manage); pick the
brand, and the minter prints back which channel the token landed on to confirm.

### 3. Mint a refresh token per channel

Creds can come from the env or `--client-id` / `--client-secret`:

```sh
YOUTUBE_CLIENT_ID=… YOUTUBE_CLIENT_SECRET=… \
  node packages/web/scripts/youtube-auth.mjs
```

It opens a consent page. Sign in → **pick the Brand Account** on the channel
chooser → approve. It then prints:

- **the channel the token acts as** — confirm this is the brand, not your
  personal channel. Wrong one? Revoke at
  https://myaccount.google.com/permissions and re-run, picking the brand.
- **the refresh token** — stash it (locally in `.env` for now; a GitHub secret
  later, when you automate).

(If it prints "no refresh_token", revoke at the link above and re-run — Google
only returns a refresh token on *fresh* consent.)

## Test locally first (before any GitHub wiring)

Put the three values in a gitignored `.env` at the repo root:

```sh
YOUTUBE_CLIENT_ID=…
YOUTUBE_CLIENT_SECRET=…
YOUTUBE_REFRESH_TOKEN=…
```

`sst shell` loads `.env`, so the pnpm scripts pick them up. **Dry run first** —
it prints the planned caption *and* the channel it would post as, and uploads
nothing:

```sh
pnpm social:youtube:staging                  # dry run: caption + channel, no upload
```

The `channel:` line confirms the token resolves to the brand account before you
ever upload. When it looks right, do a real (forced-private) upload to the
burner:

```sh
pnpm social:youtube:staging -- --confirm                 # to the burner channel
pnpm social:youtube:staging -- --confirm --file out.mp4  # upload a local bake
pnpm social:youtube:staging -- --title "Custom headline" # adjust the copy
```

Check it landed (as **private**) in that channel's YouTube Studio, then delete
the test upload. Only wire up GitHub once this local round-trip works.

> No `sst`/bucket locally? Skip `sst shell` and point at a public cut directly:
> `node --env-file=.env packages/web/scripts/publish-social-youtube.mjs --video-url https://<MapArchive>/map-trend-latest-en.mp4`

## Automate via GitHub Actions

Once local posting works, move the creds into GitHub so the `data-refresh`
workflow uploads on each data change.

```sh
# OAuth app — shared across both channels, so repo-level:
gh secret set YOUTUBE_CLIENT_ID
gh secret set YOUTUBE_CLIENT_SECRET

# Refresh token — per environment (Settings → Environments → staging / prod):
gh secret set YOUTUBE_REFRESH_TOKEN --env staging   # burner channel token
gh secret set YOUTUBE_REFRESH_TOKEN --env prod       # REAL channel token
```

> **Switching prod to the real channel:** re-run `youtube-auth.mjs`, pick the
> real Brand Account on the "Choose a channel" screen, confirm the printed
> `channel:` line is the real one, and set that token as the **prod** env secret
> (above) — and in root `.env` if you also run `social:youtube:prod` locally.

**What the workflow does** (Actions → Data refresh, and the twice-daily cron):

- On a data change it runs the `post-social` job, which **uploads the Short
  privately** to the channel behind that environment's `YOUTUBE_REFRESH_TOKEN`
  (prod for the cron), then emails you (next section) the Studio publish page.
- `post_social = post` (the default, and what the cron uses) does the upload.
  `post_social = dry-run` prints the plan and uploads nothing — and sends no
  email. Dry-run against **staging** to preview against the burner channel.

Adjust copy with `--title` / `--description` (or `CAPTION_TITLE` /
`CAPTION_DESCRIPTION` env). Default caption is intentionally minimal and
link-forward — headline stats belong in copy a human signed off on.

## Going public later

Either complete Google's **API audit** (lifts the private-only lock so the
pipeline can set `--privacy public`), or just flip individual uploads to public
in YouTube Studio.

---

# Instagram (Reels)

> **Manual for now.** The `data-refresh` workflow does **not** auto-post IG — it
> emails you the public video URL + caption to post by hand (see Notifications).
> The setup + scripts below still apply for **local/manual** posting and for
> re-enabling automation later: mint the token, then `social:instagram:*` posts
> on demand. (To re-enable auto-posting, add an Instagram step back to the
> `post-social` job — it was removed when IG went manual.)

Posts the same vertical cut as an Instagram **Reel** via the Meta Graph API
Content Publishing flow (v25.0): create a media container from the public
MapArchive URL → poll until processed → publish → read the permalink.

> ⚠️ **No private mode.** Unlike YouTube (which force-locks unverified uploads
> to private), Instagram has **no private-post API** — a `--confirm` post is
> **public the moment it publishes**. So the safety net is: dry-run default + a
> **burner IG account for staging** + the prod approval gate. A `staging`
> `--confirm` posts a real public Reel to the burner — delete it after testing.

## One-time setup (manual — mostly clicking)

### 1. Meta app + Facebook Login

1. **developers.facebook.com → Create app.** Type **Business**.
2. Add the **Facebook Login** product.
3. **App settings → Basic:** copy the **App ID** and **App secret** (these are
   the shared `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`).
4. **Facebook Login → Settings → Valid OAuth Redirect URIs:** add
   `http://localhost:4180` (the minter's loopback; localhost is allowed even in
   dev mode). Match `--port` if you change it.
5. **Standard Access is enough** — you do **not** need App Review or Live mode
   to post to an account you manage. Keep the app in **Development** mode; just
   make sure the account you'll authorize holds an **admin/developer/tester**
   role on the app (App roles → Roles).

### 2. The Instagram account + Facebook Page

The target IG account must be **Business or Creator** (personal accounts are
rejected) and **linked to a Facebook Page** you manage. Use a **burner** IG
Business account (its own throwaway Page) for staging and the real one for prod.

### 3. Mint a Page token + IG user id per account

Page tokens derived from a long-lived user token **don't expire**, so there's no
refresh cron to babysit:

```sh
INSTAGRAM_APP_ID=… INSTAGRAM_APP_SECRET=… \
  node packages/web/scripts/instagram-auth.mjs
```

It opens a Facebook consent page. Sign in as the account that manages the Page →
approve (grant the Pages it asks for). It then prints:

- **which IG account the token posts as** (`@username` + IG user id) — confirm
  it's the burner/real account you intended.
- the **`INSTAGRAM_USER_ID`** and the non-expiring **`INSTAGRAM_ACCESS_TOKEN`**
  (the Page token). Stash them (`.env` locally for now; GitHub secrets later).

(Manage several IG-linked Pages? It lists them; re-run with `--page <id>`.)

## Test locally first

Add to the gitignored root `.env` (alongside the YouTube + sender values):

```sh
INSTAGRAM_APP_ID=…
INSTAGRAM_APP_SECRET=…
INSTAGRAM_ACCESS_TOKEN=…   # the burner Page token, for local testing
INSTAGRAM_USER_ID=…         # the burner IG user id
```

**Dry run first** — prints the caption, the resolved video URL, and the IG
account it would post as; publishes nothing:

```sh
pnpm social:instagram:staging                 # dry run
```

When the `account:` line shows the burner, do a real (public!) post to it:

```sh
pnpm social:instagram:staging -- --confirm                 # posts a PUBLIC Reel
pnpm social:instagram:staging -- --caption "Custom copy"   # adjust the caption
```

Check it on the burner account, then delete it. Only wire up GitHub once this
round-trip works.

> No `sst`/bucket locally? Point at a public cut directly:
> `node --env-file=.env packages/web/scripts/publish-social-instagram.mjs --video-url https://<MapArchive>/map-trend-latest-en.mp4 --confirm`

## Automate via GitHub Actions (not wired right now)

IG is **manual** today — the workflow emails you to post by hand instead of
auto-posting. To re-enable automation later: mint the token, set the secrets,
and add an Instagram step back to the `post-social` job (mirroring the YouTube
upload step, `if: !cancelled()`).

```sh
# Meta app — shared across both accounts, so repo-level:
gh secret set INSTAGRAM_APP_ID
gh secret set INSTAGRAM_APP_SECRET

# Page token + IG user id — per environment:
gh secret set INSTAGRAM_ACCESS_TOKEN --env staging   # burner Page token
gh secret set INSTAGRAM_USER_ID      --env staging   # burner IG user id
gh secret set INSTAGRAM_ACCESS_TOKEN --env prod        # real Page token
gh secret set INSTAGRAM_USER_ID      --env prod        # real IG user id
```

---

# Notifications (email via Amazon SES)

On each data change the `post-social` job sends one **"your move"** email
(`notify-social-ready.mjs`): the public video URL + suggested caption to post to
Instagram by hand, and the YouTube Studio **publish** page for the private
upload. It always sends — even if the YouTube upload failed (you still get the
IG link; the YouTube section then points at the run logs). Sending is
**best-effort** — a missing config or SES error is logged and swallowed, never
throwing. A dry-run dispatch sends nothing.

(`social-notify.mjs` also exposes a structured per-post notice, used by the
`social:youtube/instagram:*` scripts on a real local post.)

## SES is a manually-verified domain identity

SES is **not** managed by SST here — the `sst.aws.Email` component's verify
waiter races DKIM propagation and self-destructs. Instead the domain
(`recoveredfactory.net`) is verified by hand (`aws sesv2 create-email-identity`
+ DKIM CNAMEs in Route53). `social-notify.mjs` resolves the sender from
**`NOTIFY_EMAIL_FROM`** (do **not** set `NOTIFY_EMAIL_SENDER` — its presence is
what re-triggers the broken SST Email resource).

Two SES caveats:

- **Sandbox.** A fresh SES account can only send to **verified** recipients
  until you request production access. For self-notifications, verify both the
  sender and your recipient address and you're set.
- **Send permission.** The role the `post-social` job assumes (the OIDC
  `sst-deployer` role) needs `ses:SendEmail`. Its base `sst-deployer-policy` is
  RF-asset-scoped and does **not** include SES, so a small scoped inline policy
  grants it (`ses-send-notify`: `ses:SendEmail` + `ses:SendRawEmail` on
  `arn:aws:ses:us-east-1:ACCOUNT_ID:identity/*`). Without it the send fails
  *non-fatally* — the post still succeeds, the email is just logged, not sent.
  Locally, `sst shell` uses your own AWS creds.

## Wire it up

```sh
gh variable set NOTIFY_EMAIL_FROM --body "alerts@recoveredfactory.net"  # verified sender
gh variable set NOTIFY_EMAIL_TO   --body "you@example.com"              # recipient(s), comma-sep
```

## Smoke-test locally

```sh
# 1. Render the "your move" email (logging-only without NOTIFY_EMAIL_FROM/TO):
MAP_ASSETS_URL=https://<MapArchive> WEB_DOMAIN=287g.recoveredfactory.net STAGE=prod \
  node packages/web/scripts/notify-social-ready.mjs --lang=en --youtube-id <id> --date 2026-06-24

# 2. Real send (needs AWS creds; in the SES sandbox both addrs must be verified):
NOTIFY_EMAIL_FROM=alerts@recoveredfactory.net NOTIFY_EMAIL_TO=you@verified.dev \
  MAP_ASSETS_URL=https://<MapArchive> STAGE=prod \
  node packages/web/scripts/notify-social-ready.mjs --lang=en --youtube-id <id>

# 3. Resolve the bucket via SST instead of MAP_ASSETS_URL:
NOTIFY_EMAIL_TO=you@verified.dev \
  sst shell --stage prod node packages/web/scripts/notify-social-ready.mjs --lang=en --youtube-id <id>
```

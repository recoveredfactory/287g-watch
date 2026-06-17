# Social upload — YouTube + Instagram

Auto-posts the vertical map+trend social video (`map-trend-latest-<lang>.mp4`,
baked by #167) to **YouTube** (Shorts) and **Instagram** (Reels). The harness —
dry-run default, per-environment account secrets, a prod approval gate, and an
SES email on every real post — is shared; TikTok slots in next the same way.

Three parts below: the **YouTube** setup, then **Instagram**, then
**notifications**. The safety model and GitHub-Actions wiring are shared.

## Safety model

Four independent layers, any one of which stops a real post:

1. **Change gate** — the `data-refresh` workflow only posts when the dataset
   actually moved (no-op refreshes post nothing).
2. **`post_social` toggle** — defaults to `dry-run`, which prints the exact
   caption (and the channel) it *would* post and uploads nothing. You must pick
   `post` on purpose.
3. **Environment-scoped secret** — `YOUTUBE_REFRESH_TOKEN` is a *per-environment*
   secret. A `staging` run physically cannot read the `prod` channel's token.
4. **prod approval gate** — a Required-reviewers rule on the `prod` environment
   means a real post waits for a manual approve (with an email ping).

On top of all that: an **unverified** Google API project force-locks every
upload to **private** — even prod — until you pass Google's API audit. So
"automatic" can't accidentally post something public.

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

## Automate via GitHub Actions (later)

Once local posting works, move the creds into GitHub so the `data-refresh`
workflow can post on a data change.

```sh
# OAuth app — shared across both channels, so repo-level:
gh secret set YOUTUBE_CLIENT_ID
gh secret set YOUTUBE_CLIENT_SECRET

# Refresh token — per environment (Settings → Environments → staging / prod):
gh secret set YOUTUBE_REFRESH_TOKEN --env staging   # burner channel token
gh secret set YOUTUBE_REFRESH_TOKEN --env prod       # real channel token
```

Then, in **Settings → Environments → prod**, add a **Required reviewers**
protection rule (yourself). Leave `staging` open so it iterates without prompts.

**From the workflow** (Actions → Data refresh → Run):

- `post_social = dry-run` (default): on any data change, the `post-social` job
  prints the caption + channel and uploads nothing. Dry-run against **staging**
  to preview without tripping the prod approval gate.
- `post_social = post`: adds `--confirm`. On **prod** it waits for your approval,
  then uploads to the real channel (private, per the audit rule above).

Adjust copy with `--title` / `--description` (or `CAPTION_TITLE` /
`CAPTION_DESCRIPTION` env). Default caption is intentionally minimal and
link-forward — headline stats belong in copy a human signed off on.

## Going public later

Either complete Google's **API audit** (lifts the private-only lock so the
pipeline can set `--privacy public`), or just flip individual uploads to public
in YouTube Studio.

---

# Instagram (Reels)

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

## Automate via GitHub Actions

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

The `post-social` job runs the YouTube and Instagram steps independently
(`if: !cancelled()`), so one platform failing doesn't block the other. Same
`post_social = dry-run | post` input gates both; prod still waits for the
required-reviewer approval.

---

# Notifications (email via Amazon SES)

Every **real** post emails a short notice with the live URL; a failed post job
emails too. Notifying is **best-effort** — a missing config or SES error never
fails a post that actually succeeded (it's logged and swallowed). Dry runs only
log the notification.

## SES is managed by SST

`sst.config.ts` declares an `sst.aws.Email("Notify")` identity, created at
deploy time when **`NOTIFY_EMAIL_SENDER`** is set (skipped otherwise, so a
deploy never requires it). `social-notify.mjs` resolves the sender from
`Resource.Notify.sender` under `sst shell`, or from `NOTIFY_EMAIL_FROM`.

```sh
# A single address → SST emails it a one-time confirmation link (click once):
NOTIFY_EMAIL_SENDER=alerts@recoveredfactory.net pnpm deploy:staging
# …or a domain → SST manages the DNS verification records.
```

Two SES caveats:

- **Sandbox.** A fresh SES account can only send to **verified** recipients
  until you request production access. For self-notifications, verify both the
  sender and your recipient address and you're set.
- **Send permission.** The role the `post-social` job assumes (the OIDC
  `sst-deployer` role) needs `ses:SendEmail`. Locally, `sst shell` uses your own
  AWS creds. Without the permission the send fails *non-fatally* (logged).

## Wire it up

```sh
gh variable set NOTIFY_EMAIL_SENDER --body "alerts@recoveredfactory.net"  # = the SST sender
gh variable set NOTIFY_EMAIL_TO      --body "you@example.com"              # recipient(s), comma-sep
```

## Smoke-test locally

```sh
# 1. Logging-only (no AWS) — verifies format/wiring, sends nothing:
node packages/web/scripts/social-notify.mjs --platform youtube --status posted \
  --stage staging --url https://youtu.be/test --detail "lang=en"

# 2. Real send (needs AWS creds; in the SES sandbox both addrs must be verified):
NOTIFY_EMAIL_FROM=you@verified.dev NOTIFY_EMAIL_TO=you@verified.dev \
  node packages/web/scripts/social-notify.mjs --platform youtube --status posted \
  --stage staging --url https://youtu.be/test

# 3. Via the SST-managed identity (after NOTIFY_EMAIL_SENDER is set + deployed):
NOTIFY_EMAIL_TO=you@verified.dev \
  sst shell --stage staging node packages/web/scripts/social-notify.mjs \
  --platform youtube --status posted --stage staging --url https://youtu.be/test
```
</content>
</invoke>

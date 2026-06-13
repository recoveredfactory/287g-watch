# Social upload — YouTube (Shorts)

Auto-posts the vertical map+trend social video (`map-trend-latest-<lang>.mp4`,
baked by #167) to YouTube. First platform of the IG / TikTok / YouTube set;
the harness (dry-run default, per-stage secrets, gated posting) generalizes to
the others.

## Safety model

Four independent layers, any one of which stops a real post:

1. **Change gate** — the `data-refresh` workflow only posts when the dataset
   actually moved (no-op refreshes post nothing).
2. **`post_social` toggle** — defaults to `dry-run`, which prints the exact
   caption it *would* post and uploads nothing. You must pick `post` on purpose.
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
3. **OAuth consent screen:** set publishing status to **In production**. (In
   "Testing" status, refresh tokens expire after 7 days — fatal for an unattended
   pipeline. "In production" + unverified is fine: uploads just stay private.)
4. **Credentials → Create credentials → OAuth client ID → Desktop app.** Copy
   the **client ID** and **client secret**.

### 2. The channels

Use a **Brand Account** channel — it can have owners added/transferred later
without re-uploading anything (the channel, videos, and channel ID survive; you
just re-mint the refresh token as the new owner). Use a **burner** Brand Account
for staging and the real channel for prod.

### 3. Mint a refresh token per channel

Run the helper once per account, signing in **as that channel's Google account**:

```sh
YOUTUBE_CLIENT_ID=… YOUTUBE_CLIENT_SECRET=… \
  node packages/web/scripts/youtube-auth.mjs
```

It opens a consent page and prints a refresh token. (If it prints "no
refresh_token", revoke the app at https://myaccount.google.com/permissions and
re-run — consent must be fresh.)

### 4. GitHub config

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

## Running it

**From the workflow** (Actions → Data refresh → Run):

- `post_social = dry-run` (default): on any data change, the `post-social` job
  prints the caption and uploads nothing. Dry-run against **staging** to preview
  a caption without tripping the prod approval gate.
- `post_social = post`: adds `--confirm`. On **prod** it waits for your approval,
  then uploads to the real channel (private, per the audit rule above).

**Locally** (resolves the bucket + creds via `sst shell` / env):

```sh
pnpm social:youtube:staging                       # dry run
pnpm social:youtube:staging -- --confirm          # real upload to burner
pnpm social:youtube:staging -- --file path.mp4    # upload a local file
pnpm social:youtube:prod -- --confirm --title "Custom headline"
```

Adjust copy with `--title` / `--description` (or `CAPTION_TITLE` /
`CAPTION_DESCRIPTION` env). Default caption is intentionally minimal and
link-forward — headline stats belong in copy a human signed off on.

## Going public later

Either complete Google's **API audit** (lifts the private-only lock so the
pipeline can set `--privacy public`), or just flip individual uploads to public
in YouTube Studio.

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
</content>
</invoke>

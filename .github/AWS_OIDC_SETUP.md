# Data-refresh Action — AWS OIDC + repo config

The `data-refresh.yml` workflow assumes an AWS IAM role via GitHub OIDC (no
long-lived keys), runs `pnpm pipeline`, and — if the dataset moved — deploys the
stage and re-bakes/publishes the map videos + OG cards. It can't run until the
role trusts GitHub and the repo's Actions secrets/variables are set. One-time
setup:

Account: `ACCOUNT_ID` · Repo: `recoveredfactory/287g-watch`

## 1. Create the GitHub OIDC provider (once per account)

The account has no OIDC provider yet, so add it:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

The thumbprint is no longer used for this provider (AWS validates against its
trusted CA store) but the API still requires the field. The IAM console
auto-fills it if you add the provider there instead.

## 2. Let GitHub assume the existing `sst-deployer` role (preferred)

Reuse the role we already deploy with — `arn:aws:iam::ACCOUNT_ID:role/sst-deployer`
(attached policy `sst-deployer-policy`, the RF-asset-scoped permission set). No
new role, no new permissions; we just add a second trust statement so the GitHub
OIDC provider can assume it, scoped to this repo's `main` branch. Its current
trust only allows `user/deploy-user` + `user/ci-deploy-user` — keep that, add OIDC
(`trust.json`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": [
          "arn:aws:iam::ACCOUNT_ID:user/deploy-user",
          "arn:aws:iam::ACCOUNT_ID:user/ci-deploy-user"
        ]
      },
      "Action": "sts:AssumeRole"
    },
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": [
            "repo:recoveredfactory/287g-watch:ref:refs/heads/main",
            "repo:recoveredfactory/287g-watch:environment:staging",
            "repo:recoveredfactory/287g-watch:environment:prod"
          ]
        }
      }
    }
  ]
}
```

```bash
aws iam update-assume-role-policy --role-name sst-deployer \
  --policy-document file://trust.json
```

Three `sub` values are trusted: the `refresh` job dispatches from `main`
(`:ref:refs/heads/main`), and the `post-social` job runs under an
`environment:` so GitHub mints an environment-scoped `sub` instead
(`:environment:staging` / `:environment:prod`) — both are needed or the
social step fails OIDC while the deploy succeeds.

This repo is **public**, so the `sub` list is the security boundary — keep it
pinned. Do NOT widen to `repo:recoveredfactory/287g-watch:*` to dispatch from a
feature branch: on a public repo that would let any pushed branch assume
`sst-deployer`. Dispatch from `main`. This accepts the known cross-project blast
radius of reusing `sst-deployer` (AWS is rebuildable; the OIDC `sub` condition
is the boundary that matters) — see the dedicated-role alternative below to
shrink it.

> **Renamed repo?** GitHub mints the OIDC `sub` from the repo's *current* name,
> while `git remote` keeps working via redirect — so a rename silently breaks
> assume-role with "Not authorized to perform sts:AssumeRoleWithWebIdentity"
> until you update these `sub` lines. (Bit us when `287g-explorer` →
> `287g-watch` rode along with open-sourcing.)

### Alternative: a new dedicated role

If you'd rather isolate this repo, create a fresh role with the same trust
statement (the OIDC half above) and attach permissions. Least-privilege for an
IaC role that also creates IAM is impractical, so attach a broad managed policy
to a dedicated role and let the trust scope bound it:

```bash
aws iam create-role --role-name 287g-github-deploy \
  --assume-role-policy-document file://trust.json   # just the OIDC statement
aws iam attach-role-policy --role-name 287g-github-deploy \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
# tighter: PowerUserAccess + IAMFullAccess
```

## 3. Set the repo's Actions secrets + variables

```bash
gh secret   set AWS_ROLE_ARN        --body "arn:aws:iam::ACCOUNT_ID:role/sst-deployer"
gh variable set WEB_STAGING_DOMAIN  --body "staging.287g.recoveredfactory.net"
gh variable set WEB_DOMAIN          --body "287g.recoveredfactory.net"
gh variable set AWS_REGION          --body "us-east-1"   # optional; this is the default
```

(If you went with the dedicated role, use its ARN for `AWS_ROLE_ARN`.)

## 4. Run it (staging first)

```bash
gh workflow run "Data refresh" --ref main -f stage=staging -f force=true
gh run watch
```

`force=true` bypasses the change gate so the run actually deploys + bakes +
publishes even when the upstream data hasn't moved — what you want for a test.
Drop `force` for real runs so an unchanged snapshot is a cheap no-op.

### Known staging-deploy traps (past burns)

- **SST Host-header trap:** don't swap `AllViewerExceptHostHeader` on the
  SvelteKit origin request policy — the Lambda Function URL rejects a mismatched
  `Host` (broke staging on #19).
- **CloudFront cache-policy quota:** the account is near the 20-policy limit; a
  fresh staging distribution can fail to create until some are freed.

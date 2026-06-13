# Data-refresh Action — AWS OIDC + repo config

The `data-refresh.yml` workflow assumes an AWS IAM role via GitHub OIDC (no
long-lived keys), runs `pnpm pipeline`, and — if the dataset moved — deploys the
stage and re-bakes/publishes the map videos + OG cards. It can't run until the
role exists and the repo's Actions secrets/variables are set. One-time setup:

Account: `647111127395` · Repo: `recoveredfactory/287g-explorer`

## 1. Create the GitHub OIDC provider (once per account)

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

The thumbprint is no longer used for this provider (AWS validates against its
trusted CA store) but the API still requires the field. If you add the provider
in the IAM console instead, it auto-fills it.

## 2. Create the deploy role

Trust policy — only this repo, only the `main` branch, can assume it
(`trust.json`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::647111127395:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:recoveredfactory/287g-explorer:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

The workflow is `workflow_dispatch` and the Action only appears once the file is
on the default branch (`main`), so dispatching from `main` is the normal path —
hence scoping `sub` to `refs/heads/main`. If you ever need to dispatch from
another branch, widen that line to `repo:recoveredfactory/287g-explorer:*`.

```bash
aws iam create-role --role-name 287g-github-deploy \
  --assume-role-policy-document file://trust.json
```

## 3. Attach permissions

SST (Pulumi) provisions Lambda, IAM, S3, CloudFront, ACM, Route53, and logs, and
the publish step writes to the MapArchive S3 bucket. Least-privilege for an IaC
deploy role that also creates IAM is impractical to hand-maintain, so the
pragmatic pattern is a broad managed policy on a **dedicated** role whose trust
policy (step 2) is the real boundary:

```bash
# Simplest — dedicated role, repo+branch-scoped trust:
aws iam attach-role-policy --role-name 287g-github-deploy \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

# Slightly tighter alternative (no org/account/billing actions):
#   arn:aws:iam::aws:policy/PowerUserAccess  +  arn:aws:iam::aws:policy/IAMFullAccess
```

Role ARN: `arn:aws:iam::647111127395:role/287g-github-deploy`

## 4. Set the repo's Actions secrets + variables

```bash
gh secret  set AWS_ROLE_ARN       --body "arn:aws:iam::647111127395:role/287g-github-deploy"
gh variable set WEB_STAGING_DOMAIN --body "staging.287g.recoveredfactory.net"
gh variable set WEB_DOMAIN         --body "287g.recoveredfactory.net"
gh variable set AWS_REGION         --body "us-east-1"   # optional; this is the default
```

## 5. Run it (staging first)

```bash
gh workflow run "Data refresh" --ref main -f stage=staging -f force=true
```

`force=true` bypasses the change gate so the run actually deploys + bakes +
publishes even when the upstream data hasn't moved — what you want for a test.
Drop `force` for real runs so an unchanged snapshot is a cheap no-op. Watch the
run with `gh run watch`.

### Known staging-deploy traps (past burns)

- **SST Host-header trap:** don't swap `AllViewerExceptHostHeader` on the
  SvelteKit origin request policy — the Lambda Function URL rejects a mismatched
  `Host` (broke staging on #19).
- **CloudFront cache-policy quota:** the account is near the 20-policy limit; a
  fresh staging distribution can fail to create until some are freed.

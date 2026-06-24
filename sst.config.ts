/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    const isProdStage = ["prod", "production"].includes(input?.stage);
    return {
      name: "tracking-287g",
      removal: isProdStage ? "retain" : "remove",
      protect: isProdStage,
      home: "aws",
    };
  },
  async run() {
    const isProdStage = ["prod", "production"].includes($app.stage);
    const isStagingStage = ["staging", "stage"].includes($app.stage);

    const localEnv = await (async () => {
      try {
        const { readFileSync, existsSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        const envPath = resolve(process.cwd(), ".env");
        if (!existsSync(envPath)) return {};
        const contents = readFileSync(envPath, "utf-8");
        const parsed: Record<string, string> = {};
        for (const line of contents.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const idx = trimmed.indexOf("=");
          if (idx === -1) continue;
          const key = trimmed.slice(0, idx).trim();
          let value = trimmed.slice(idx + 1).trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          parsed[key] = value;
        }
        return parsed;
      } catch {
        return {};
      }
    })();

    const env = { ...process.env, ...localEnv };

    const webDomain = isProdStage
      ? env.WEB_DOMAIN
      : isStagingStage
        ? env.WEB_STAGING_DOMAIN
        : undefined;

    // Custom origin request policy: forwards selected viewer headers (NOT Host,
    // because Lambda Function URLs reject mismatched Host) plus the CloudFront-
    // Viewer-Country/Region headers that /api/geo reads. `whitelist` is the only
    // mode that can both omit Host and add CloudFront-* headers — `allExcept`
    // can't add them, `allViewerAndWhitelistCloudFront` always forwards Host,
    // and CloudFront Functions can't strip Host (it's read-only in viewer-
    // request). Cookies and query strings forwarded separately below.
    const webOriginRequest = new aws.cloudfront.OriginRequestPolicy(
      "WebOriginRequest",
      {
        name: `${$app.name}-${$app.stage}-web`,
        comment:
          "All cookies/query, viewer headers except Host, plus CloudFront geo",
        cookiesConfig: { cookieBehavior: "all" },
        queryStringsConfig: { queryStringBehavior: "all" },
        headersConfig: {
          headerBehavior: "whitelist",
          headers: {
            // `accept-encoding` is intentionally omitted — CloudFront rejects it
            // in custom origin request policies ("not allowed") because it manages
            // compression negotiation itself via the cache policy's gzip/brotli
            // toggles. Trying to add it returns InvalidArgument at deploy time.
            items: [
              "accept",
              "accept-language",
              "content-type",
              "origin",
              "referer",
              "user-agent",
              // SST's auto-deployed viewer-request CloudFront Function copies
              // the viewer Host into x-forwarded-host so the svelte-kit-sst
              // Lambda handler can promote it back to `host` on the SSR side.
              // Without forwarding this, event.url.host becomes the Lambda
              // Function URL, and SSR fetches to /data/* miss S3.
              "x-forwarded-host",
              "cloudfront-viewer-country",
              "cloudfront-viewer-country-region",
            ],
          },
        },
      },
    );

    // Public bucket for the downloadable map assets (video/gif/png archive).
    // Served via direct S3 URLs — no custom domain, no CloudFront — to avoid
    // adding to the account's cache-policy quota and to keep the big files out
    // of the site deploy. `pnpm publish:map-assets` uploads a `-latest` copy
    // (linked from the licensing page) plus an immutable dated-hash archive
    // copy per ICE release. See packages/web/scripts/publish-map-assets.mjs.
    const mapArchive = new sst.aws.Bucket("MapArchive", { access: "public" });

    // SES identity for the social-posting pipeline's notifications (#190),
    // managed in IaC instead of hand-verified in the console. Set
    // NOTIFY_EMAIL_SENDER to a single address (e.g. alerts@recoveredfactory.net
    // → SST sends a one-time confirmation email) or a domain (→ SST manages the
    // DNS verification records). Skipped when unset, so a deploy never requires
    // it; social-notify.mjs reads `Resource.Notify.sender`. The address/domain
    // must clear the SES sandbox (verified, or production access) to send.
    const notifyEmail = env.NOTIFY_EMAIL_SENDER
      ? new sst.aws.Email("Notify", { sender: env.NOTIFY_EMAIL_SENDER })
      : undefined;

    new sst.aws.SvelteKit("Web", {
      path: "packages/web",
      domain: webDomain,
      warm: isProdStage ? 1 : 0,
      link: [mapArchive, ...(notifyEmail ? [notifyEmail] : [])],
      environment: {
        PUBLIC_STAGE: $app.stage,
        PUBLIC_MAP_ASSETS_URL: $interpolate`https://${mapArchive.domain}`,
      },
      transform: {
        cdn: {
          transform: {
            distribution: (args) => {
              (args.defaultCacheBehavior as any).originRequestPolicyId =
                webOriginRequest.id;
            },
          },
        },
      },
    });
  },
});

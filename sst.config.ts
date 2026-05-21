/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    const isProdStage = ["prod", "production"].includes(input?.stage);
    return {
      name: "287g-explorer",
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

    let dataRouter;
    if (isProdStage) {
      const dataBucketName = env.DATA_BUCKET_NAME;
      const dataBucketRegion = env.DATA_BUCKET_REGION || "us-east-2";
      const dataCdnDomain = env.DATA_CDN_DOMAIN;
      if (!dataBucketName) throw new Error("Missing DATA_BUCKET_NAME for data CDN setup.");
      if (!dataCdnDomain) throw new Error("Missing DATA_CDN_DOMAIN for data CDN setup.");

      const dataBucketProvider = new aws.Provider("DataBucketProvider", {
        region: dataBucketRegion,
      });
      const dataBucket = sst.aws.Bucket.get("DataBucket", dataBucketName, {
        provider: dataBucketProvider,
      });

      dataRouter = new sst.aws.Router("DataRouter", {
        domain: dataCdnDomain,
        routes: {
          "/*": {
            bucket: dataBucket,
            cachePolicy: "658327ea-f89d-4fab-a63d-7e88639e58f6",
            edge: {
              viewerResponse: {
                injection: [
                  "const allowedOrigins = [",
                  `  "https://${env.WEB_DOMAIN}",`,
                  `  "https://${env.WEB_STAGING_DOMAIN}",`,
                  "];",
                  "const originHeader = event.request.headers.origin;",
                  "const origin = originHeader && originHeader.value;",
                  "const isLocalhost = origin && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'));",
                  "if (origin && (allowedOrigins.includes(origin) || isLocalhost)) {",
                  '  event.response.headers["access-control-allow-origin"] = { value: origin };',
                  '  event.response.headers["vary"] = { value: "Origin" };',
                  '  event.response.headers["access-control-allow-methods"] = { value: "GET,HEAD,OPTIONS" };',
                  '  event.response.headers["access-control-allow-headers"] = { value: "*" };',
                  "}",
                ].join("\n"),
              },
            },
          },
        },
      });
    }

    const dataBaseUrl =
      env.PUBLIC_DATA_BASE_URL && env.PUBLIC_DATA_BASE_URL !== "/data"
        ? env.PUBLIC_DATA_BASE_URL
        : env.DATA_CDN_DOMAIN
          ? `https://${env.DATA_CDN_DOMAIN}`
          : env.PUBLIC_DATA_BASE_URL ?? "";

    new sst.aws.SvelteKit("Web", {
      path: "packages/web",
      domain: webDomain,
      warm: isProdStage ? 1 : 0,
      environment: {
        PUBLIC_DATA_BASE_URL: dataBaseUrl,
        PUBLIC_DATA_RELEASE_PATH: env.PUBLIC_DATA_RELEASE_PATH ?? "",
      },
    });

    return {
      dataCdnDistributionId: dataRouter?.distributionID,
      dataCdnDomain: dataRouter?.url,
    };
  },
});

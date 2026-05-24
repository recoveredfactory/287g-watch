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

    new sst.aws.SvelteKit("Web", {
      path: "packages/web",
      domain: webDomain,
      warm: isProdStage ? 1 : 0,
      environment: {
        PUBLIC_STAGE: $app.stage,
      },
    });
  },
});

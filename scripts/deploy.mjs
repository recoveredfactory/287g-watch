#!/usr/bin/env node
// Deploy orchestrator: `sst deploy` plus the optional asset bake/publish steps,
// in one command so a release that changes the homepage map can refresh the
// social assets in the same shot.
//
// Usage:
//   node scripts/deploy.mjs --stage prod
//   node scripts/deploy.mjs --stage prod --bake-og --bake-video
//   node scripts/deploy.mjs --stage staging --bake-video
//   node scripts/deploy.mjs --stage prod --bake-og --no-deploy   # just (re)bake+publish OG
//
// Flags:
//   --stage <name>   required. prod | staging (asset steps only support these).
//   --bake-og        after deploy: bake OG cards, then publish them to the bucket.
//   --bake-video     after deploy: bake the map videos — the square map-only cut
//                    and the vertical map+trend cut (en + es each) — then publish.
//   --no-deploy      skip `sst deploy` — only run the selected bake/publish steps.
//   --url <base>     override the site base URL to bake against. Default is
//                    https://<WEB_DOMAIN|WEB_STAGING_DOMAIN> read from .env
//                    (the same hosts sst.config.ts uses).
//
// Order matters: we deploy FIRST, then bake against the just-deployed site, so
// the OG snapshot and the video reflect the new build rather than the previous
// one (the stale-bake gotcha — bake after the change is live, not before).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

const stage = valueOf("--stage");
const bakeOg = has("--bake-og");
const bakeVideo = has("--bake-video");
const noDeploy = has("--no-deploy");

const die = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

if (!stage) die("Missing --stage <prod|staging>.");
if (noDeploy && !bakeOg && !bakeVideo)
  die("--no-deploy with no --bake-og/--bake-video leaves nothing to do.");
if ((bakeOg || bakeVideo) && !["prod", "staging"].includes(stage))
  die(`Asset bake/publish only supports --stage prod or staging (got "${stage}").`);

// Base URL to bake against: explicit --url, else the stage's domain from .env.
function baseUrl() {
  const override = valueOf("--url");
  if (override) return override.replace(/\/+$/, "");
  // Base on process.env so CI (no .env file) still resolves WEB_DOMAIN from the
  // workflow `env:` block; a local .env file overlays/wins, matching how
  // sst.config.ts builds its env ({ ...process.env, ...localEnv }).
  const envPath = resolve(ROOT, ".env");
  const env = { ...process.env };
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  const host = stage === "prod" ? env.WEB_DOMAIN : env.WEB_STAGING_DOMAIN;
  if (!host)
    die(
      `No ${stage === "prod" ? "WEB_DOMAIN" : "WEB_STAGING_DOMAIN"} in .env — ` +
        "pass --url <base> to point the bake at the deployed site.",
    );
  return `https://${host}`;
}

// Run a command, streaming its output; abort the whole release on failure.
const run = (label, cmd, cmdArgs) => {
  console.log(`\n▶ ${label}\n  ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, { cwd: ROOT, stdio: "inherit" });
};

// Run a command async, BUFFERING its output and flushing it as one block on
// exit — so several of these running in parallel don't interleave into garbage.
const runBuffered = (label, cmd, cmdArgs) =>
  new Promise((resolve, reject) => {
    console.log(`  ▶ start: ${label}`);
    const p = spawn(cmd, cmdArgs, { cwd: ROOT });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", reject);
    p.on("exit", (code) => {
      console.log(`\n──── ${label} (exit ${code}) ────\n${out.trimEnd()}\n`);
      code === 0 ? resolve() : reject(new Error(`${label} failed (exit ${code})`));
    });
  });

if (!noDeploy) run("Deploy", "sst", ["deploy", "--stage", stage]);

if (bakeOg) {
  const base = baseUrl();
  run("Bake OG cards", "pnpm", ["-F", "web", "bake:og", `--url=${base}/en`]);
  run("Publish OG cards", "pnpm", [`publish:og:${stage}`]);
}

if (bakeVideo) {
  const base = baseUrl();
  // All four cuts (square + vertical, en + es) bake concurrently — each writes
  // its own frames dir / palette / outputs, so there's no collision. On a GPU
  // runner this is a big win; under software GL it still uses spare cores.
  const cuts = [
    ["bake:map-video", "en", `${base}/en`],
    ["bake:map-video", "es", `${base}/es`],
    ["bake:map-trend-video", "en", `${base}/en/video/national`],
    ["bake:map-trend-video", "es", `${base}/es/video/national`],
  ];
  console.log(`\n▶ Baking ${cuts.length} cuts in parallel…`);
  const results = await Promise.allSettled(
    cuts.map(([script, lang, url]) =>
      runBuffered(`${script} (${lang})`, "pnpm", ["-F", "web", script, `--lang=${lang}`, `--url=${url}`]),
    ),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) {
    for (const f of failed) console.error(`✗ ${f.reason?.message ?? f.reason}`);
    die(`${failed.length} of ${cuts.length} bakes failed.`);
  }
  // One publish handles both cuts (publish-map-assets walks all prefixes).
  run("Publish map assets", "pnpm", [`publish:map-assets:${stage}`]);
}

console.log("\n✓ Done.");

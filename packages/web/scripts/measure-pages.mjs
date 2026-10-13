#!/usr/bin/env node
// TTFB, decoded size and cache status for a handful of pages (the first request is a
// warm-up and not counted). For before/after checks on #292:
//   node scripts/measure-pages.mjs https://staging.example.org
const host = process.argv[2] ?? "https://287g.recoveredfactory.net";
const PATHS = ["/en/about", "/en/model/jail", "/en", "/en/agency/jacksonville-sheriffs-office-fl", "/en/state/vt", "/en/state/fl", "/en/states", "/data/dist/agency_index.json"];
const RUNS = 5;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

for (const path of PATHS) {
  const ttfb = [];
  let bytes = 0;
  let cache = "";
  for (let i = 0; i <= RUNS; i++) {
    const t0 = performance.now();
    const res = await fetch(host + path, { headers: { "accept-encoding": "br" } });
    if (i > 0) ttfb.push(performance.now() - t0);
    bytes = (await res.arrayBuffer()).byteLength;
    cache = res.headers.get("x-cache") ?? "";
  }
  console.log(`${path.padEnd(46)} ttfb median ${String(Math.round(median(ttfb))).padStart(5)} ms  ${String(Math.round(bytes / 1024)).padStart(5)} KB decoded  ${cache}`);
}

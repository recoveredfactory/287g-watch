#!/usr/bin/env node
// One-time (re-runnable) geometry augmentation: us-inset-counties.geojson
// ships with only `{name, inset}` per feature — 444 county names are
// duplicated across states (e.g. 30+ "Washington County"s), so nothing can
// reliably match an agency's county to the right polygon without knowing
// which state it's in. Resolves each county's centroid against the state
// polygons in us-inset.geojson (point-in-polygon) and writes `state` (the
// 2-letter abbr) back into the same file. Safe to re-run if either source
// file changes — it's a pure function of the two inputs.
import { readFileSync, writeFileSync } from "fs";
import { geoCentroid, geoContains } from "d3-geo";

const STATIC = new URL("../static/", import.meta.url);
const counties = JSON.parse(readFileSync(new URL("us-inset-counties.geojson", STATIC), "utf8"));
const states = JSON.parse(readFileSync(new URL("us-inset.geojson", STATIC), "utf8"));

// Full name -> abbr, pulled from the same source $lib/states.ts uses so this
// never drifts from the site's own mapping.
const statesTs = readFileSync(new URL("../src/lib/states.ts", STATIC), "utf8");
const stateNamesBlock = statesTs.slice(statesTs.indexOf("STATE_NAMES"), statesTs.indexOf("\n}"));
const nameToAbbr = {};
for (const m of stateNamesBlock.matchAll(/([A-Z]{2}):\s*"([^"]+)"/g)) {
  nameToAbbr[m[2]] = m[1];
}

// A handful of small/coastal counties whose centroid falls outside every
// state polygon (offshore islands, etc.) — checked against live agency data
// first; only Aransas, TX actually has an agency, so that's the only one
// worth a manual override rather than leaving it unresolved.
const MANUAL_OVERRIDES = { Aransas: "TX" };

let resolved = 0;
let unresolved = 0;
for (const county of counties.features) {
  if (MANUAL_OVERRIDES[county.properties.name]) {
    county.properties.state = MANUAL_OVERRIDES[county.properties.name];
    resolved++;
    continue;
  }
  const centroid = geoCentroid(county);
  let match = null;
  for (const state of states.features) {
    if (geoContains(state, centroid)) {
      match = state.properties.name;
      break;
    }
  }
  const abbr = match ? nameToAbbr[match] : undefined;
  if (abbr) {
    county.properties.state = abbr;
    resolved++;
  } else {
    unresolved++;
    console.warn(`No state match for county "${county.properties.name}" (inset=${county.properties.inset ?? "none"})`);
  }
}

console.log(`Resolved ${resolved}/${counties.features.length} counties (${unresolved} unresolved).`);
writeFileSync(new URL("us-inset-counties.geojson", STATIC), JSON.stringify(counties));

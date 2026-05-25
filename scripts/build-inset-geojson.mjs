/**
 * Generates three static GeoJSON files for the inset US map:
 *   packages/web/static/us-inset.geojson         — state boundaries
 *   packages/web/static/us-inset-counties.geojson — county boundaries
 *   packages/web/static/us-cities.geojson         — populated places (Natural Earth 10m)
 *
 * Continental US stays at real coordinates. Non-contiguous territories are
 * repositioned as insets along the bottom of the map:
 *
 *  [AK]  [HI]  [GU]  [MP]  [AS]  [PR] [VI]
 *  ←──────────────────────────────────────→
 *  -124W                              -65W
 *
 * Transform params are also written to packages/web/src/lib/insetTransforms.ts
 * so NationalMap can transform individual agency lat/lng coordinates at runtime.
 */

import { createRequire } from "module";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { feature } = require("../packages/web/node_modules/topojson-client");

// ── Transform helpers ────────────────────────────────────────────────────────

// Normalize Aleutian Island longitudes that crossed the antimeridian
function fixLng(lng) {
  return lng > 170 ? lng - 360 : lng;
}

function transformCoord([lng, lat], { srcCenter, tgtCenter, scale }) {
  const lng2 = fixLng(lng);
  return [
    tgtCenter[0] + scale * (lng2 - srcCenter[0]),
    tgtCenter[1] + scale * (lat - srcCenter[1]),
  ];
}

function applyTransform(geometry, params) {
  const ring = (r) => r.map((c) => transformCoord(c, params));
  const poly = (p) => p.map(ring);
  if (geometry.type === "Polygon")
    return { type: "Polygon", coordinates: geometry.coordinates.map(ring) };
  if (geometry.type === "MultiPolygon")
    return { type: "MultiPolygon", coordinates: geometry.coordinates.map(poly) };
  return geometry;
}

// ── Inset layout ─────────────────────────────────────────────────────────────

export const INSET_TRANSFORMS = {
  AK: { srcCenter: [-153.5, 63.5], tgtCenter: [-118.5, 25.5], scale: 0.29 },
  HI: { srcCenter: [-157.5, 20.5], tgtCenter: [-108.5, 24.5], scale: 0.80 },
  GU: { srcCenter: [144.79, 13.45], tgtCenter: [-104.8, 24.5], scale: 1.00 },
  MP: { srcCenter: [145.60, 16.50], tgtCenter: [-103.2, 25.5], scale: 1.00 },
  AS: { srcCenter: [-170.13, -14.30], tgtCenter: [-101.5, 24.5], scale: 1.00 },
  PR: { srcCenter: [-66.59, 18.22], tgtCenter: [-99.5, 24.5], scale: 1.00 },
  VI: { srcCenter: [-64.83, 18.03], tgtCenter: [-97.5, 24.5], scale: 1.00 },
};

// FIPS state code (2-digit string) → territory abbreviation
const TERRITORY_FIPS = { "02": "AK", "15": "HI", "66": "GU", "69": "MP", "60": "AS", "72": "PR", "78": "VI" };

// Natural Earth ADM1NAME → territory abbreviation
const STATE_NAME_TO_ABBR = {
  Alaska: "AK", Hawaii: "HI", Guam: "GU",
  "Northern Mariana Islands": "MP", "American Samoa": "AS",
  "Puerto Rico": "PR", "United States Virgin Islands": "VI",
};

function abbrFromFips(fipsId) {
  const stateCode = String(fipsId).padStart(5, "0").slice(0, 2);
  return TERRITORY_FIPS[stateCode] ?? null;
}

// ── 1. State boundaries ───────────────────────────────────────────────────────

console.log("Building state boundaries…");
const statesTopo = require("../packages/web/node_modules/us-atlas/states-10m.json");
const statesGeo = feature(statesTopo, statesTopo.objects.states);

const stateFeatures = statesGeo.features.map((f) => {
  const abbr = TERRITORY_FIPS[String(f.id).padStart(2, "0")];
  const params = abbr ? INSET_TRANSFORMS[abbr] : null;
  if (!params) return f;
  return { ...f, geometry: applyTransform(f.geometry, params), properties: { ...f.properties, inset: abbr } };
});

writeFileSync(
  resolve(__dirname, "../packages/web/static/us-inset.geojson"),
  JSON.stringify({ type: "FeatureCollection", features: stateFeatures })
);
console.log(`  → us-inset.geojson (${stateFeatures.length} features)`);

// ── 2. County boundaries ──────────────────────────────────────────────────────

console.log("Building county boundaries…");
const countiesTopo = require("../packages/web/node_modules/us-atlas/counties-10m.json");
const countiesGeo = feature(countiesTopo, countiesTopo.objects.counties);

const countyFeatures = countiesGeo.features.map((f) => {
  const abbr = abbrFromFips(f.id);
  const params = abbr ? INSET_TRANSFORMS[abbr] : null;
  if (!params) return f;
  return { ...f, geometry: applyTransform(f.geometry, params), properties: { ...f.properties, inset: abbr } };
});

writeFileSync(
  resolve(__dirname, "../packages/web/static/us-inset-counties.geojson"),
  JSON.stringify({ type: "FeatureCollection", features: countyFeatures })
);
console.log(`  → us-inset-counties.geojson (${countyFeatures.length} features)`);

// ── 3. Populated places (Natural Earth 10m) ───────────────────────────────────

console.log("Fetching Natural Earth 10m populated places…");
const placesRes = await fetch(
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson"
);
if (!placesRes.ok) throw new Error(`HTTP ${placesRes.status}`);
const placesData = await placesRes.json();

const cityFeatures = placesData.features
  .filter((f) => f.properties.ADM0_A3 === "USA")
  .map((f) => {
    const p = f.properties;
    const abbr = STATE_NAME_TO_ABBR[p.ADM1NAME] ?? null;
    const params = abbr ? INSET_TRANSFORMS[abbr] : null;
    const coords = params
      ? transformCoord(f.geometry.coordinates, params)
      : [fixLng(f.geometry.coordinates[0]), f.geometry.coordinates[1]];
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: coords },
      properties: {
        name: p.NAME,
        pop: p.POP_MAX ?? 0,
        // rank: 1 = megacity, 2 = large, 3 = medium, 4 = small
        rank: p.POP_MAX >= 1000000 ? 1 : p.POP_MAX >= 300000 ? 2 : p.POP_MAX >= 100000 ? 3 : 4,
      },
    };
  });

writeFileSync(
  resolve(__dirname, "../packages/web/static/us-cities.geojson"),
  JSON.stringify({ type: "FeatureCollection", features: cityFeatures })
);
console.log(`  → us-cities.geojson (${cityFeatures.length} features)`);

// ── 4. Highways (Natural Earth 10m roads — Major Highway + Beltway) ──────────

console.log("Fetching Natural Earth 10m roads…");
const roadsRes = await fetch(
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_roads.geojson"
);
if (!roadsRes.ok) throw new Error(`HTTP ${roadsRes.status}`);
const roadsData = await roadsRes.json();

// Detect territory for a LineString by its average coordinate
function detectRoadAbbr(coordinates) {
  const flat = coordinates[0] && Array.isArray(coordinates[0][0]) ? coordinates.flat() : coordinates;
  const avgLat = flat.reduce((s, c) => s + c[1], 0) / flat.length;
  const avgLng = flat.reduce((s, c) => s + c[0], 0) / flat.length;
  if (avgLat > 50) return "AK";
  if (avgLng < -154 && avgLat < 24) return "HI";
  return null;
}

function transformLine(coordinates, params) {
  return coordinates.map((c) => transformCoord(c, params));
}

const highwayFeatures = roadsData.features
  .filter((f) => {
    const p = f.properties;
    return (
      (p.sov_a3 === "USA" || p.adm0_a3 === "USA") &&
      (p.type === "Major Highway" || p.type === "Beltway")
    );
  })
  .map((f) => {
    const abbr = detectRoadAbbr(f.geometry.coordinates);
    const params = abbr ? INSET_TRANSFORMS[abbr] : null;
    const coords = params ? transformLine(f.geometry.coordinates, params) : f.geometry.coordinates;
    return {
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {
        name: f.properties.name ?? "",
        min_zoom: f.properties.min_zoom ?? 5,
      },
    };
  });

writeFileSync(
  resolve(__dirname, "../packages/web/static/us-highways.geojson"),
  JSON.stringify({ type: "FeatureCollection", features: highwayFeatures })
);
console.log(`  → us-highways.geojson (${highwayFeatures.length} features)`);

// ── 5. insetTransforms.ts ─────────────────────────────────────────────────────

writeFileSync(
  resolve(__dirname, "../packages/web/src/lib/insetTransforms.ts"),
  `// Auto-generated by scripts/build-inset-geojson.mjs — do not edit by hand
export type InsetTransform = { srcCenter: [number, number]; tgtCenter: [number, number]; scale: number };

export const INSET_TRANSFORMS: Record<string, InsetTransform> = ${JSON.stringify(INSET_TRANSFORMS, null, 2)};

/** Returns inset-mapped lng/lat for display on the map, or real coords if no transform is needed. */
export function toInsetCoords(lng: number, lat: number, stateAbbr: string): [number, number] {
  const t = INSET_TRANSFORMS[stateAbbr];
  if (!t) return [lng, lat];
  const normLng = lng > 170 ? lng - 360 : lng;
  return [
    t.tgtCenter[0] + t.scale * (normLng - t.srcCenter[0]),
    t.tgtCenter[1] + t.scale * (lat - t.srcCenter[1]),
  ];
}
`
);
console.log("  → insetTransforms.ts");
console.log("Done.");

// Lightweight per-state SVG geometry (outline + a hint of highways), projected
// into a small viewBox for a WebGL-free mini-map. Fed by the same static assets
// the parent maplibre map uses (us-inset.geojson, us-highways.geojson); agency
// dots are projected through toInsetCoords first so AK/HI/territories — whose
// outlines are repositioned in the inset layout — still land correctly.
//
// Pure + deterministic: given the two feature collections it returns JSON-ready
// path strings plus a per-state projector the server uses to place dots. Nothing
// here touches the network — see $lib/server/stateMaps.ts for the cached loader.
import { STATE_NAMES } from "$lib/states";

type Pt = [number, number];
type Ring = Pt[];
type Feature = {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};
type FeatureCollection = { features: Feature[] };

export type Proj = { kx: number; minX: number; maxY: number; scale: number; pad: number };
export type StateGeom = {
  w: number;
  h: number;
  outline: string; // one path 'd' covering every ring
  highways: string[]; // path 'd' strings, bbox-trimmed (SVG clip finishes the edges)
  proj: Proj; // kept server-side to place dots; not shipped to the client
};

// Full-name → abbr, plus the two names the inset file spells differently.
const NAME_TO_ABBR: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [abbr, name] of Object.entries(STATE_NAMES)) m[name] = abbr;
  m["Commonwealth of the Northern Mariana Islands"] = "MP";
  m["United States Virgin Islands"] = "VI";
  return m;
})();

const ringsOf = (geom: Feature["geometry"]): Ring[] => {
  const c = geom.coordinates as unknown;
  if (geom.type === "Polygon") return c as Ring[];
  if (geom.type === "MultiPolygon") return (c as Ring[][]).flat();
  return [];
};

// Project a raw (inset-space) lng/lat into viewBox coords. Equirectangular with a
// cos(lat) x-correction so states aren't stretched; y is flipped (north up).
export const project = (p: Proj, lng: number, lat: number): [number, number] => [
  Math.round(((lng * p.kx - p.minX) * p.scale + p.pad) * 10) / 10,
  Math.round(((p.maxY - lat) * p.scale + p.pad) * 10) / 10,
];

// Drop points nearer than minD (in viewBox units) to the last kept one; endpoints
// always survive. Cheap distance-based thinning — enough for a small map.
const simplify = (pts: [number, number][], minD: number): [number, number][] => {
  if (pts.length <= 2) return pts;
  const out: [number, number][] = [pts[0]];
  const m2 = minD * minD;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [lx, ly] = out[out.length - 1];
    if ((x - lx) ** 2 + (y - ly) ** 2 >= m2) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
};

const toPath = (pts: [number, number][]): string =>
  pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");

const bboxOf = (rings: Ring[]) => {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const r of rings)
    for (const [lng, lat] of r) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  return { minLng, maxLng, minLat, maxLat };
};

export function buildStateGeometry(
  inset: FeatureCollection,
  highways: FeatureCollection,
  opts: { size?: number; pad?: number; maxHighwayZoom?: number; simplifyPx?: number } = {},
): Record<string, StateGeom> {
  const size = opts.size ?? 120;
  const pad = opts.pad ?? 5;
  // ≤ 4 keeps the interstate network (I-29/I-90 etc. are tagged z4), which reads
  // as the intended "hint of highways"; denser classes are just noise at ~200px.
  const maxZoom = opts.maxHighwayZoom ?? 4;
  const simp = opts.simplifyPx ?? 0.6;

  // Precompute highway polyline bboxes once (reused across all states). A handful
  // of features are MultiLineString-shaped (coordinates nested one level deeper)
  // despite the LineString type, so normalize to a flat list of polylines.
  const roads = highways.features
    .filter((f) => ((f.properties.min_zoom as number) ?? 99) <= maxZoom)
    .flatMap((f) => {
      const c = f.geometry.coordinates as Pt[] | Pt[][];
      const lines: Pt[][] = Array.isArray((c as Pt[][])[0]?.[0]) ? (c as Pt[][]) : [c as Pt[]];
      return lines.map((line) => {
        let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
        for (const [lng, lat] of line) {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
        return { line, minLng, maxLng, minLat, maxLat };
      });
    });

  const out: Record<string, StateGeom> = {};

  for (const feat of inset.features) {
    const abbr = NAME_TO_ABBR[feat.properties.name as string];
    if (!abbr) continue;
    const rings = ringsOf(feat.geometry);
    if (!rings.length) continue;

    const { minLng, maxLng, minLat, maxLat } = bboxOf(rings);
    const midLat = (minLat + maxLat) / 2;
    const kx = Math.cos((midLat * Math.PI) / 180);
    const minX = minLng * kx;
    const maxX = maxLng * kx;
    const projW = maxX - minX;
    const projH = maxLat - minLat;
    const span = Math.max(projW, projH) || 1;
    const scale = size / span;
    const proj: Proj = { kx, minX, maxY: maxLat, scale, pad };
    const w = Math.round((projW * scale + 2 * pad) * 10) / 10;
    const h = Math.round((projH * scale + 2 * pad) * 10) / 10;

    const outline = rings
      .map((r) => toPath(simplify(r.map(([lng, lat]) => project(proj, lng, lat)), simp)) + " Z")
      .join(" ");

    // Highways: keep only the portion whose vertices fall in the state's bbox
    // (a small margin so lines reach the border); the SVG clipPath trims the
    // rest to the outline. Real lon/lat, matching the lower-48 outline space.
    const mLng = (maxLng - minLng) * 0.04;
    const mLat = (maxLat - minLat) * 0.04;
    const inBox = (lng: number, lat: number) =>
      lng >= minLng - mLng && lng <= maxLng + mLng && lat >= minLat - mLat && lat <= maxLat + mLat;

    const roadPaths: string[] = [];
    for (const r of roads) {
      if (r.maxLng < minLng - mLng || r.minLng > maxLng + mLng) continue;
      if (r.maxLat < minLat - mLat || r.minLat > maxLat + mLat) continue;
      let run: [number, number][] = [];
      for (const [lng, lat] of r.line) {
        if (inBox(lng, lat)) run.push(project(proj, lng, lat));
        else if (run.length) {
          if (run.length >= 2) roadPaths.push(toPath(simplify(run, simp)));
          run = [];
        }
      }
      if (run.length >= 2) roadPaths.push(toPath(simplify(run, simp)));
    }

    out[abbr] = { w, h, outline, highways: roadPaths, proj };
  }

  return out;
}

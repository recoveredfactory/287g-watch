// Server-side cache for the per-state mini-map geometry. The two source
// geojsons are static and identical across requests, so we build the projected
// paths once per process (dev server / warm Lambda container) and reuse them.
import { buildStateGeometry, project, type StateGeom } from "$lib/stateGeometry";
import { toInsetCoords } from "$lib/insetTransforms";
import { MODEL_COLORS } from "$lib/colors";
import type { Agency } from "$lib/homeData.types";
import { readStaticData } from "$lib/server/staticData";

type Fetch = typeof globalThis.fetch;

let cache: Record<string, StateGeom> | null = null;
let inflight: Promise<Record<string, StateGeom>> | null = null;

export async function getStateGeometry(fetch: Fetch): Promise<Record<string, StateGeom>> {
  if (cache) return cache;
  if (!inflight) {
    inflight = (async () => {
      const [inset, highways] = await Promise.all([
        fetch("/us-inset.geojson").then((r) => r.json()),
        fetch("/us-highways.geojson").then((r) => r.json()),
      ]);
      cache = buildStateGeometry(inset, highways);
      return cache;
    })();
  }
  return inflight;
}

// Real agency lng/lat → the state's viewBox, routed through the inset shift so
// AK/HI/territory dots land on their repositioned outlines.
export function projectDot(
  geom: StateGeom,
  abbr: string,
  lng: number,
  lat: number,
): [number, number] {
  const [ilng, ilat] = toInsetCoords(lng, lat, abbr);
  return project(geom.proj, ilng, ilat);
}

// Compact SVG mini-map: state outline + a hint of highways, both pre-projected
// into `w`×`h` viewBox units, plus agency dots (x/y in the same space, c = model
// color, o = sworn-officer count for sqrt radius scaling à la the homepage map).
export type StateMapDot = { x: number; y: number; c: string; o: number };
export type StateMapMini = {
  w: number;
  h: number;
  outline: string;
  highways: string[];
  dots: StateMapDot[];
};

// One state's /states card map, or null without geometry. Dots keep the index's
// order, which is their draw order.
export async function getStateMiniMap(fetch: Fetch, abbr: string): Promise<StateMapMini | null> {
  const [geometry, agencies] = await Promise.all([
    getStateGeometry(fetch),
    readStaticData<Agency[]>("agency_index.json"),
  ]);
  if (!agencies) throw new Error("agency_index.json unavailable");
  const g = geometry[abbr];
  if (!g) return null;
  const dots = agencies
    .filter((a) => a.state === abbr && a.lat != null && a.lng != null)
    .map((a): StateMapDot => {
      const [x, y] = projectDot(g, abbr, a.lng!, a.lat!);
      return { x, y, c: MODEL_COLORS[a.primary_model] ?? "#64748b", o: a.lee?.officer_ct ?? 0 };
    });
  return { w: g.w, h: g.h, outline: g.outline, highways: g.highways, dots };
}

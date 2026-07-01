// Server-side cache for the per-state mini-map geometry. The two source
// geojsons are static and identical across requests, so we build the projected
// paths once per process (dev server / warm Lambda container) and reuse them.
import { buildStateGeometry, project, type StateGeom } from "$lib/stateGeometry";
import { toInsetCoords } from "$lib/insetTransforms";

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

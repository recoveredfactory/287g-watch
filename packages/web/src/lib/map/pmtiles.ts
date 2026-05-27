// Shared PMTiles base-layer config.
//
// The maplibre `pmtiles://` protocol needs to be registered once before any
// map asks for tiles from it. Multiple maps on the page (and re-mounts) are
// fine — registration is idempotent because we guard on a module-level flag.

import type { Map as MapLibreMap } from "maplibre-gl";

export const PMTILES_URL = "https://pmtiles.grupovisual.org/latest.pmtiles";

let registered = false;

export async function ensurePmtilesProtocol(
  maplibre: typeof import("maplibre-gl"),
): Promise<void> {
  if (registered) return;
  const { Protocol } = await import("pmtiles");
  const protocol = new Protocol();
  (maplibre as any).addProtocol("pmtiles", protocol.tile);
  registered = true;
}

/**
 * Source spec for the shared base-layer PMTiles file. Layers available:
 * `boundaries`, `buildings`, `earth`, `landcover`, `landuse`, `places`,
 * `pois`, `roads`, `water`. Standard web-mercator projection — lines up
 * with the lower-48 but not with the custom inset positions for
 * AK/HI/territories. Use sparingly in inset-projected views.
 */
export function pmtilesBaseSource() {
  return {
    type: "vector" as const,
    url: `pmtiles://${PMTILES_URL}`,
    attribution:
      '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
  };
}

export type MapLibreModule = typeof import("maplibre-gl");
export type { MapLibreMap };

/**
 * Build a "world minus the supplied states" polygon, suitable for masking
 * foreign land underneath the PMTiles base layer. Render as a fill in the
 * background color, layered above PMTiles roads/places but below dots, and
 * PMTiles content outside the US disappears.
 *
 * Pass the inset state polygons in (us-inset.geojson) so the mask hides
 * foreign tiles at real-world coords but doesn't punch holes at the inset
 * positions of AK/HI/territories (which is where the inset state polygons
 * actually sit on the map).
 */

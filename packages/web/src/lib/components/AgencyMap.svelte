<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_SHORT } from "$lib/colors";
  import { localizeHref } from "$lib/paraglide/runtime";
  import { toInsetCoords } from "$lib/insetTransforms";
  import { STATE_NAMES } from "$lib/states";
  import { ensurePmtilesProtocol, pmtilesBaseSource } from "$lib/map/pmtiles";
  import { mapPalette, type PaletteKey } from "$lib/map/paletteStore";

  // Inset territories sit at shifted coords; loading PMTiles over them
  // would draw foreign tiles. Affects 5 agencies total (AK, GU, MP).
  const INSET_STATES = new Set(["AK", "HI", "PR", "VI", "GU", "MP", "AS"]);

  // Two palettes mirrored from NationalMap. AgencyMap has its own spec
  // because it draws non-current states distinctly (so the current state
  // pops without dimming neighbors as harshly).
  type AgencyPalette = {
    bg: string;
    stateBg: string;
    stateHighlight: string;
    stateLines: string;
    stateLineWidth: number;
    county: string;
    roadCasing: string;
    roadFill: string;
    roadMedium: string;
    haloFill: string;
  };
  const AGENCY_PALETTES: Record<PaletteKey, AgencyPalette> = {
    slate: {
      bg: "#dde4eb",
      stateBg: "#eef0f2",
      stateHighlight: "#fafaf8",
      stateLines: "#b8c4cf",
      stateLineWidth: 0.75,
      county: "#c8d4dc",
      roadCasing: "#a0b0bc",
      roadFill: "#eef2f5",
      roadMedium: "#cdd6dc",
      haloFill: "#ffffff",
    },
    dark: {
      bg: "#0c1117",
      stateBg: "#161e27",
      stateHighlight: "#1f2a36",
      stateLines: "#3a4552",
      stateLineWidth: 0.5,
      county: "#1c242e",
      roadCasing: "#252d38",
      roadFill: "#525f6c",
      roadMedium: "#252d38",
      haloFill: "#e8ecf2",
    },
  };

  export let lat: number | null | undefined = undefined;
  export let lng: number | null | undefined = undefined;
  export let state: string;
  export let primaryModel: string | null | undefined = undefined;
  // All agencies in the dataset — used to render the rest of this state's
  // 287(g) participants as dimmed context dots behind the current one.
  export let agencies: Array<{
    slug: string;
    name: string;
    state: string;
    city?: string | null;
    primary_model: string | null;
    models: string[];
    lat?: number | null;
    lng?: number | null;
    lee?: { officer_ct?: number | null } | null;
  }> = [];
  export let currentSlug: string;

  const MODEL_FALLBACK = "#94a3b8";
  const isMobile = browser && window.matchMedia("(max-width: 640px)").matches;

  // us-atlas uses different names for these two territories
  const GJ_NAME_OVERRIDE: Record<string, string> = {
    VI: "United States Virgin Islands",
    MP: "Commonwealth of the Northern Mariana Islands",
  };

  let container: HTMLDivElement;
  let map: any = null;
  let unsubscribePalette: (() => void) | null = null;

  onMount(async () => {
    if (!browser || !container) return;

    const ml = await import("maplibre-gl");
    await ensurePmtilesProtocol(ml);

    const showPmtilesRoads = !INSET_STATES.has(state);
    const dotCoords: [number, number] | null =
      lat != null && lng != null ? toInsetCoords(lng, lat, state) : null;
    // Read the persisted palette on mount; we'll also subscribe below so
    // a toggle from another tab/page applies live.
    let p: AgencyPalette = AGENCY_PALETTES.slate;
    unsubscribePalette = mapPalette.subscribe((v) => {
      p = AGENCY_PALETTES[v] ?? AGENCY_PALETTES.slate;
      // After the map is created and styled, re-paint the changed layers.
      if (map && map.isStyleLoaded()) repaintPalette();
    });

    const repaintPalette = () => {
      if (!map) return;
      map.setPaintProperty("background", "background-color", p.bg);
      if (map.getLayer("states-bg")) map.setPaintProperty("states-bg", "fill-color", p.stateBg);
      if (map.getLayer("state-highlight")) map.setPaintProperty("state-highlight", "fill-color", p.stateHighlight);
      if (map.getLayer("state-lines")) {
        map.setPaintProperty("state-lines", "line-color", p.stateLines);
        map.setPaintProperty("state-lines", "line-width", p.stateLineWidth);
      }
      if (map.getLayer("county-lines")) map.setPaintProperty("county-lines", "line-color", p.county);
      if (map.getLayer("road-casing")) map.setPaintProperty("road-casing", "line-color", p.roadCasing);
      if (map.getLayer("road-fill")) map.setPaintProperty("road-fill", "line-color", p.roadFill);
      if (map.getLayer("road-medium")) map.setPaintProperty("road-medium", "line-color", p.roadMedium);
      if (map.getLayer("context-agencies"))
        map.setPaintProperty("context-agencies", "circle-stroke-color", p.bg);
      if (map.getLayer("agency-halo")) map.setPaintProperty("agency-halo", "circle-color", p.haloFill);
    };

    map = new ml.Map({
      container,
      style: {
        version: 8,
        sources: {},
        glyphs: "https://fonts.basemaps.cartocdn.com/gl/fonts/{fontstack}/{range}.pbf",
        projection: { type: "mercator" },
        layers: [
          { id: "background", type: "background", paint: { "background-color": p.bg } },
        ],
      } as any,
      center: dotCoords ?? [-98, 39],
      zoom: 5,
      attributionControl: { compact: true },
    });
    map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", async () => {
      map.resize();

      const stateGjName =
        GJ_NAME_OVERRIDE[state] ?? STATE_NAMES[state] ?? state;

      const [statesGj, countiesGj] = await Promise.all([
        fetch("/us-inset.geojson").then((r) => r.json()),
        fetch("/us-inset-counties.geojson").then((r) => r.json()),
      ]);

      map.addSource("states", { type: "geojson", data: statesGj });

      // Background states — non-current. In cream this is almost the same
      // off-white as the highlight (subtle differentiation); in dark it's
      // a touch darker than the current state so focus reads clearly.
      map.addLayer({
        id: "states-bg",
        type: "fill",
        source: "states",
        paint: { "fill-color": p.stateBg, "fill-opacity": 1 },
      });

      map.addLayer({
        id: "state-highlight",
        type: "fill",
        source: "states",
        filter: ["==", ["get", "name"], stateGjName],
        paint: { "fill-color": p.stateHighlight, "fill-opacity": 1 },
      });

      map.addLayer({
        id: "state-lines",
        type: "line",
        source: "states",
        paint: { "line-color": p.stateLines, "line-width": p.stateLineWidth },
      });

      map.addSource("counties", { type: "geojson", data: countiesGj });
      map.addLayer({
        id: "county-lines",
        type: "line",
        source: "counties",
        paint: { "line-color": p.county, "line-width": 0.4 },
      });

      // PMTiles roads — only safe over the lower-48 + DC. The inset
      // territories use shifted coordinates that don't align with the
      // PMTiles' real-world mercator tiles.
      if (showPmtilesRoads) {
        map.addSource("base", pmtilesBaseSource());
        map.addLayer({
          id: "road-casing",
          type: "line",
          source: "base",
          "source-layer": "roads",
          filter: ["in", ["get", "kind"], ["literal", ["highway", "major_road"]]],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": p.roadCasing,
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.5, 8, 3],
            "line-opacity": 0.75,
          },
        });
        map.addLayer({
          id: "road-fill",
          type: "line",
          source: "base",
          "source-layer": "roads",
          filter: ["in", ["get", "kind"], ["literal", ["highway", "major_road"]]],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": p.roadFill,
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.6, 8, 1.8],
            "line-opacity": 0.95,
          },
        });
        map.addLayer({
          id: "road-medium",
          type: "line",
          source: "base",
          "source-layer": "roads",
          minzoom: 6,
          filter: ["==", ["get", "kind"], "medium_road"],
          paint: {
            "line-color": p.roadMedium,
            "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.3, 9, 1],
            "line-opacity": 0.8,
          },
        });
      }

      // Context dots — every participating agency in the country, not
      // just this state. Reads as: "this is one dot among many." The
      // current agency is excluded (drawn separately, prominently, below)
      // and sized like the homepage dots so the visual language stays
      // consistent across views.
      const contextFeatures = agencies
        .filter((a) =>
          a.slug !== currentSlug &&
          a.lat != null &&
          a.lng != null,
        )
        .map((a) => {
          const [clng, clat] = toInsetCoords(a.lng!, a.lat!, a.state);
          return {
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [clng, clat] },
            properties: {
              slug: a.slug,
              name: a.name,
              state: a.state,
              city: a.city ?? "",
              models: a.models.join(", "),
              color: MODEL_COLORS[a.primary_model ?? ""] ?? MODEL_FALLBACK,
              officer_ct: a.lee?.officer_ct ?? 0,
            },
          };
        });
      if (contextFeatures.length) {
        const SCALE = isMobile ? 0.7 : 1;
        const sqrtOfficers = ["sqrt", ["coalesce", ["get", "officer_ct"], 0]];
        map.addSource("context-agencies", {
          type: "geojson",
          data: { type: "FeatureCollection", features: contextFeatures },
        });
        map.addLayer({
          id: "context-agencies",
          type: "circle",
          source: "context-agencies",
          paint: {
            "circle-color": ["get", "color"],
            // Slight bg-colored stroke for cluster separation, lower fill
            // opacity for overlap readability — matches the homepage map.
            "circle-stroke-width": 0.6,
            "circle-stroke-color": p.bg,
            "circle-stroke-opacity": 1,
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              4, ["interpolate", ["linear"], sqrtOfficers, 0, 1.2 * SCALE, 18, 5 * SCALE],
              7, ["interpolate", ["linear"], sqrtOfficers, 0, 2.2 * SCALE, 18, 8 * SCALE],
              10, ["interpolate", ["linear"], sqrtOfficers, 0, 3.5 * SCALE, 18, 12 * SCALE],
            ],
            "circle-opacity": 0.55,
          },
        });
      }

      if (dotCoords) {
        const color = MODEL_COLORS[primaryModel ?? ""] ?? MODEL_FALLBACK;
        map.addSource("agency", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: { type: "Point", coordinates: dotCoords },
            properties: {},
          },
        });
        // Outer ring (light halo) so the current dot pops against the
        // context dots regardless of model color. White in cream, light
        // slate in dark — picked from the palette.
        map.addLayer({
          id: "agency-halo",
          type: "circle",
          source: "agency",
          paint: {
            "circle-color": p.haloFill,
            "circle-radius": 13,
            "circle-opacity": 0.85,
          },
        });
        map.addLayer({
          id: "agency-dot",
          type: "circle",
          source: "agency",
          paint: {
            "circle-color": color,
            "circle-radius": 9,
            "circle-stroke-width": 2.5,
            "circle-stroke-color": p.haloFill,
            "circle-opacity": 0.95,
          },
        });
      }

      // Hover popup + click-to-navigate on the context dots — same UX as
      // the homepage map so the agency page feels like a focused subset
      // of the same dataset.
      const popup = new ml.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 10,
        className: "map-popup",
      });
      map.on("mouseenter", "context-agencies", (e: any) => {
        if (!e.features?.length) return;
        map.getCanvas().style.cursor = "pointer";
        const f = e.features[0];
        const p = f.properties;
        const coords = f.geometry.coordinates.slice();
        const modelBadges = p.models
          ? p.models.split(", ").map((model: string) => {
              const bg = MODEL_COLORS[model] ?? "#e2e8f0";
              const fg = MODEL_TEXT_COLORS[model] ?? "#0f172a";
              const label = MODEL_SHORT[model] ?? model;
              return `<span style="display:inline-block;background:${bg};color:${fg};border-radius:3px;padding:1px 7px;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${label}</span>`;
            }).join(" ")
          : "";
        popup
          .setLngLat(coords)
          .setHTML(
            `<div class="popup-name">${p.name}</div>` +
            `<div class="popup-sub">${[p.city, p.state].filter(Boolean).join(", ")}</div>` +
            (modelBadges ? `<div class="popup-badges">${modelBadges}</div>` : ""),
          )
          .addTo(map);
      });
      map.on("mouseleave", "context-agencies", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
      map.on("click", "context-agencies", (e: any) => {
        if (!e.features?.length) return;
        const slug = e.features[0].properties.slug;
        if (slug) goto(localizeHref(`/agency/${slug}`));
      });

      // Fit to the state's bounding box. Tight padding so the state fills
      // the canvas — readers can pan/zoom out to see neighbors thanks to
      // the new interactive controls.
      const stateFeature = statesGj.features.find(
        (f: any) => f.properties.name === stateGjName
      );
      if (stateFeature) {
        const bounds = new ml.LngLatBounds();
        const addRing = (ring: [number, number][]) =>
          ring.forEach((c) => bounds.extend(c));
        const geom = stateFeature.geometry;
        if (geom.type === "Polygon") {
          geom.coordinates.forEach(addRing);
        } else if (geom.type === "MultiPolygon") {
          geom.coordinates.forEach((poly: any) => poly.forEach(addRing));
        }
        map.fitBounds(bounds, { padding: 8, animate: false });
      }
    });
  });

  onDestroy(() => {
    if (unsubscribePalette) { unsubscribePalette(); unsubscribePalette = null; }
    if (map) { map.remove(); map = null; }
  });
</script>

<div bind:this={container} class="h-full w-full"></div>

<style>
  :global(.map-popup .maplibregl-popup-content) {
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    font-family: "Inter", system-ui, sans-serif;
    font-size: 13px;
    max-width: 220px;
    background: #ffffff;
  }
  :global(.map-popup .maplibregl-popup-tip) {
    border-top-color: #ffffff !important;
  }
  :global(.map-popup .popup-name) {
    font-weight: 600;
    color: #0f172a;
    line-height: 1.3;
  }
  :global(.map-popup .popup-sub) {
    color: #64748b;
    margin-top: 2px;
    font-size: 12px;
  }
  :global(.map-popup .popup-badges) {
    margin-top: 5px;
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
</style>

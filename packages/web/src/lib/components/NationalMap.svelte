<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_SHORT } from "$lib/colors";
  import { toInsetCoords } from "$lib/insetTransforms";
  import { STATE_NAMES } from "$lib/states";
  import { ensurePmtilesProtocol, pmtilesBaseSource, PMTILES_GLYPHS } from "$lib/map/pmtiles";

  export let selectedStates: Set<string> = new Set();

  export let agencies: Array<{
    slug: string;
    name: string;
    state: string;
    city?: string | null;
    primary_model: string | null;
    models: string[];
    population?: number | null;
    lat?: number | null;
    lng?: number | null;
    lee?: { officer_ct?: number | null } | null;
  }> = [];

  // States with a literal state police / highway patrol participating —
  // rendered with a subtle warm tint so readers can see at a glance which
  // states have road enforcement in the 287(g) mix.
  export let statePatrolStates: string[] = [];

  let container: HTMLDivElement;
  let map: any = null;
  const isMobile = browser && window.matchMedia("(max-width: 640px)").matches;
  // Debug-only: ?scale=officers|population|flat lets us A/B sizing schemes
  // without redeploying. Falls back to officers in prod.
  const scaleMode: "officers" | "population" | "flat" =
    browser && import.meta.env.DEV
      ? ((new URLSearchParams(window.location.search).get("scale") as any) ?? "officers")
      : "officers";
  import type { PaletteKey } from "$lib/map/paletteStore";
  export let palette: PaletteKey = "slate";

  type PaletteSpec = {
    bg: string;
    state: string;
    tint: string;
    line: string;
    lineWidth: number;
    county: string;
    roadCasing: string;
    roadFill: string;
    roadMajorCasing: string;
    roadMajorFill: string;
    roadMedium: string;
    text: string;
    textHalo: string;
  };

  // Two picks: slate is the cool blue-grey default (matches the agency
  // page baseline); dark is a steely analytical mode for presentation.
  const PALETTES: Record<PaletteKey, PaletteSpec> = {
    slate: {
      bg: "#dde4eb",
      state: "#f5f4f5",
      tint: "#efe7dc",
      line: "#94a3b8",
      lineWidth: 1.5,
      county: "#c8d4dc",
      roadCasing: "#a0b0bc",
      roadFill: "#eef2f5",
      roadMajorCasing: "#b0bcc7",
      roadMajorFill: "#f3f5f7",
      roadMedium: "#cdd6dc",
      text: "#334155",
      textHalo: "rgba(255,255,255,0.85)",
    },
    dark: {
      bg: "#0c1117",
      state: "#18202a",
      tint: "#2d3a4a",
      line: "#3a4552",
      lineWidth: 0.6,
      county: "#1c242e",
      roadCasing: "#252d38",
      roadFill: "#525f6c",
      roadMajorCasing: "#222933",
      roadMajorFill: "#3d4754",
      roadMedium: "#252d38",
      text: "#c2cad4",
      textHalo: "rgba(8,12,18,0.9)",
    },
  };

  const MODEL_FALLBACK = "#94a3b8";
  const FULL_BOUNDS: [[number, number], [number, number]] = [[-127, 21], [-65, 50]];
  const FIT_PADDING = isMobile ? 6 : 10;

  function fitToSelection() {
    if (!map) return;
    if (selectedStates.size === 0) {
      map.fitBounds(FULL_BOUNDS, { padding: FIT_PADDING, duration: 500 });
      return;
    }
    const points = agencies
      .filter((a) => selectedStates.has(a.state) && a.lat != null && a.lng != null)
      .map((a) => toInsetCoords(a.lng!, a.lat!, a.state));
    if (points.length === 0) {
      map.fitBounds(FULL_BOUNDS, { padding: FIT_PADDING, duration: 500 });
      return;
    }
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const [lng, lat] of points) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, duration: 500, maxZoom: 8 });
  }

  $: selectedStates, fitToSelection();

  $: geojson = {
    type: "FeatureCollection",
    features: agencies
      .filter((a) => a.lat != null && a.lng != null)
      .map((a) => {
        const [lng, lat] = toInsetCoords(a.lng!, a.lat!, a.state);
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: {
            slug: a.slug,
            name: a.name,
            state: a.state,
            city: a.city ?? "",
            primary_model: a.primary_model ?? "",
            models: a.models.join(", "),
            population: a.population ?? 0,
            officer_ct: a.lee?.officer_ct ?? 0,
            color: MODEL_COLORS[a.primary_model ?? ""] ?? MODEL_FALLBACK,
          },
        };
      }),
  };

  const updateSource = () => {
    if (!map) return;
    const src = map.getSource("agencies");
    if (src) src.setData(geojson);
  };

  $: if (map) updateSource();

  // Re-paint when the user toggles the palette via the selector. Covers
  // every layer that has a palette-driven color so the switch updates
  // basemap, labels, and roads in one pass without remount.
  $: if (map && map.isStyleLoaded()) {
    const c = PALETTES[palette];
    map.setPaintProperty("background", "background-color", c.bg);
    if (map.getLayer("state-fills"))
      map.setPaintProperty("state-fills", "fill-color", c.state);
    if (map.getLayer("state-patrol-tint"))
      map.setPaintProperty("state-patrol-tint", "fill-color", c.tint);
    if (map.getLayer("state-lines")) {
      map.setPaintProperty("state-lines", "line-color", c.line);
      map.setPaintProperty("state-lines", "line-width", c.lineWidth);
    }
    if (map.getLayer("county-lines"))
      map.setPaintProperty("county-lines", "line-color", c.county);
    if (map.getLayer("highway-static-casing"))
      map.setPaintProperty("highway-static-casing", "line-color", c.roadCasing);
    if (map.getLayer("highway-static-fill"))
      map.setPaintProperty("highway-static-fill", "line-color", c.roadFill);
    if (map.getLayer("road-highway-casing"))
      map.setPaintProperty("road-highway-casing", "line-color", c.roadCasing);
    if (map.getLayer("road-highway-fill"))
      map.setPaintProperty("road-highway-fill", "line-color", c.roadFill);
    if (map.getLayer("agencies"))
      map.setPaintProperty("agencies", "circle-stroke-color", c.bg);
    if (map.getLayer("road-major-casing"))
      map.setPaintProperty("road-major-casing", "line-color", c.roadMajorCasing);
    if (map.getLayer("road-major-fill"))
      map.setPaintProperty("road-major-fill", "line-color", c.roadMajorFill);
    if (map.getLayer("road-medium"))
      map.setPaintProperty("road-medium", "line-color", c.roadMedium);
    for (const id of ["places-major", "places-minor", "places-all"]) {
      if (!map.getLayer(id)) continue;
      map.setPaintProperty(id, "text-color", c.text);
      map.setPaintProperty(id, "text-halo-color", c.textHalo);
    }
  }

  onMount(async () => {
    if (!browser) return;

    const ml = await import("maplibre-gl");
    await ensurePmtilesProtocol(ml);

    const FIT_BOUNDS = FULL_BOUNDS;
    const FIT_OPTIONS = { padding: FIT_PADDING, animate: false };

    const ro = new ResizeObserver(() => {
      if (!map) return;
      map.resize();
      // If the user is at (or below) the floor zoom, re-fit and update the floor
      // so the map stays snug in the container after orientation changes
      if (map.getZoom() <= map.getMinZoom() + 0.15) {
        map.fitBounds(FIT_BOUNDS, FIT_OPTIONS);
        map.setMinZoom(map.getZoom());
      }
    });
    ro.observe(container);

    map = new ml.Map({
      container,
      style: {
        version: 8,
        sources: {},
        glyphs: PMTILES_GLYPHS,
        projection: { type: "mercator" },
        layers: [
          { id: "background", type: "background", paint: { "background-color": PALETTES[palette].bg } },
        ],
      } as any,
      // Inset layout: continental US + territory insets all fit in this window
      bounds: FIT_BOUNDS,
      fitBoundsOptions: FIT_OPTIONS,
      minZoom: 1,   // overridden on load below
      maxZoom: 14,
      attributionControl: { compact: true },
    });

    map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", async () => {
      // Resize first so MapLibre knows the true container dimensions on mobile,
      // then re-fit so the full map fills the container, then lock the floor zoom.
      map.resize();
      map.fitBounds(FIT_BOUNDS, FIT_OPTIONS);
      map.setMinZoom(map.getZoom());

      const statesGj = await fetch("/us-inset.geojson").then((r) => r.json());
      map.addSource("states", { type: "geojson", data: statesGj });

      map.addLayer({
        id: "state-fills",
        type: "fill",
        source: "states",
        paint: { "fill-color": PALETTES[palette].state, "fill-opacity": 1 },
      });

      // Warm tint over states whose 287(g) participants include a literal
      // state police / highway patrol. Subtle — it should read as "huh,
      // something different about that state" without competing with the
      // dot colors.
      if (statePatrolStates.length) {
        const patrolStateNames = statePatrolStates
          .map((abbr) => STATE_NAMES[abbr])
          .filter(Boolean);
        map.addLayer({
          id: "state-patrol-tint",
          type: "fill",
          source: "states",
          filter: ["in", ["get", "name"], ["literal", patrolStateNames]],
          paint: { "fill-color": PALETTES[palette].tint, "fill-opacity": 1 },
        });
      }

      map.addLayer({
        id: "state-lines",
        type: "line",
        source: "states",
        paint: {
          "line-color": PALETTES[palette].line,
          "line-width": PALETTES[palette].lineWidth,
        },
      });

      // County lines — appear at zoom 5+
      map.addSource("counties", {
        type: "geojson",
        data: "/us-inset-counties.geojson",
      });

      map.addLayer({
        id: "county-lines",
        type: "line",
        source: "counties",
        minzoom: 5,
        paint: {
          "line-color": PALETTES[palette].county,
          "line-width": 0.4,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 5.5, 0.7],
        },
      });

      // Static inset highways for the lowest zoom levels — PMTiles' roads
      // source starts at zoom 3, but mobile's locked-floor view sits below
      // that. The hand-baked geojson covers the inset layout (incl. AK/HI)
      // and fades out by ~zoom 4.5 as PMTiles takes over.
      map.addSource("highways-static", {
        type: "geojson",
        data: "/us-highways.geojson",
      });
      map.addLayer({
        id: "highway-static-casing",
        type: "line",
        source: "highways-static",
        maxzoom: 4.5,
        paint: {
          "line-color": PALETTES[palette].roadCasing,
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.5, 4, 2.5],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.7, 4, 0.7, 4.5, 0],
        },
      });
      map.addLayer({
        id: "highway-static-fill",
        type: "line",
        source: "highways-static",
        maxzoom: 4.5,
        paint: {
          "line-color": PALETTES[palette].roadFill,
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 4, 1.2],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.9, 4, 0.9, 4.5, 0],
        },
      });

      // Shared PMTiles base — roads + place labels. Standard web-mercator,
      // so layers only align with the lower-48; AK/HI/territory insets are
      // intentionally left without road/city detail in this iteration.
      map.addSource("base", pmtilesBaseSource());

      // Interstates (kind: highway) — visible at every zoom, including the
      // national view. They're the connective tissue readers expect to see.
      // Min line-widths are bumped so the network reads as a network at
      // the locked-floor zoom, not just a hint.
      map.addLayer({
        id: "road-highway-casing",
        type: "line",
        source: "base",
        "source-layer": "roads",
        filter: ["==", ["get", "kind"], "highway"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": PALETTES[palette].roadCasing,
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.8, 5, 2.5, 9, 4, 12, 5.5],
          "line-opacity": 0.8,
        },
      });

      map.addLayer({
        id: "road-highway-fill",
        type: "line",
        source: "base",
        "source-layer": "roads",
        filter: ["==", ["get", "kind"], "highway"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": PALETTES[palette].roadFill,
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.8, 5, 1.2, 9, 2, 12, 3],
          "line-opacity": 0.95,
        },
      });

      // US/state highways — visible from zoom 5+ once the viewport is
      // narrow enough that they don't read as visual noise.
      map.addLayer({
        id: "road-major-casing",
        type: "line",
        source: "base",
        "source-layer": "roads",
        minzoom: 5,
        filter: ["==", ["get", "kind"], "major_road"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": PALETTES[palette].roadMajorCasing,
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.8, 9, 2, 12, 3.5],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 5.5, 0.65],
        },
      });

      map.addLayer({
        id: "road-major-fill",
        type: "line",
        source: "base",
        "source-layer": "roads",
        minzoom: 5,
        filter: ["==", ["get", "kind"], "major_road"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": PALETTES[palette].roadMajorFill,
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 9, 1.1, 12, 2],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 5.5, 0.9],
        },
      });

      // Medium roads fade in at city zoom for context
      map.addLayer({
        id: "road-medium",
        type: "line",
        source: "base",
        "source-layer": "roads",
        minzoom: 8,
        filter: ["==", ["get", "kind"], "medium_road"],
        paint: {
          "line-color": PALETTES[palette].roadMedium,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.4, 12, 1.5],
          "line-opacity": 0.8,
        },
      });

      // Place labels — Protomaps `population_rank`: lower = more populous.
      // Tiered so the national view shows only the biggest cities and more
      // appear as the user zooms in.
      map.addLayer({
        id: "places-major",
        type: "symbol",
        source: "base",
        "source-layer": "places",
        minzoom: 4,
        filter: [
          "all",
          ["==", ["get", "kind"], "locality"],
          ["<=", ["get", "population_rank"], 7],
        ],
        layout: {
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 8, 13],
          "text-anchor": "top",
          "text-offset": [0, 0.4],
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": PALETTES[palette].text,
          "text-halo-color": PALETTES[palette].textHalo,
          "text-halo-width": 1.5,
          "text-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 4.5, 1],
        },
      });

      map.addLayer({
        id: "places-minor",
        type: "symbol",
        source: "base",
        "source-layer": "places",
        minzoom: 6,
        filter: [
          "all",
          ["==", ["get", "kind"], "locality"],
          ["<=", ["get", "population_rank"], 9],
        ],
        layout: {
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 6, 9, 10, 12],
          "text-anchor": "top",
          "text-offset": [0, 0.4],
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": PALETTES[palette].text,
          "text-halo-color": PALETTES[palette].textHalo,
          "text-halo-width": 1.5,
          "text-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0, 6.5, 1],
        },
      });

      map.addLayer({
        id: "places-all",
        type: "symbol",
        source: "base",
        "source-layer": "places",
        minzoom: 8,
        filter: ["==", ["get", "kind"], "locality"],
        layout: {
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 10,
          "text-anchor": "top",
          "text-offset": [0, 0.4],
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": PALETTES[palette].text,
          "text-halo-color": PALETTES[palette].textHalo,
          "text-halo-width": 1.5,
          "text-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 8.5, 1],
        },
      });

      map.addSource("agencies", {
        type: "geojson",
        data: geojson,
      });

      // Agency dots — on top of city labels. Radius scales by sqrt of the
      // chosen metric so big departments read visibly heavier than rural
      // sheriff's offices, without erasing the small ones. Mobile gets a
      // tighter scale; ?scale=population|flat swaps the metric in dev for
      // visual tuning.
      const SCALE = isMobile ? 0.7 : 1;
      const sizeExpr =
        scaleMode === "flat"
          ? 20
          : ["sqrt", ["coalesce", ["get", scaleMode === "population" ? "population" : "officer_ct"], 0]];
      // Domain ceiling matched to each metric's 95th percentile:
      //   officers p95 = 307 → sqrt ≈ 17.5
      //   population p95 = 255k → sqrt ≈ 505
      const sizeDomainMax = scaleMode === "population" ? 600 : 18;
      const radius = (low: number, high: number) => [
        "interpolate", ["linear"], sizeExpr as any,
        0, low * SCALE,
        sizeDomainMax, high * SCALE,
      ];
      map.addLayer({
        id: "agencies",
        type: "circle",
        source: "agencies",
        paint: {
          "circle-color": ["get", "color"],
          // Slight stroke = bg color: knocks out a thin gap between
          // touching dots without reading as a halo. The reduced fill
          // opacity lets dense clusters (FL, TX) read as "many overlapping"
          // rather than a solid blob.
          "circle-stroke-width": 0.6,
          "circle-stroke-color": PALETTES[palette].bg,
          "circle-stroke-opacity": 1,
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            3, radius(0.8, 7),
            6, radius(2.2, 12),
            10, radius(4, 20),
          ],
          "circle-opacity": 0.7,
        },
      });

      // Popup
      const popup = new ml.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 10,
        className: "map-popup",
      });

      map.on("mouseenter", "agencies", (e: any) => {
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

      map.on("mouseleave", "agencies", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });

      map.on("click", "agencies", (e: any) => {
        if (!e.features?.length) return;
        const slug = e.features[0].properties.slug;
        if (slug) goto(`/agency/${slug}`);
      });

    });
  });

  onDestroy(() => {
    if (map) { map.remove(); map = null; }
  });

  // Expose resize for parent-driven layout changes (e.g. orientation change)
  export const resize = () => map?.resize();
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

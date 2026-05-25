<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import { MODEL_COLORS } from "$lib/colors";
  import { toInsetCoords } from "$lib/insetTransforms";

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
  }> = [];

  let container: HTMLDivElement;
  let map: any = null;

  const MODEL_FALLBACK = "#94a3b8";

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

  onMount(async () => {
    if (!browser) return;

    const ml = await import("maplibre-gl");

    const FIT_BOUNDS: [[number, number], [number, number]] = [[-127, 21], [-65, 50]];
    const FIT_OPTIONS = { padding: 24, animate: false };

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
        // Carto's glyph CDN for cluster count labels — fonts only, no basemap tiles
        glyphs: "https://fonts.basemaps.cartocdn.com/gl/fonts/{fontstack}/{range}.pbf",
        projection: { type: "mercator" },
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#dde4eb" } },
        ],
      } as any,
      // Inset layout: continental US + territory insets all fit in this window
      bounds: FIT_BOUNDS,
      fitBoundsOptions: FIT_OPTIONS,
      minZoom: 1,   // overridden on load below
      maxZoom: 14,
      attributionControl: false,
    });

    map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      // Resize first so MapLibre knows the true container dimensions on mobile,
      // then re-fit so the full map fills the container, then lock the floor zoom.
      map.resize();
      map.fitBounds(FIT_BOUNDS, FIT_OPTIONS);
      map.setMinZoom(map.getZoom());

      map.addSource("states", {
        type: "geojson",
        data: "/us-inset.geojson",
      });

      // State fills — white land against the blue-grey water background
      map.addLayer({
        id: "state-fills",
        type: "fill",
        source: "states",
        paint: {
          "fill-color": "#f5f4f5",
          "fill-opacity": 1,
        },
      });

      map.addLayer({
        id: "state-lines",
        type: "line",
        source: "states",
        paint: {
          "line-color": "#b8c4cf",
          "line-width": 0.75,
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
          "line-color": "#c8d4dc",
          "line-width": 0.4,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 5.5, 0.7],
        },
      });

      // Highways — casing + fill for a clean road look
      map.addSource("highways", {
        type: "geojson",
        data: "/us-highways.geojson",
      });

      // Casing (slightly wider, darker) drawn first so fill sits on top
      map.addLayer({
        id: "highway-casing",
        type: "line",
        source: "highways",
        minzoom: 4,
        paint: {
          "line-color": "#a0b0bc",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.5, 8, 3, 12, 5],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 4.5, 0.7],
        },
      });

      map.addLayer({
        id: "highway-fill",
        type: "line",
        source: "highways",
        minzoom: 4,
        paint: {
          "line-color": "#eef2f5",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.6, 8, 1.5, 12, 3],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 4.5, 0.9],
        },
      });

      // Cities — major (pop ≥ 300k) from zoom 4, all from zoom 6
      map.addSource("cities", {
        type: "geojson",
        data: "/us-cities.geojson",
      });

      map.addLayer({
        id: "cities-major",
        type: "symbol",
        source: "cities",
        minzoom: 4,
        filter: ["<=", ["get", "rank"], 2],
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 8, 13],
          "text-anchor": "top",
          "text-offset": [0, 0.4],
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#334155",
          "text-halo-color": "rgba(255,255,255,0.85)",
          "text-halo-width": 1.5,
          "text-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 4.5, 1],
        },
      });

      map.addLayer({
        id: "cities-minor",
        type: "symbol",
        source: "cities",
        minzoom: 6,
        filter: ["<=", ["get", "rank"], 3],
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 6, 9, 10, 12],
          "text-anchor": "top",
          "text-offset": [0, 0.4],
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#475569",
          "text-halo-color": "rgba(255,255,255,0.85)",
          "text-halo-width": 1.5,
          "text-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0, 6.5, 1],
        },
      });

      map.addLayer({
        id: "cities-all",
        type: "symbol",
        source: "cities",
        minzoom: 8,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
          "text-size": 10,
          "text-anchor": "top",
          "text-offset": [0, 0.4],
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#64748b",
          "text-halo-color": "rgba(255,255,255,0.85)",
          "text-halo-width": 1.5,
          "text-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 8.5, 1],
        },
      });

      map.addSource("agencies", {
        type: "geojson",
        data: geojson,
      });

      // Agency dots — on top of city labels
      map.addLayer({
        id: "agencies",
        type: "circle",
        source: "agencies",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2, 6, 4, 10, 7],
          "circle-stroke-width": 1,
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-opacity": 1,
          "circle-opacity": 0.65,
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
        popup
          .setLngLat(coords)
          .setHTML(
            `<div class="popup-name">${p.name}</div>` +
            `<div class="popup-sub">${[p.city, p.state].filter(Boolean).join(", ")}</div>` +
            (p.models ? `<div class="popup-model">${p.models}</div>` : ""),
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
  :global(.map-popup .popup-model) {
    color: #334155;
    margin-top: 4px;
    font-size: 11px;
    font-style: italic;
  }
</style>

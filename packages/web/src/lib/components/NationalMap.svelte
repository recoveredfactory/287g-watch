<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import { MODEL_COLORS } from "$lib/colors";

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
      .map((a) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [a.lng, a.lat] },
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
      })),
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

    const ro = new ResizeObserver(() => { map?.resize(); });
    ro.observe(container);

    map = new ml.Map({
      container,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      bounds: [[-125, 24], [-66, 50]], // continental US — zoom calculated from container size
      fitBoundsOptions: { padding: 24, animate: false },
      minZoom: 2,
      maxZoom: 14,
      attributionControl: false,
    });

    map.addControl(new ml.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      // State boundary lines
      map.addSource("states", {
        type: "geojson",
        data: "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json",
      });

      map.addLayer({
        id: "state-lines",
        type: "line",
        source: "states",
        paint: {
          "line-color": "#94a3b8",
          "line-width": 1,
          "line-opacity": 0.7,
        },
      });

      map.addSource("agencies", {
        type: "geojson",
        data: geojson,
        cluster: true,
        clusterMaxZoom: 7,
        clusterRadius: 40,
      });

      // Clusters
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "agencies",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#1e3a5f",
          "circle-radius": ["step", ["get", "point_count"], 16, 5, 22, 20, 28],
          "circle-opacity": 0.85,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "agencies",
        filter: ["has", "point_count"],
        layout: {
          "text-field": "{point_count_abbreviated}",
          "text-size": 12,
          "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
        },
        paint: { "text-color": "#ffffff" },
      });

      // Individual dots
      map.addLayer({
        id: "agencies",
        type: "circle",
        source: "agencies",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 5, 8, 8, 12, 12],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.9,
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

      // Expand clusters on click (v5: Promise-based)
      map.on("click", "clusters", async (e: any) => {
        if (!e.features?.length) return;
        const clusterId = e.features[0].properties.cluster_id;
        const src = map.getSource("agencies");
        try {
          const zoom = await src.getClusterExpansionZoom(clusterId);
          map.easeTo({ center: e.features[0].geometry.coordinates, zoom });
        } catch {
          // ignore
        }
      });

      map.on("mouseenter", "clusters", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "clusters", () => { map.getCanvas().style.cursor = ""; });
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

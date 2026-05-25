<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { browser } from "$app/environment";
  import { MODEL_COLORS } from "$lib/colors";
  import { toInsetCoords } from "$lib/insetTransforms";
  import { STATE_NAMES } from "$lib/states";

  export let lat: number | null | undefined = undefined;
  export let lng: number | null | undefined = undefined;
  export let state: string;
  export let primaryModel: string | null | undefined = undefined;

  const MODEL_FALLBACK = "#94a3b8";

  // us-atlas uses different names for these two territories
  const GJ_NAME_OVERRIDE: Record<string, string> = {
    VI: "United States Virgin Islands",
    MP: "Commonwealth of the Northern Mariana Islands",
  };

  let container: HTMLDivElement;
  let map: any = null;

  onMount(async () => {
    if (!browser || !container) return;

    const ml = await import("maplibre-gl");

    const dotCoords: [number, number] | null =
      lat != null && lng != null ? toInsetCoords(lng, lat, state) : null;

    map = new ml.Map({
      container,
      style: {
        version: 8,
        sources: {},
        glyphs: "https://fonts.basemaps.cartocdn.com/gl/fonts/{fontstack}/{range}.pbf",
        projection: { type: "mercator" },
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#dde4eb" } },
        ],
      } as any,
      center: dotCoords ?? [-98, 39],
      zoom: 5,
      interactive: false,
      attributionControl: false,
    });

    map.on("load", async () => {
      map.resize();

      const stateGjName =
        GJ_NAME_OVERRIDE[state] ?? STATE_NAMES[state] ?? state;

      const [statesGj, countiesGj] = await Promise.all([
        fetch("/us-inset.geojson").then((r) => r.json()),
        fetch("/us-inset-counties.geojson").then((r) => r.json()),
      ]);

      map.addSource("states", { type: "geojson", data: statesGj });

      // Background states — muted grey
      map.addLayer({
        id: "states-bg",
        type: "fill",
        source: "states",
        paint: { "fill-color": "#e2e8ed", "fill-opacity": 1 },
      });

      // This state — clean white
      map.addLayer({
        id: "state-highlight",
        type: "fill",
        source: "states",
        filter: ["==", ["get", "name"], stateGjName],
        paint: { "fill-color": "#f5f4f5", "fill-opacity": 1 },
      });

      map.addLayer({
        id: "state-lines",
        type: "line",
        source: "states",
        paint: { "line-color": "#b8c4cf", "line-width": 0.75 },
      });

      map.addSource("counties", { type: "geojson", data: countiesGj });
      map.addLayer({
        id: "county-lines",
        type: "line",
        source: "counties",
        paint: { "line-color": "#c8d4dc", "line-width": 0.4 },
      });

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
        map.addLayer({
          id: "agency-dot",
          type: "circle",
          source: "agency",
          paint: {
            "circle-color": color,
            "circle-radius": 9,
            "circle-stroke-width": 2.5,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": 0.9,
          },
        });
      }

      // Fit to the state's bounding box
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
        map.fitBounds(bounds, { padding: 28, animate: false });
      }
    });
  });

  onDestroy(() => {
    if (map) { map.remove(); map = null; }
  });
</script>

<div bind:this={container} class="h-full w-full"></div>

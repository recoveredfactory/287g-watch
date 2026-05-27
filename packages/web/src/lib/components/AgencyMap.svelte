<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_SHORT } from "$lib/colors";
  import { localizeHref } from "$lib/paraglide/runtime";
  import { toInsetCoords } from "$lib/insetTransforms";
  import { STATE_NAMES } from "$lib/states";

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

      // Background states — almost the same off-white as the highlight so
      // neighboring states still feel like part of the map (was a chillier
      // grey before, which made other states feel "switched off").
      map.addLayer({
        id: "states-bg",
        type: "fill",
        source: "states",
        paint: { "fill-color": "#eef0f2", "fill-opacity": 1 },
      });

      // This state — a touch warmer/brighter so it reads as the focus
      // without dimming everyone else.
      map.addLayer({
        id: "state-highlight",
        type: "fill",
        source: "states",
        filter: ["==", ["get", "name"], stateGjName],
        paint: { "fill-color": "#fafaf8", "fill-opacity": 1 },
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
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              4, ["interpolate", ["linear"], sqrtOfficers, 0, 1.2 * SCALE, 18, 4.5 * SCALE],
              7, ["interpolate", ["linear"], sqrtOfficers, 0, 1.8 * SCALE, 18, 6.5 * SCALE],
              10, ["interpolate", ["linear"], sqrtOfficers, 0, 2.5 * SCALE, 18, 9 * SCALE],
            ],
            "circle-opacity": 0.55,
            "circle-stroke-width": 0.5,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-opacity": 0.6,
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
        // Outer ring (white halo) so the current dot pops against the
        // context dots regardless of model color
        map.addLayer({
          id: "agency-halo",
          type: "circle",
          source: "agency",
          paint: {
            "circle-color": "#ffffff",
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
            "circle-stroke-color": "#ffffff",
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

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_SHORT } from "$lib/colors";
  import { localizeHref } from "$lib/paraglide/runtime";
  import { toInsetCoords } from "$lib/insetTransforms";
  import { STATE_NAMES } from "$lib/states";
  import { ensurePmtilesProtocol, pmtilesBaseSource, PMTILES_GLYPHS } from "$lib/map/pmtiles";

  // Inset territories sit at shifted coords; loading PMTiles over them
  // would draw foreign tiles. Affects 5 agencies total (AK, GU, MP).
  const INSET_STATES = new Set(["AK", "HI", "PR", "VI", "GU", "MP", "AS"]);

  // Dark is the only palette — keeps map tone consistent with the homepage.
  // The agency view has its own spec because it draws non-current states
  // distinctly (so the current state pops without dimming neighbors as harshly).
  const p = {
    bg: "#0c1117",
    stateBg: "#161e27",
    stateHighlight: "#27323e",
    stateLines: "#475d76",
    stateLineWidth: 0.7,
    stateHighlightBorder: "#94a3b8",
    stateHighlightBorderWidth: 1.8,
    county: "#1c242e",
    roadCasing: "#2c2622",
    roadFill: "#605650",
    roadMedium: "#2c2622",
    haloFill: "#e8ecf2",
    dotStroke: "rgba(255,255,255,0.18)",
    dotStrokeWidth: 0.25,
    text: "#c2cad4",
    textHalo: "rgba(8,12,18,0.9)",
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

  onMount(async () => {
    if (!browser || !container) return;

    const ml = await import("maplibre-gl");
    await ensurePmtilesProtocol(ml);

    const showPmtilesRoads = !INSET_STATES.has(state);
    const dotCoords: [number, number] | null =
      lat != null && lng != null ? toInsetCoords(lng, lat, state) : null;

    map = new ml.Map({
      container,
      style: {
        version: 8,
        sources: {},
        glyphs: PMTILES_GLYPHS,
        projection: { type: "mercator" },
        layers: [
          { id: "background", type: "background", paint: { "background-color": p.bg } },
        ],
      } as any,
      center: dotCoords ?? [-98, 39],
      zoom: 5,
      minZoom: 3,
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

      // Bright border on the current state so the locator reads instantly
      // even at the country-wide overview zoom. Drawn over the shared
      // state-lines layer so it wins against shared edges with neighbors.
      map.addLayer({
        id: "state-highlight-border",
        type: "line",
        source: "states",
        filter: ["==", ["get", "name"], stateGjName],
        paint: {
          "line-color": p.stateHighlightBorder,
          "line-width": p.stateHighlightBorderWidth,
        },
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
            "circle-stroke-width": p.dotStrokeWidth,
            "circle-stroke-color": p.dotStroke,
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
      // of the same dataset. Touch devices use a two-tap pattern (first
      // tap shows the popup, second tap navigates) since they fire
      // mouseenter and click in the same gesture.
      const popup = new ml.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 10,
        className: "map-popup",
      });
      const hasHoverPointer = window.matchMedia("(hover: hover)").matches;
      let popupSlug: string | null = null;

      const buildPopupHtml = (p: any): string => {
        const modelBadges = p.models
          ? p.models.split(", ").map((model: string) => {
              const bg = MODEL_COLORS[model] ?? "#e2e8f0";
              const fg = MODEL_TEXT_COLORS[model] ?? "#0f172a";
              const label = MODEL_SHORT[model] ?? model;
              return `<span style="display:inline-block;background:${bg};color:${fg};border-radius:3px;padding:1px 7px;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${label}</span>`;
            }).join(" ")
          : "";
        return `<div class="popup-name">${p.name}</div>` +
          `<div class="popup-sub">${[p.city, p.state].filter(Boolean).join(", ")}</div>` +
          (modelBadges ? `<div class="popup-badges">${modelBadges}</div>` : "");
      };

      const showPopupForFeature = (f: any) => {
        const props = f.properties;
        popup
          .setLngLat(f.geometry.coordinates.slice())
          .setHTML(buildPopupHtml(props))
          .addTo(map);
        popupSlug = props.slug;
        if (!hasHoverPointer && props.slug) {
          const el = popup.getElement();
          if (el) {
            el.style.cursor = "pointer";
            el.addEventListener(
              "click",
              (ev) => { ev.stopPropagation(); goto(localizeHref(`/agency/${props.slug}`)); },
              { once: true },
            );
          }
        }
      };

      const dismissPopup = () => {
        popup.remove();
        popupSlug = null;
      };

      map.on("mouseenter", "context-agencies", (e: any) => {
        if (!hasHoverPointer) return;
        if (!e.features?.length) return;
        map.getCanvas().style.cursor = "pointer";
        showPopupForFeature(e.features[0]);
      });
      map.on("mouseleave", "context-agencies", () => {
        if (!hasHoverPointer) return;
        map.getCanvas().style.cursor = "";
        dismissPopup();
      });
      map.on("click", "context-agencies", (e: any) => {
        if (!e.features?.length) return;
        const f = e.features[0];
        const slug = f.properties.slug;
        if (!hasHoverPointer && popupSlug !== slug) {
          showPopupForFeature(f);
          return;
        }
        if (slug) goto(localizeHref(`/agency/${slug}`));
      });
      map.on("click", (e: any) => {
        if (hasHoverPointer || !popupSlug) return;
        const feats = map.queryRenderedFeatures(e.point, { layers: ["context-agencies"] });
        if (feats.length === 0) dismissPopup();
      });

      // Place labels — added LAST so they sit on top of dots. Looser
      // filters than the homepage map because the state-fit zoom (~5-7)
      // needs mid-sized cities to show without further zooming.
      if (showPmtilesRoads) {
        map.addLayer({
          id: "places-major",
          type: "symbol",
          source: "base",
          "source-layer": "places",
          minzoom: 3,
          filter: ["==", ["get", "kind"], "locality"],
          layout: {
            "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
            "text-font": ["Noto Sans Regular"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 8, 13],
            "text-anchor": "top",
            "text-offset": [0, 0.4],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-color": p.text,
            "text-halo-color": p.textHalo,
            "text-halo-width": 1.5,
          },
        });
      }

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

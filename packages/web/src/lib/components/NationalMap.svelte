<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_SHORT } from "$lib/colors";
  import { toInsetCoords } from "$lib/insetTransforms";
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
    signed_date?: string | null;
  }> = [];

  // Continuous timeline cursor for the smooth playback animation. The value is
  // a fractional month index relative to Jan 2025 (idx 0 = Jan 2025, idx 16 =
  // May 2026, etc.). Agencies signed before Jan 2025 carry a large negative
  // signed_idx so they're shown unconditionally. null = no timeline; the layer
  // renders all dots at full opacity.
  export let cursorIdx: number | null = null;

  let container: HTMLDivElement;
  let map: any = null;
  const isMobile = browser && window.matchMedia("(max-width: 640px)").matches;

  // Dark is the only palette — steely analytical mode, replaces the prior
  // slate/dark toggle so map tone reads consistently across the site.
  const C = {
    bg: "#0c1117",
    state: "#18202a",
    line: "#3a4552",
    lineWidth: 0.6,
    county: "#1c242e",
    roadCasing: "#252d38",
    roadFill: "#525f6c",
    roadMajorCasing: "#222933",
    roadMajorFill: "#3d4754",
    roadMedium: "#252d38",
    dotStroke: "rgba(255,255,255,0.18)",
    dotStrokeWidth: 0.25,
    text: "#c2cad4",
    textHalo: "rgba(8,12,18,0.9)",
  };

  const MODEL_FALLBACK = "#94a3b8";
  const FULL_BOUNDS: [[number, number], [number, number]] = [[-127, 21], [-65, 50]];
  // On wide desktops the container aspect can exceed the bbox aspect, which
  // makes fitBounds size by latitude and pin the southern bound (21°) to the
  // very bottom — clipping AK's inset (extends to ~18°). Asymmetric bottom
  // padding gives AK breathing room without redoing the inset transform.
  const FIT_PADDING: any = isMobile ? 6 : { top: 14, bottom: 70, left: 14, right: 14 };

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

  // Fractional month index from Jan 2025 (idx 0). Pre-2025 signings (and any
  // missing dates) get a deeply negative value so they're always past the
  // fade-in window — i.e. shown unconditionally as the baseline.
  const BASELINE_IDX = -10000;
  const TIMELINE_EPOCH_YEAR = 2025;
  const signedDateIdx = (d?: string | null): number => {
    if (!d || d.length < 10) return BASELINE_IDX;
    const y = Number(d.slice(0, 4));
    const m = Number(d.slice(5, 7));
    const day = Number(d.slice(8, 10));
    if (y < TIMELINE_EPOCH_YEAR) return BASELINE_IDX;
    return (y - TIMELINE_EPOCH_YEAR) * 12 + (m - 1) + (day - 1) / 31;
  };

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
            signed_idx: signedDateIdx(a.signed_date),
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

  // Smooth timeline transitions. Each dot fades + pops in over FADE_WINDOW
  // months after its signing date, so a continuous cursor reveals the data as
  // a gentle wave rather than monthly cliff. Baseline dots (negative
  // signed_idx) clamp to full opacity at every cursor.
  const FADE_WINDOW = 0.35;
  const BASE_OPACITY = 0.7;
  const fadeMultiplier = (cursor: number) => [
    "interpolate", ["linear"],
    ["-", cursor, ["get", "signed_idx"]],
    -0.001, 0,
    0, 0,
    FADE_WINDOW, 1,
  ];
  const opacityWithFade = (cursor: number) => [
    "*", BASE_OPACITY, fadeMultiplier(cursor),
  ];

  // MapLibre rule: ["zoom"] can only appear as the direct input of a top-level
  // interpolate/step, never nested. So instead of wrapping the existing radius
  // expression in ["*", fade, ...], we keep `interpolate(linear, [zoom], ...)`
  // at the top and multiply fade INTO each per-zoom stop's output.
  let radiusStops: Array<[number, any]> = [];
  const baseRadiusExpression = (): any => {
    if (!radiusStops.length) return 1;
    return ["interpolate", ["linear"], ["zoom"], ...radiusStops.flat()];
  };
  const radiusWithFade = (cursor: number): any => {
    if (!radiusStops.length) return 1;
    const fm = fadeMultiplier(cursor);
    const flat: any[] = [];
    for (const [z, r] of radiusStops) flat.push(z, ["*", fm, r]);
    return ["interpolate", ["linear"], ["zoom"], ...flat];
  };

  $: if (map && map.getLayer && map.getLayer("agencies")) {
    if (cursorIdx == null) {
      map.setPaintProperty("agencies", "circle-opacity", BASE_OPACITY);
      map.setPaintProperty("agencies", "circle-radius", baseRadiusExpression());
    } else {
      map.setPaintProperty("agencies", "circle-opacity", opacityWithFade(cursorIdx));
      map.setPaintProperty("agencies", "circle-radius", radiusWithFade(cursorIdx));
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
          { id: "background", type: "background", paint: { "background-color": C.bg } },
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

      // Don't hijack page scroll at the locked-floor zoom — at full zoom-out
      // there's nothing to scroll-zoom into anyway, and a wheel over the map
      // would otherwise eat the page scroll. Re-enables once the user has
      // zoomed in via the +/− buttons, double-click, or pinch.
      const syncScrollZoom = () => {
        if (!map) return;
        if (map.getZoom() > map.getMinZoom() + 0.05) map.scrollZoom.enable();
        else map.scrollZoom.disable();
      };
      map.scrollZoom.disable();
      map.on("zoomend", syncScrollZoom);

      const statesGj = await fetch("/us-inset.geojson").then((r) => r.json());
      map.addSource("states", { type: "geojson", data: statesGj });

      map.addLayer({
        id: "state-fills",
        type: "fill",
        source: "states",
        paint: { "fill-color": C.state, "fill-opacity": 1 },
      });

      map.addLayer({
        id: "state-lines",
        type: "line",
        source: "states",
        paint: {
          "line-color": C.line,
          "line-width": C.lineWidth,
          // Fainter at the locked-floor national view (zoom ~1) so the country
          // doesn't read as a cage of borders. Ramps to full visibility once
          // individual states fill the screen.
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.45, 3, 0.9],
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
          "line-color": C.county,
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
      // Static and PMTiles highways used to both render at zoom 2–4.5, which
      // double-stroked every interstate. Static now fades out 3.5→4.5 and
      // PMTiles fades in over the same window — single highway at every zoom.
      // Static opacity is kept low so the national view reads as "hint of road
      // network" rather than a full road map.
      map.addLayer({
        id: "highway-static-casing",
        type: "line",
        source: "highways-static",
        maxzoom: 4.5,
        paint: {
          "line-color": C.roadCasing,
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.2, 4, 2.2],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.35, 3.5, 0.35, 4.5, 0],
        },
      });
      map.addLayer({
        id: "highway-static-fill",
        type: "line",
        source: "highways-static",
        maxzoom: 4.5,
        paint: {
          "line-color": C.roadFill,
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.5, 4, 1.0],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.5, 3.5, 0.5, 4.5, 0],
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
          "line-color": C.roadCasing,
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.8, 5, 2.5, 9, 4, 12, 5.5],
          // Fades in 3.5→4.5 as the static overlay fades out — single highway at every zoom.
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 3.5, 0, 4.5, 0.8],
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
          "line-color": C.roadFill,
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.8, 5, 1.2, 9, 2, 12, 3],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 3.5, 0, 4.5, 0.95],
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
          "line-color": C.roadMajorCasing,
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
          "line-color": C.roadMajorFill,
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
          "line-color": C.roadMedium,
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
          "text-color": C.text,
          "text-halo-color": C.textHalo,
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
          "text-color": C.text,
          "text-halo-color": C.textHalo,
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
          "text-color": C.text,
          "text-halo-color": C.textHalo,
          "text-halo-width": 1.5,
          "text-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 8.5, 1],
        },
      });

      map.addSource("agencies", {
        type: "geojson",
        data: geojson,
      });

      // Agency dots — on top of city labels. Radius scales by sqrt of the
      // officer count so big departments read visibly heavier than rural
      // sheriff's offices, without erasing the small ones. Mobile gets a
      // tighter scale. Domain ceiling = officer p95 (~307) → sqrt ≈ 17.5.
      const SCALE = isMobile ? 0.7 : 1;
      const sizeExpr: any = ["sqrt", ["coalesce", ["get", "officer_ct"], 0]];
      const sizeDomainMax = 18;
      const radius = (low: number, high: number) => [
        "interpolate", ["linear"], sizeExpr,
        0, low * SCALE,
        sizeDomainMax, high * SCALE,
      ];
      // Captured so the timeline cursor's paint updates can rebuild the radius
      // interpolation each frame with the fade multiplier applied per-stop.
      radiusStops = [
        [3, radius(0.8, 7)],
        [6, radius(2.2, 12)],
        [10, radius(4, 20)],
      ];
      const initialRadius = cursorIdx == null
        ? baseRadiusExpression()
        : radiusWithFade(cursorIdx);
      const initialOpacity = cursorIdx == null
        ? BASE_OPACITY
        : opacityWithFade(cursorIdx);
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
          "circle-stroke-width": C.dotStrokeWidth,
          "circle-stroke-color": C.dotStroke,
          "circle-stroke-opacity": 1,
          "circle-radius": initialRadius,
          "circle-opacity": initialOpacity,
        },
      });

      // Popup
      const popup = new ml.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 10,
        className: "map-popup",
      });

      // Touch devices have no hover, so the existing mouseenter→click chain
      // fires the popup and the navigation in the same gesture and the user
      // never sees the tooltip. Gate hover handlers to real hover devices;
      // touch uses a two-tap pattern: first tap shows the popup, second tap
      // on the same dot (or on the popup itself) navigates.
      const hasHoverPointer = window.matchMedia("(hover: hover)").matches;
      let popupSlug: string | null = null;

      const isFeatureVisible = (p: any): boolean => {
        if (cursorIdx == null) return true;
        const idx = Number(p.signed_idx);
        if (!Number.isFinite(idx)) return true;
        return idx <= cursorIdx;
      };

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
        const p = f.properties;
        popup
          .setLngLat(f.geometry.coordinates.slice())
          .setHTML(buildPopupHtml(p))
          .addTo(map);
        popupSlug = p.slug;
        if (!hasHoverPointer && p.slug) {
          const el = popup.getElement();
          if (el) {
            el.style.cursor = "pointer";
            el.addEventListener(
              "click",
              (ev) => { ev.stopPropagation(); goto(`/agency/${p.slug}`); },
              { once: true },
            );
          }
        }
      };

      const dismissPopup = () => {
        popup.remove();
        popupSlug = null;
      };

      map.on("mouseenter", "agencies", (e: any) => {
        if (!hasHoverPointer) return;
        if (!e.features?.length) return;
        const f = e.features[0];
        if (!isFeatureVisible(f.properties)) return;
        map.getCanvas().style.cursor = "pointer";
        showPopupForFeature(f);
      });

      map.on("mouseleave", "agencies", () => {
        if (!hasHoverPointer) return;
        map.getCanvas().style.cursor = "";
        dismissPopup();
      });

      map.on("click", "agencies", (e: any) => {
        if (!e.features?.length) return;
        const f = e.features[0];
        if (!isFeatureVisible(f.properties)) return;
        const slug = f.properties.slug;
        // Touch: first tap on a new dot opens the popup; second tap on the
        // same dot navigates. Hover devices navigate immediately as before.
        if (!hasHoverPointer && popupSlug !== slug) {
          showPopupForFeature(f);
          return;
        }
        if (slug) goto(`/agency/${slug}`);
      });

      // Touch: tap on empty map dismisses the popup. Hover devices already
      // handle dismissal via mouseleave.
      map.on("click", (e: any) => {
        if (hasHoverPointer || !popupSlug) return;
        const feats = map.queryRenderedFeatures(e.point, { layers: ["agencies"] });
        if (feats.length === 0) dismissPopup();
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

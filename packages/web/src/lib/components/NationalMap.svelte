<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_SHORT } from "$lib/colors";
  import { toInsetCoords, INSET_TRANSFORMS } from "$lib/insetTransforms";
  import { STATE_NAMES } from "$lib/states";
  import { ensurePmtilesProtocol, pmtilesBaseSource, PMTILES_GLYPHS } from "$lib/map/pmtiles";
  import { setupMapNavigation } from "$lib/map/touchPopup";
  import { mediaQuery } from "$lib/reactiveMedia";

  export let selectedStates: Set<string> = new Set();

  type MapAgency = {
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
    terminated_date?: string | null;
  };
  export let agencies: MapAgency[] = [];
  // Once-active agencies that have left 287(g). Rendered as dots that fade in at
  // their signing date (like any dot) and fade OUT as the cursor crosses their
  // terminated_date. Separate from `agencies` so topline counts stay active-only.
  export let terminatedAgencies: MapAgency[] = [];

  // Continuous timeline cursor for the smooth playback animation. The value is
  // a fractional month index relative to Jan 2025 (idx 0 = Jan 2025, idx 16 =
  // May 2026, etc.). Agencies signed before Jan 2025 carry a large negative
  // signed_idx so they're shown unconditionally. null = no timeline; the layer
  // renders all dots at full opacity.
  export let cursorIdx: number | null = null;

  // Lower-48-only framing (#167 video): hide the AK/HI/territory insets (dots +
  // shapes) and fit tight to the continental US so it fills the frame bigger.
  // The hidden jurisdictions are surfaced in the social caption instead.
  export let lower48 = false;

  // Multiplier on the dot radius scale. 1 = the live-map default (homepage).
  // The video (#167) bumps this so the dots read heavier against the smaller
  // lower-48 framing — the map is the data, not the basemap.
  export let dotScale = 1;

  // Flat pixels ADDED to every dot's radius (surge graphic "pop"). Additive, so
  // the smallest rural dots gain the same absolute lift as the biggest metros
  // — a uniform bump rather than a proportional one. 0 = live map untouched.
  export let dotBump = 0;

  // Optional readiness callback, fired once the map settles (first idle past the
  // initial render). The video composite (#213) renders two maps — the running
  // map and the faint title-card backdrop — and waits for both before baking, so
  // it can't lean on the single `window.__mapReady` global alone.
  export let onReady: (() => void) | null = null;

  // State-page "focus" mode: highlight the selected state(s) with a brighter
  // fill + accent border and dim every agency dot outside the selection. Lets a
  // state page show the whole national footprint while keeping its own state
  // the clear subject. Off (homepage) leaves all states and dots uniform.
  export let focusSelected = false;

  // Fit tuning for the single-state focus view (used when selectedStates has a
  // polygon match). Defaults reproduce the homepage's state-select framing;
  // the state page passes tighter values so the state fills its inset card.
  export let focusPadding = 80;
  export let focusMaxZoom = 6;

  // ── "New vs old" coloring (surge graphic, feat/surge-map-graphic) ───────────
  // A NON-DEFAULT variant. In "model" mode (the default, everywhere on the site)
  // dots are colored by primary_model exactly as before. In "newOld" mode each
  // dot is colored by whether its signing is recent: signed_date >= threshold →
  // `newColor`, else `oldColor`. The reveal animation (revealProgress 0→1) fades
  // + grows the NEW dots in, keyed by a per-dot `seq` (normalized signing order),
  // while OLD dots stay fully visible throughout.
  export let colorMode: "model" | "newOld" = "model";
  export let newOldThreshold = "2026-04-01";
  export let newColor = "#E8792B"; // orange — recent signings (the subject)
  export let oldColor = "#64748b"; // slate — the pre-surge baseline
  export let revealProgress = 1; // 0 = old dots only, 1 = all new dots in

  let container: HTMLDivElement;
  let map: any = null;
  // Flips true once the "load" callback has finished adding every source/
  // layer (including the cluster overlay). Needed as an explicit reactive
  // dependency below: `map` itself only changes once (null → instance,
  // synchronously in onMount, before "load" fires), so a `$: if (map &&
  // map.getSource(...))` guard with no other changing dependency may never
  // get a second chance to re-check once the source actually exists —
  // Svelte only re-runs a reactive block when one of ITS OWN tracked
  // dependencies changes, not when some unrelated async callback mutates
  // the map's internal state.
  let mapLoaded = false;
  // Reactive (resize/orientation-aware) — replaces a one-time matchMedia
  // check that used to freeze at whatever value was true at mount, leaving
  // dot scale and fit padding stale after a device rotation.
  const isMobileStore = mediaQuery("(max-width: 480px)");
  $: isMobile = $isMobileStore;
  // Snapshot at module init for the synchronous, pre-mount FIT_PADDING/bounds
  // setup below (onMount's initial fit can't await a store subscription).
  const isMobileInitial = browser && window.matchMedia("(max-width: 480px)").matches;

  // State polygons (inset coords), loaded once the "states" source is ready.
  // fitToSelection prefers these over agency points so a state with a sparse
  // agency footprint (e.g. only 1-2 dots near its center) still fits its full
  // shape instead of clipping the edges agency points don't reach.
  let statesGeoJson: { features: any[] } | null = null;

  // Light "documentary editorial" basemap — replaced the previous dark
  // "steely analytical" scheme (#118, #148). Land is lifted lighter than the
  // ocean/background so the country shape separates clearly, same
  // relationship the old dark scheme used (there: near-black sea, lighter
  // slate land) just inverted in tone, not in structure. Model dot colors
  // are unchanged (load-bearing, fixed) — contrast of the weakest (blue,
  // ~2.9:1 against the land fill) is close to what it was against the old
  // dark land fill (~4.4:1); a real-world light-basemap tradeoff, offset by
  // each dot's own light stroke rim for separation rather than relying on
  // fill contrast alone. NOTE: this only affects the default "model"
  // colorMode — colorMode="newOld" (the /video/surge bake-only graphic)
  // keeps its own separately-set dark fill/line further down, deliberately:
  // that's a distinct, already-published visual asset.
  // Cool-gray palette (matches app.css's ink/paper ramp — same hue family,
  // ~213°, kept here as raw hex since MapLibre paint expressions can't read
  // CSS custom properties; see app.css's @theme block for the rationale).
  // bg is darkened well below the land fill (not just a couple of points
  // lighter) — this map has no other-country geometry at all (the "states"
  // source is a custom US-only inset), so bg is the only thing separating
  // "USA" from "not USA"; it needs to read as a clearly different tone at a
  // glance, not just a subtle shade.
  const C = {
    bg: "#BFC6CF",
    state: "#F8F8F9",
    line: "#656C75",
    lineWidth: 0.7,
    county: "#DADEE2",
    roadCasing: "#FDFDFD",
    roadFill: "#7D8A99",
    roadMajorCasing: "#FDFDFD",
    roadMajorFill: "#6A798B",
    roadMedium: "#7D8A99",
    dotStroke: "rgba(253,253,253,0.55)",
    dotStrokeWidth: 0.35,
    text: "#393F46",
    textHalo: "rgba(253,253,253,0.9)",
    // Focus mode (focusSelected): the selected state's fill is lifted above the
    // base C.state and ringed with an accent border so it reads as the subject.
    // Rose accent matches the site's established general-notice/focus color
    // (homepage geo callout, states-index jump highlight, AgencyMap's own
    // state-highlight border below).
    stateHighlight: "#FDFDFD",
    highlightLine: "#BE6079",
    highlightLineWidth: 1.6,
  };

  // Base (non-suppressed) filters for the three place-label tiers, keyed by
  // layer id — shared between addLayer() and the inset-suppression toggle so
  // re-enabling labels restores the original population_rank tiering exactly.
  const PLACE_FILTERS: Record<string, any> = {
    "places-major": ["all", ["==", ["get", "kind"], "locality"], ["<=", ["get", "population_rank"], 7]],
    "places-minor": ["all", ["==", ["get", "kind"], "locality"], ["<=", ["get", "population_rank"], 9]],
    "places-all": ["==", ["get", "kind"], "locality"],
  };

  const MODEL_FALLBACK = "#94a3b8";
  const FULL_BOUNDS: [[number, number], [number, number]] = [[-127, 21], [-65, 50]];
  // Asymmetric padding:
  //   - Mobile pushes the country down (top: 110) so the top-mounted
  //     counter overlay doesn't cover the lower-48.
  //   - Desktop reserves bottom space (bottom: 70) so AK's inset (which
  //     extends to ~18° below the bbox south of 21°) has room on wide
  //     aspect ratios where fitBounds otherwise pins 21° to the edge.
  // Uses the synchronous snapshot (isMobileInitial), not the reactive
  // isMobile store — this const runs once at component init, before mount,
  // so it can't depend on statement-ordering against a $: assignment.
  const FIT_PADDING: any = isMobileInitial
    ? { top: 95, bottom: 8, left: 6, right: 6 }
    : { top: 14, bottom: 70, left: 14, right: 14 };

  // Lower-48-only framing: tight continental bounds (no inset band below 24°)
  // and near-uniform padding, so the country fills the frame.
  const LOWER48_BOUNDS: [[number, number], [number, number]] = [[-125, 24.4], [-66.95, 49.5]];
  const LOWER48_PADDING: any = { top: 16, bottom: 16, left: 16, right: 16 };
  const activeBounds = lower48 ? LOWER48_BOUNDS : FULL_BOUNDS;
  const activePadding = lower48 ? LOWER48_PADDING : FIT_PADDING;
  // Layer filter that drops the AK/HI/territory inset features when lower-48.
  // Non-lower-48 must be a real (match-everything) filter, NOT undefined:
  // MapLibre rejects `filter: undefined` ("array expected") and silently drops
  // the layer, which is what blanked the homepage's state fills/borders/counties
  // (dark-on-dark) after the lower-48 option landed. `["all"]` = no filter.
  const insetFilter: any = lower48 ? ["!", ["has", "inset"]] : ["all"];

  // Walk the state polygons (already in inset coordinate space) and return
  // the bbox covering every selected state's full shape — agency points
  // alone can leave a sparse state's edges (e.g. a panhandle with no dots)
  // outside the fitted view.
  function getPolygonBounds(abbrs: Set<string>): [[number, number], [number, number]] | null {
    if (!statesGeoJson) return null;
    const names = new Set([...abbrs].map((a) => STATE_NAMES[a] ?? a));
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    let found = false;
    for (const f of statesGeoJson.features) {
      if (!names.has(f.properties?.name)) continue;
      const polys: number[][][][] =
        f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
      for (const poly of polys) {
        for (const ring of poly) {
          for (const [lng, lat] of ring) {
            found = true;
            if (lng < minLng) minLng = lng;
            if (lat < minLat) minLat = lat;
            if (lng > maxLng) maxLng = lng;
            if (lat > maxLat) maxLat = lat;
          }
        }
      }
    }
    return found ? [[minLng, minLat], [maxLng, maxLat]] : null;
  }

  function fitToSelection() {
    if (!map) return;
    if (selectedStates.size === 0) {
      map.fitBounds(activeBounds, { padding: activePadding, duration: 500 });
      return;
    }
    const polyBounds = getPolygonBounds(selectedStates);
    if (polyBounds) {
      map.fitBounds(polyBounds, { padding: focusPadding, duration: 500, maxZoom: focusMaxZoom });
      return;
    }
    const points = agencies
      .filter((a) => selectedStates.has(a.state) && a.lat != null && a.lng != null)
      .map((a) => toInsetCoords(a.lng!, a.lat!, a.state));
    if (points.length === 0) {
      map.fitBounds(activeBounds, { padding: activePadding, duration: 500 });
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

  // AK/HI/territory insets sit at shifted coordinates that overlap real
  // continental US geography in the base tiles — Protomaps' place labels are
  // keyed by true lat/lng, so zooming into an inset shows the wrong city
  // names (e.g. Anchorage's inset position lands on some Montana town).
  // Suppress all place labels while an inset state is the selection.
  $: insetSelected = [...selectedStates].some((s) => s in INSET_TRANSFORMS);
  const HIDE_FILTER = ["==", ["get", "kind"], "__none__"];
  $: if (map) {
    for (const [id, baseFilter] of Object.entries(PLACE_FILTERS)) {
      if (map.getLayer(id)) map.setFilter(id, insetSelected ? HIDE_FILTER : baseFilter);
    }
  }

  // ── Focus mode (focusSelected): highlight the selection, dim the rest ──────
  // State polygons carry full names, so map the selected abbrs → names for the
  // fill/border filter. A never-match filter hides the highlight layers when
  // nothing is focused (homepage, or an empty selection). Recomputes reactively
  // so SPA navigation between state pages re-targets the highlight.
  const STATE_NAME_NONE: any = ["==", ["get", "name"], "\x00__none__"];
  $: highlightFilter = focusSelected && selectedStates.size > 0
    ? ["all", insetFilter, ["in", ["get", "name"], ["literal", [...selectedStates].map((a) => STATE_NAMES[a] ?? a)]]]
    : ["all", insetFilter, STATE_NAME_NONE];
  $: if (map && map.getLayer && map.getLayer("state-highlight-fill")) {
    map.setFilter("state-highlight-fill", highlightFilter);
    map.setFilter("state-highlight-line", highlightFilter);
  }

  // Per-dot opacity multiplier: 1 for in-selection dots, dimmed otherwise. Fed
  // into the agency layer's circle-opacity (multiplied with BASE_OPACITY / the
  // timeline fade). Plain 1 when not focusing, so the homepage is unaffected.
  const OUTSIDE_DIM = 0.16;
  $: dimExpr = focusSelected && selectedStates.size > 0
    ? ["case", ["in", ["get", "state"], ["literal", [...selectedStates]]], 1, OUTSIDE_DIM]
    : 1;

  // Fractional month index from Jan 2025 (idx 0). The animation begins Dec 18
  // 2024 (TIMELINE_START_IDX) — the most recent pre-2025 archived snapshot (#169)
  // — so any signing on or before then (and any missing date) gets a deeply
  // negative value, always past the fade-in window — i.e. shown unconditionally
  // as the baseline. Must match TIMELINE_START_IDX in routes/+page.svelte.
  const BASELINE_IDX = -10000;
  const TIMELINE_EPOCH_YEAR = 2025;
  const TIMELINE_START_IDX = -1 + 17 / 31; // Dec 18 2024, relative to the Jan 2025 epoch
  const signedDateIdx = (d?: string | null): number => {
    if (!d || d.length < 10) return BASELINE_IDX;
    const y = Number(d.slice(0, 4));
    const m = Number(d.slice(5, 7));
    const day = Number(d.slice(8, 10));
    const idx = (y - TIMELINE_EPOCH_YEAR) * 12 + (m - 1) + (day - 1) / 31;
    return idx < TIMELINE_START_IDX ? BASELINE_IDX : idx;
  };

  // Termination index in the same fractional-month space. Active agencies (no
  // terminated_date) get a sentinel far past the timeline so the cursor never
  // reaches it — their dots never fade out.
  const TERMINATION_NONE = 1_000_000;
  const terminatedDateIdx = (d?: string | null): number => {
    if (!d || d.length < 10) return TERMINATION_NONE;
    const y = Number(d.slice(0, 4));
    const m = Number(d.slice(5, 7));
    const day = Number(d.slice(8, 10));
    return (y - TIMELINE_EPOCH_YEAR) * 12 + (m - 1) + (day - 1) / 31;
  };

  // ── new/old helpers (colorMode === "newOld") ────────────────────────────────
  // ISO date strings compare lexically, so a plain >= against the threshold is a
  // correct "signed on or after" test. `seq` maps each new signing to [0,1] by
  // day within the reveal window (threshold → newest new signing), so the sweep
  // reveals dots roughly in signing order.
  const isNewSigned = (d?: string | null): boolean =>
    !!d && d.length >= 10 && d >= newOldThreshold;
  const dayNum = (d: string): number => Date.parse(d + "T00:00:00Z") / 86_400_000;
  $: newMaxDate = (() => {
    if (colorMode !== "newOld") return newOldThreshold;
    let max = newOldThreshold;
    for (const a of [...agencies, ...terminatedAgencies])
      if (isNewSigned(a.signed_date) && a.signed_date! > max) max = a.signed_date!;
    return max;
  })();
  $: newSpanDays = Math.max(1, dayNum(newMaxDate) - dayNum(newOldThreshold));
  const seqOf = (d?: string | null): number => {
    if (!isNewSigned(d)) return 0;
    return Math.min(1, Math.max(0, (dayNum(d!) - dayNum(newOldThreshold)) / newSpanDays));
  };

  $: geojson = {
    type: "FeatureCollection",
    features: [...agencies, ...terminatedAgencies]
      .filter((a) => a.lat != null && a.lng != null && !(lower48 && INSET_TRANSFORMS[a.state]))
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
            color:
              colorMode === "newOld"
                ? isNewSigned(a.signed_date)
                  ? newColor
                  : oldColor
                : MODEL_COLORS[a.primary_model ?? ""] ?? MODEL_FALLBACK,
            signed_idx: signedDateIdx(a.signed_date),
            terminated_idx: terminatedDateIdx(a.terminated_date),
            // Extra props only in newOld mode, so "model" mode's feature shape is
            // unchanged (the reveal expressions + sort key key off these).
            ...(colorMode === "newOld"
              ? { is_new: isNewSigned(a.signed_date), seq: seqOf(a.signed_date) }
              : {}),
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

  // ── Dot clustering (dense metros overlap at the national resting view) ──────
  // Deliberately NOT MapLibre's native `cluster: true` on the live "agencies"
  // source: that aggregates over the *entire* source dataset regardless of any
  // layer filter, which can't stay in sync with the timeline scrubber's live
  // per-dot fade/reveal (a dot isn't filtered out of the source, its opacity/
  // radius are animated toward 0 — clustering would count it as "there" the
  // whole time). So the existing "agencies" circle layer is untouched — it
  // keeps doing 100% of the scrub/fade/reveal work exactly as before, including
  // for the baked social videos. Clustering is a second, separate source/layer
  // pair that only takes over the *display* when nothing is actively animating:
  // zoomed out to the national view, colorMode is the default "model" (never
  // for the /video/surge bake), and the cursor has been sitting still for a
  // moment (not mid-drag or mid-playback). The moment either condition stops
  // holding, the real per-dot layer reappears — cluster membership never needs
  // to itself be reveal-aware, since it only ever renders once the reveal
  // animation has already settled.
  const CLUSTER_MAX_ZOOM = 4.5;
  let currentZoom = 0;
  let cursorIdle = true;
  let idleTimer: ReturnType<typeof setTimeout>;
  $: {
    cursorIdx;
    cursorIdle = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { cursorIdle = true; }, 500);
  }

  // Which dots are actually "on" right now, in the same signed/terminated-idx
  // space the fade expressions use — safe to treat as a hard boolean cutoff
  // here (rather than replicating the fade curve) because clustering only
  // ever displays once the fade has finished settling (see cursorIdle above).
  $: clusterFeatures =
    colorMode !== "model"
      ? []
      : geojson.features.filter((f: any) => {
          if (cursorIdx == null) return true;
          const p = f.properties;
          return p.signed_idx <= cursorIdx && cursorIdx < p.terminated_idx;
        });

  $: shouldCluster = colorMode === "model" && cursorIdle && currentZoom < CLUSTER_MAX_ZOOM;

  $: if (mapLoaded && map.getSource("agency-clusters")) {
    map.getSource("agency-clusters").setData({ type: "FeatureCollection", features: clusterFeatures });
  }

  $: if (mapLoaded && map.getLayer("cluster-circles")) {
    const vis = shouldCluster ? "visible" : "none";
    map.setLayoutProperty("cluster-circles", "visibility", vis);
    map.setLayoutProperty("cluster-count", "visibility", vis);
    map.setLayoutProperty("agencies", "visibility", shouldCluster ? "none" : "visible");
  }

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
  // Fade-OUT for terminated dots: full opacity until the cursor reaches the
  // termination date, then ramps to 0 over FADE_WINDOW. Active dots carry a
  // sentinel terminated_idx far in the future, so this clamps to 1 for them.
  const fadeOutMultiplier = (cursor: number) => [
    "interpolate", ["linear"],
    ["-", cursor, ["get", "terminated_idx"]],
    0, 1,
    FADE_WINDOW, 0,
  ];
  const opacityWithFade = (cursor: number) => [
    "*", BASE_OPACITY, fadeMultiplier(cursor), fadeOutMultiplier(cursor),
  ];

  // Dot radius scales by sqrt of the officer count so big departments read
  // visibly heavier than rural sheriff's offices, without erasing the small
  // ones. Mobile gets a tighter scale — reactive to isMobile (not a one-time
  // check) so rotating a device or crossing the breakpoint after mount
  // rescales the dots instead of leaving them frozen at the mount-time size.
  // Domain ceiling = ~1,000 officers (between p99 and the dozen-or-so 1k+
  // outliers like Las Vegas Metro) → sqrt ≈ 31.6.
  $: SCALE = (isMobile ? 0.7 : 1) * dotScale;
  const sizeExpr: any = ["sqrt", ["coalesce", ["get", "officer_ct"], 0]];
  const sizeDomainMax = 32;
  // dotBump is added at BOTH endpoints, so the linear interpolation lifts
  // every dot by the same flat pixel amount regardless of officer count.
  $: radiusFn = (low: number, high: number) => [
    "interpolate", ["linear"], sizeExpr,
    0, low * SCALE + dotBump,
    sizeDomainMax, high * SCALE + dotBump,
  ];
  // MapLibre rule: ["zoom"] can only appear as the direct input of a top-level
  // interpolate/step, never nested. So instead of wrapping the existing radius
  // expression in ["*", fade, ...], we keep `interpolate(linear, [zoom], ...)`
  // at the top and multiply fade INTO each per-zoom stop's output.
  $: radiusStops = [
    [3, radiusFn(0.8, 9)],
    [6, radiusFn(2.4, 16)],
    [10, radiusFn(5, 30)],
    [13, radiusFn(8, 40)],
  ] as Array<[number, any]>;
  const baseRadiusExpression = (): any => {
    if (!radiusStops.length) return 1;
    return ["interpolate", ["linear"], ["zoom"], ...radiusStops.flat()];
  };
  const radiusWithFade = (cursor: number): any => {
    if (!radiusStops.length) return 1;
    const fm = fadeMultiplier(cursor);
    const fo = fadeOutMultiplier(cursor);
    const flat: any[] = [];
    for (const [z, r] of radiusStops) flat.push(z, ["*", fm, fo, r]);
    return ["interpolate", ["linear"], ["zoom"], ...flat];
  };

  // ── newOld reveal (colorMode === "newOld") ──────────────────────────────────
  // A soft leading edge sweeps across the new dots in signing order. For a new
  // dot with normalized order `seq`, its local reveal = clamp((p1 - seq)/BAND),
  // where p1 = revealProgress*(1+BAND) so p=1 lands every new dot fully in. Old
  // dots (is_new false) skip the sweep and stay at their (low) baseline opacity.
  const REVEAL_BAND = 0.32;
  const NEW_MIN_SCALE = 0.35; // new dots grow in from this fraction of full radius
  // Contrast split for this graphic: the pre-April baseline recedes (low
  // opacity), the new dots pop (near-full opacity + a warm light rim). These
  // only apply in newOld mode — the site's model map is untouched.
  const NEWOLD_OLD_OPACITY = 0.6; // baseline dots — context, not subject (bumped up for presence)
  const NEWOLD_NEW_OPACITY = 1.0; // new dots at full reveal — the subject
  const NEWOLD_NEW_STROKE = "rgba(255,214,170,0.6)"; // warm light rim on new dots
  const NEWOLD_OLD_STROKE = "rgba(12,17,23,0.55)"; // near-bg rim knocks out overlaps
  // Darker base map for THIS graphic only so the orange reads clearly against
  // the country shape — but lifted from the first pass, which read too faint on
  // a phone: brighter, slightly heavier state lines and a small bump to the land
  // fill. newOld mode is surge-graphic-only, so gating never touches the live map.
  const NEWOLD_STATE_FILL = "#1e2a39";
  const NEWOLD_STATE_LINE = "#4f6a89";
  const NEWOLD_LINE_WIDTH = 0.9;
  // The ocean/background layer isn't gated by colorMode the way state fill/line
  // are (it's set once at map construction, before the reactive newOld* vars
  // exist) — without its own override it would silently inherit C.bg's new
  // light tone even in newOld mode, putting a light ocean behind this dark
  // navy state fill. Keep the surge graphic's original near-black ocean.
  const NEWOLD_BG = "#0c1117";
  const backgroundColor = colorMode === "newOld" ? NEWOLD_BG : C.bg;
  $: newOldStateFill = colorMode === "newOld" ? NEWOLD_STATE_FILL : C.state;
  $: newOldStateLine = colorMode === "newOld" ? NEWOLD_STATE_LINE : C.line;
  const localRevealExpr = (progress: number): any => {
    const p1 = progress * (1 + REVEAL_BAND);
    return ["max", 0, ["min", 1, ["/", ["-", p1, ["get", "seq"]], REVEAL_BAND]]];
  };
  const newOldOpacityExpr = (progress: number): any => [
    "case",
    ["get", "is_new"],
    ["*", NEWOLD_NEW_OPACITY, localRevealExpr(progress)],
    NEWOLD_OLD_OPACITY,
  ];
  // Stroke fades in with the fill for new dots (so a not-yet-revealed dot
  // doesn't show a bare rim); old dots keep a constant near-bg rim.
  const newOldStrokeOpacityExpr = (progress: number): any => [
    "case",
    ["get", "is_new"],
    localRevealExpr(progress),
    1,
  ];
  const newOldRadiusExpr = (progress: number): any => {
    if (!radiusStops.length) return 1;
    const scale: any = [
      "case",
      ["get", "is_new"],
      ["+", NEW_MIN_SCALE, ["*", 1 - NEW_MIN_SCALE, localRevealExpr(progress)]],
      1,
    ];
    const flat: any[] = [];
    for (const [z, r] of radiusStops) flat.push(z, ["*", scale, r]);
    return ["interpolate", ["linear"], ["zoom"], ...flat];
  };

  // `radiusStops` is read here (even though it's only used indirectly, via
  // the functions below that close over it) purely so Svelte's dependency
  // tracker re-runs this block when it changes — e.g. isMobile flipping
  // after a device rotation — and pushes the new radius into the live map.
  $: if (map && map.getLayer && map.getLayer("agencies") && radiusStops) {
    if (colorMode === "newOld") {
      map.setPaintProperty("agencies", "circle-opacity", ["*", newOldOpacityExpr(revealProgress), dimExpr]);
      map.setPaintProperty("agencies", "circle-stroke-opacity", newOldStrokeOpacityExpr(revealProgress));
      map.setPaintProperty("agencies", "circle-radius", newOldRadiusExpr(revealProgress));
    } else if (cursorIdx == null) {
      map.setPaintProperty("agencies", "circle-opacity", ["*", BASE_OPACITY, dimExpr]);
      map.setPaintProperty("agencies", "circle-radius", baseRadiusExpression());
    } else {
      map.setPaintProperty("agencies", "circle-opacity", ["*", opacityWithFade(cursorIdx), dimExpr]);
      map.setPaintProperty("agencies", "circle-radius", radiusWithFade(cursorIdx));
    }
  }

  onMount(async () => {
    if (!browser) return;

    const ml = await import("maplibre-gl");
    await ensurePmtilesProtocol(ml);

    const FIT_BOUNDS = activeBounds;
    const FIT_OPTIONS = { padding: activePadding, animate: false };

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
          { id: "background", type: "background", paint: { "background-color": backgroundColor } },
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
      // Loaded after the initial fitToSelection() call (selectedStates may
      // already be set on mount, e.g. a state page) — re-fit now that polygon
      // bounds are available so it doesn't fall back to agency points.
      statesGeoJson = statesGj;
      fitToSelection();

      map.addLayer({
        id: "state-fills",
        type: "fill",
        source: "states",
        filter: insetFilter,
        paint: { "fill-color": newOldStateFill, "fill-opacity": 1 },
      });

      // Focus highlight: brighter fill for the selected state(s), drawn over the
      // base fills. Filter starts as highlightFilter (never-match outside focus
      // mode) and is kept in sync by the reactive block above.
      map.addLayer({
        id: "state-highlight-fill",
        type: "fill",
        source: "states",
        filter: highlightFilter,
        paint: { "fill-color": C.stateHighlight, "fill-opacity": 1 },
      });

      map.addLayer({
        id: "state-lines",
        type: "line",
        source: "states",
        filter: insetFilter,
        paint: {
          "line-color": newOldStateLine,
          "line-width": colorMode === "newOld" ? NEWOLD_LINE_WIDTH : C.lineWidth,
          // Fainter at the locked-floor national view (zoom ~1) so the country
          // doesn't read as a cage of borders. Ramps to full visibility once
          // individual states fill the screen. The surge graphic (newOld) holds
          // the lines more present — they read too faint on a phone otherwise.
          "line-opacity":
            colorMode === "newOld"
              ? ["interpolate", ["linear"], ["zoom"], 1, 0.8, 3, 1]
              : ["interpolate", ["linear"], ["zoom"], 1, 0.45, 3, 0.9],
        },
      });

      // Accent border around the focused state(s), above the base state lines.
      map.addLayer({
        id: "state-highlight-line",
        type: "line",
        source: "states",
        filter: highlightFilter,
        paint: {
          "line-color": C.highlightLine,
          "line-width": C.highlightLineWidth,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 3, 1],
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
        filter: insetFilter,
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
      // and fades out by ~zoom 4.5 as PMTiles takes over. Skipped in lower-48
      // mode: it carries no inset flag to filter on, and its AK/HI lines would
      // otherwise float over open ocean once the inset shapes are hidden;
      // PMTiles interstates cover the continental US at the video's zoom.
      if (!lower48) {
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
      }

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
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.8, 5, 2.6, 9, 4.6, 12, 6.4, 15, 8],
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
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.8, 5, 1.3, 9, 2.5, 12, 3.8, 15, 4.8],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 3.5, 0, 4.5, 0.95],
        },
      });

      // US/state highways — shown from the national view (fading in with the
      // interstates at 3.5→4.5), because agencies string along these corridors,
      // so seeing the network explains the dot clustering. Faint hint when
      // zoomed out, fuller as you zoom in.
      map.addLayer({
        id: "road-major-casing",
        type: "line",
        source: "base",
        "source-layer": "roads",
        minzoom: 3,
        filter: ["==", ["get", "kind"], "major_road"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": C.roadMajorCasing,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 5, 1.0, 9, 2.5, 12, 4.2, 15, 5.4],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 3.5, 0, 4.5, 0.6, 8, 0.8],
        },
      });

      map.addLayer({
        id: "road-major-fill",
        type: "line",
        source: "base",
        "source-layer": "roads",
        minzoom: 3,
        filter: ["==", ["get", "kind"], "major_road"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": C.roadMajorFill,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.35, 5, 0.5, 9, 1.5, 12, 2.7, 15, 3.5],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 3.5, 0, 4.5, 0.7, 8, 0.95],
        },
      });

      // Medium roads fade in approaching city zoom for context
      map.addLayer({
        id: "road-medium",
        type: "line",
        source: "base",
        "source-layer": "roads",
        minzoom: 7,
        filter: ["==", ["get", "kind"], "medium_road"],
        paint: {
          "line-color": C.roadMedium,
          "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.3, 12, 1.6, 15, 2.6],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0, 8, 0.85],
        },
      });

      // Minor roads / local streets — only once zoomed into a city, so the
      // urban grid fills in under the dots instead of an empty slate. Kept
      // faint so it reads as texture, not a full street map.
      map.addLayer({
        id: "road-minor",
        type: "line",
        source: "base",
        "source-layer": "roads",
        minzoom: 11,
        filter: ["==", ["get", "kind"], "minor_road"],
        paint: {
          "line-color": C.roadMedium,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.25, 14, 1, 16, 1.8],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0, 12.5, 0.6],
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
        filter: PLACE_FILTERS["places-major"],
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
        filter: PLACE_FILTERS["places-minor"],
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
        filter: PLACE_FILTERS["places-all"],
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

      // Agency dot radius: radiusStops (reactive, computed at the top of this
      // script from SCALE/dotScale/dotBump) is guaranteed set by the time this
      // async "load" callback runs, since it's set up before component mount.
      const initialRadius =
        colorMode === "newOld"
          ? newOldRadiusExpr(revealProgress)
          : cursorIdx == null
            ? baseRadiusExpression()
            : radiusWithFade(cursorIdx);
      const initialOpacity =
        colorMode === "newOld"
          ? ["*", newOldOpacityExpr(revealProgress), dimExpr]
          : cursorIdx == null
            ? ["*", BASE_OPACITY, dimExpr]
            : ["*", opacityWithFade(cursorIdx), dimExpr];
      // newOld mode: new dots pop with a warm light rim; old dots get a near-bg
      // rim so the baseline recedes. Model mode keeps the uniform bg-color rim.
      const strokeWidth =
        colorMode === "newOld"
          ? (["case", ["get", "is_new"], 0.9, 0.2] as any)
          : C.dotStrokeWidth;
      const strokeColor =
        colorMode === "newOld"
          ? (["case", ["get", "is_new"], NEWOLD_NEW_STROKE, NEWOLD_OLD_STROKE] as any)
          : C.dotStroke;
      const strokeOpacity =
        colorMode === "newOld" ? newOldStrokeOpacityExpr(revealProgress) : 1;
      map.addLayer({
        id: "agencies",
        type: "circle",
        source: "agencies",
        // newOld mode draws new (orange) dots above old (slate) ones so the
        // growth reads on top in dense clusters. Omitted in model mode → the
        // layer definition is unchanged there.
        ...(colorMode === "newOld"
          ? { layout: { "circle-sort-key": ["case", ["get", "is_new"], 1, 0] as any } }
          : {}),
        paint: {
          "circle-color": ["get", "color"],
          // Slight stroke = bg color: knocks out a thin gap between
          // touching dots without reading as a halo. The reduced fill
          // opacity lets dense clusters (FL, TX) read as "many overlapping"
          // rather than a solid blob.
          "circle-stroke-width": strokeWidth,
          "circle-stroke-color": strokeColor,
          "circle-stroke-opacity": strokeOpacity,
          "circle-radius": initialRadius,
          "circle-opacity": initialOpacity,
        },
      });

      // Cluster overlay — see the "Dot clustering" block above for why this is
      // a wholly separate source/layer pair rather than `cluster: true` on the
      // live "agencies" source. Starts empty; populated + shown by the
      // reactive blocks above once shouldCluster is true. Colored neutral
      // (not model-colored — a cluster mixes models) so it reads clearly as
      // "zoom in to see what's here," not as a fourth model color.
      if (colorMode === "model") {
        map.addSource("agency-clusters", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          cluster: true,
          clusterRadius: 44,
          clusterMaxZoom: 6,
          clusterProperties: {
            officer_sum: ["+", ["coalesce", ["get", "officer_ct"], 0]],
          },
        });

        map.addLayer({
          id: "cluster-circles",
          type: "circle",
          source: "agency-clusters",
          filter: ["has", "point_count"],
          layout: { visibility: "none" },
          paint: {
            "circle-color": C.text,
            "circle-opacity": 0.88,
            "circle-stroke-width": 2,
            "circle-stroke-color": C.roadCasing,
            "circle-radius": ["step", ["get", "point_count"], 13, 10, 18, 50, 24, 200, 30],
          },
        });

        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "agency-clusters",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 12,
            visibility: "none",
          },
          paint: { "text-color": C.roadCasing },
        });

        map.on("mouseenter", "cluster-circles", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "cluster-circles", () => { map.getCanvas().style.cursor = ""; });
        map.on("click", "cluster-circles", async (e: any) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const clusterId = feature.properties.cluster_id;
          const src = map.getSource("agency-clusters");
          const expansionZoom = await src.getClusterExpansionZoom(clusterId);
          map.easeTo({ center: feature.geometry.coordinates, zoom: expansionZoom });
        });

        map.on("zoom", () => { currentZoom = map.getZoom(); });
        currentZoom = map.getZoom();
      }

      // Popup + tap/hover navigation — shared with AgencyMap.svelte via
      // $lib/map/touchPopup (see that module for the touch-interaction
      // rationale: single-tap-to-navigate + long-press-for-info, replacing
      // the old two-tap dance).
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

      setupMapNavigation({
        map,
        ml,
        layerId: "agencies",
        hasHoverPointer: window.matchMedia("(hover: hover)").matches,
        isFeatureVisible,
        buildPopupHtml,
        getSlug: (p: any) => p.slug,
        navigate: (slug: string) => goto(`/agency/${slug}`),
      });

      // Every source/layer (including the cluster overlay) is set up by this
      // point — see the note on the `mapLoaded` declaration above for why the
      // clustering reactive blocks need this as an explicit dependency.
      mapLoaded = true;

      // Snapshot signal for the OG bake (scripts/bake-og.mjs). Set after
      // the first idle fires past initial render so a Playwright snapshot
      // waits for tiles + dots to settle before capturing.
      map.once("idle", () => {
        (window as any).__mapReady = true;
        onReady?.();
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

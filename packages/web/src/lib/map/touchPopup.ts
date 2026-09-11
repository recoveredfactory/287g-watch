// Shared tap/hover interaction for the site's MapLibre point layers
// (NationalMap.svelte now; AgencyMap.svelte is due the same treatment in a
// later phase — see the UI/UX revamp plan). Hover-capable pointers keep the
// existing mouseenter-popup / click-navigate behavior. Touch previously used
// an awkward two-tap dance (first tap opens a popup, second tap on the same
// dot navigates) — this replaces that with single-tap-to-navigate, matching
// how native map apps behave, plus an optional long-press for users who want
// to confirm the agency before committing to navigation.
export interface TouchPopupOptions<TProps> {
  map: any; // maplibregl.Map
  ml: any; // the maplibre-gl module (for its Popup class)
  layerId: string;
  hasHoverPointer: boolean;
  isFeatureVisible: (props: TProps) => boolean;
  buildPopupHtml: (props: TProps) => string;
  getSlug: (props: TProps) => string | undefined;
  navigate: (slug: string) => void;
  /** Hold duration (ms) before a touch-and-hold is treated as a long-press. */
  longPressMs?: number;
  /** Finger movement (px) past which a press is treated as a pan/scroll, not a long-press. */
  moveTolerancePx?: number;
}

export interface TouchPopupHandle {
  dismissPopup: () => void;
}

export function setupMapNavigation<TProps = any>(
  opts: TouchPopupOptions<TProps>,
): TouchPopupHandle {
  const {
    map, ml, layerId, hasHoverPointer, isFeatureVisible,
    buildPopupHtml, getSlug, navigate,
    longPressMs = 450, moveTolerancePx = 8,
  } = opts;

  const popup = new ml.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 10,
    className: "map-popup",
  });
  let popupOpen = false;

  const showPopup = (f: any) => {
    popup.setLngLat(f.geometry.coordinates.slice()).setHTML(buildPopupHtml(f.properties)).addTo(map);
    popupOpen = true;
  };
  const dismissPopup = () => {
    popup.remove();
    popupOpen = false;
  };

  if (hasHoverPointer) {
    map.on("mouseenter", layerId, (e: any) => {
      if (!e.features?.length) return;
      const f = e.features[0];
      if (!isFeatureVisible(f.properties)) return;
      map.getCanvas().style.cursor = "pointer";
      showPopup(f);
    });

    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
      dismissPopup();
    });

    map.on("click", layerId, (e: any) => {
      if (!e.features?.length) return;
      const f = e.features[0];
      if (!isFeatureVisible(f.properties)) return;
      const slug = getSlug(f.properties);
      if (slug) navigate(slug);
    });

    return { dismissPopup };
  }

  // ── Touch path ──────────────────────────────────────────────────────────
  // A long-press (held past longPressMs without moving past moveTolerancePx)
  // shows the info popup and suppresses that gesture's tap-navigate; a plain
  // tap navigates immediately via the "click" handler below (MapLibre
  // synthesizes a click from a touch tap that isn't consumed by a long-press).
  const canvas = map.getCanvas();
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;
  let longPressFired = false;

  const clearPressTimer = () => {
    if (pressTimer != null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  canvas.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    dismissPopup();
    longPressFired = false;
    startX = e.clientX;
    startY = e.clientY;
    clearPressTimer();
    pressTimer = setTimeout(() => {
      pressTimer = null;
      const rect = canvas.getBoundingClientRect();
      const feats = map.queryRenderedFeatures(
        [startX - rect.left, startY - rect.top] as any,
        { layers: [layerId] },
      );
      if (feats.length && isFeatureVisible(feats[0].properties)) {
        longPressFired = true;
        showPopup(feats[0]);
      }
    }, longPressMs);
  });

  canvas.addEventListener("pointermove", (e: PointerEvent) => {
    if (e.pointerType !== "touch" || pressTimer == null) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > moveTolerancePx) {
      clearPressTimer();
    }
  });

  const endPress = () => clearPressTimer();
  canvas.addEventListener("pointerup", endPress);
  canvas.addEventListener("pointercancel", endPress);

  map.on("click", layerId, (e: any) => {
    if (longPressFired) {
      // The long-press already showed the popup for this gesture — consume
      // it once so the *next* plain tap navigates normally.
      longPressFired = false;
      return;
    }
    if (!e.features?.length) return;
    const f = e.features[0];
    if (!isFeatureVisible(f.properties)) return;
    const slug = getSlug(f.properties);
    if (slug) navigate(slug);
  });

  // Tapping empty map area (outside any dot) dismisses an open long-press popup.
  map.on("click", (e: any) => {
    if (!popupOpen) return;
    const feats = map.queryRenderedFeatures(e.point, { layers: [layerId] });
    if (feats.length === 0) dismissPopup();
  });

  return { dismissPopup };
}

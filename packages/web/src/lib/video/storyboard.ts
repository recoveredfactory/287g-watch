// ── Map+trend social video storyboard (#167, title card #213) ───────────────
// The single source of timing for the /video/national composite. The route
// imports `frameState`/`sceneLabel` to render (and to preview), and the bake
// script (scripts/bake-map-trend-video.mjs) imports `TOTAL_SECONDS` to size its
// frame sweep — so the page (preview) and the encode can never disagree.
//
// Storyboard:
//   title hold — OPEN on the title card (big TODAY number over today's ghosted
//                dots) — we never flash the full present-day composite first, so
//                the first frame is a strong social poster. Under the card's
//                opaque cover, snap the cursor back to the Dec 2024 start so the
//                reveal lands on the starting frame.
//   title out  — dissolve the title card DOWN, revealing the composite at the start
//   start hold — settle on the Dec 2024 starting state before the sweep
//   run        — sweep start → today; map dots fade in, trend playhead tracks
//   outro hold — settle on today
//
// The clip OPENS on the title card (no composite at t=0) and ends holding on
// today's composite — the payoff. The cursor snap (today → start) hides under
// the card while it's fully opaque, so the animated counters never visibly jump.
// All beats are wall-clock seconds; `t` is seconds from the start of the clip.

export const BEATS = {
  titleHold: 1.8,
  titleOut: 0.8,
  startHold: 0.7,
  run: 9.5,
  outroHold: 2.0,
} as const;

export const TOTAL_SECONDS =
  BEATS.titleHold +
  BEATS.titleOut +
  BEATS.startHold +
  BEATS.run +
  BEATS.outroHold; // 14.8

// Beat boundaries (cumulative end times), so phase tests read top-to-bottom.
const T_TITLEHOLD_END = BEATS.titleHold; // 1.8
const T_TITLEOUT_END = T_TITLEHOLD_END + BEATS.titleOut; // 2.6
const T_STARTHOLD_END = T_TITLEOUT_END + BEATS.startHold; // 3.3
const T_RUN_END = T_STARTHOLD_END + BEATS.run; // 12.8
// outro ends at TOTAL_SECONDS (14.8)

export type FrameState = {
  // Fractional-month cursor for the map, the trend playhead, and the counters.
  cursorIdx: number;
  // Full-frame black veil (kept for safety; unused by the title-card intro).
  veilOpacity: number;
  // Title-card opacity (1 = card fully covers the composite, 0 = composite only).
  titleOpacity: number;
};

export type Scene = "title-hold" | "title-out" | "start-hold" | "run" | "outro";

const clamp01 = (p: number) => (p < 0 ? 0 : p > 1 ? 1 : p);

export function sceneAt(t: number): Scene {
  if (t < T_TITLEHOLD_END) return "title-hold";
  if (t < T_TITLEOUT_END) return "title-out";
  if (t < T_STARTHOLD_END) return "start-hold";
  if (t < T_RUN_END) return "run";
  return "outro";
}

export function sceneLabel(t: number): string {
  switch (sceneAt(t)) {
    case "title-hold":
      return "Title card";
    case "title-out":
      return "Title card out";
    case "start-hold":
      return "Hold on start (Dec 2024)";
    case "run":
      return "Run";
    case "outro":
      return "Outro hold (today)";
  }
}

// The full visual state at clip-time `t`. `minIdx`/`maxIdx` are the timeline
// bounds (Dec 2024 baseline → just past today), from buildTimelineModel.
export function frameState(t: number, minIdx: number, maxIdx: number): FrameState {
  const time = Math.max(0, Math.min(t, TOTAL_SECONDS));

  // Title hold — open directly on the card (no composite flash at t=0). Snap
  // cursor maxIdx → minIdx past the 60% mark, hidden under the opaque card, so
  // the composite is already at the start when the card lifts.
  if (time < T_TITLEHOLD_END) {
    const p = time / BEATS.titleHold;
    return { cursorIdx: p < 0.6 ? maxIdx : minIdx, veilOpacity: 0, titleOpacity: 1 };
  }

  // Title out — dissolve the card down, revealing the composite at the start.
  if (time < T_TITLEOUT_END) {
    const p = (time - T_TITLEHOLD_END) / BEATS.titleOut;
    return { cursorIdx: minIdx, veilOpacity: 0, titleOpacity: 1 - clamp01(p) };
  }

  // Start hold — settle on the Dec 2024 starting state before the sweep.
  if (time < T_STARTHOLD_END) {
    return { cursorIdx: minIdx, veilOpacity: 0, titleOpacity: 0 };
  }

  // Run — sweep start → today.
  if (time < T_RUN_END) {
    const p = (time - T_STARTHOLD_END) / BEATS.run;
    return { cursorIdx: minIdx + (maxIdx - minIdx) * p, veilOpacity: 0, titleOpacity: 0 };
  }

  // Outro hold — today. The run already ended here, so just hold (no fade).
  return { cursorIdx: maxIdx, veilOpacity: 0, titleOpacity: 0 };
}

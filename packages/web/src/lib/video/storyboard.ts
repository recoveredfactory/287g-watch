// ── Map+trend social video storyboard (#167, title card #213) ───────────────
// The single source of timing for the /video/national composite. The route
// imports `frameState`/`sceneLabel` to render (and to preview), and the bake
// script (scripts/bake-map-trend-video.mjs) imports `TOTAL_SECONDS` to size its
// frame sweep — so the page (preview) and the encode can never disagree.
//
// Storyboard:
//   intro      — composite at today (one frame of breathing room for a clean loop)
//   title in   — dissolve the title card UP over the composite (big TODAY number,
//                ghosted US map behind it)
//   title hold — hold the card; under its opaque cover, snap the cursor back to
//                the Dec 2024 start so the reveal lands on the starting frame
//   title out  — dissolve the title card DOWN, revealing the composite at the start
//   start hold — settle on the Dec 2024 starting state before the sweep
//   run        — sweep start → today; map dots fade in, trend playhead tracks
//   outro hold — settle on today
//
// The title card REPLACES the old fade-to-black: it dissolves over the composite
// instead of dipping through black, so it "fades into the video." Because both
// ends sit on the composite-at-today, outro → intro stays a seamless loop. The
// cursor snap (today → start) hides under the card while it's fully opaque, so
// the animated counters never visibly jump. All beats are wall-clock seconds;
// `t` is seconds from the start of the clip.

export const BEATS = {
  introHold: 0.4,
  titleIn: 0.7,
  titleHold: 1.5,
  titleOut: 0.8,
  startHold: 0.8,
  run: 9.5,
  outroHold: 2.0,
} as const;

export const TOTAL_SECONDS =
  BEATS.introHold +
  BEATS.titleIn +
  BEATS.titleHold +
  BEATS.titleOut +
  BEATS.startHold +
  BEATS.run +
  BEATS.outroHold; // 15.7

// Beat boundaries (cumulative end times), so phase tests read top-to-bottom.
const T_INTRO_END = BEATS.introHold; // 0.4
const T_TITLEIN_END = T_INTRO_END + BEATS.titleIn; // 1.1
const T_TITLEHOLD_END = T_TITLEIN_END + BEATS.titleHold; // 2.6
const T_TITLEOUT_END = T_TITLEHOLD_END + BEATS.titleOut; // 3.4
const T_STARTHOLD_END = T_TITLEOUT_END + BEATS.startHold; // 4.2
const T_RUN_END = T_STARTHOLD_END + BEATS.run; // 13.7
// outro ends at TOTAL_SECONDS (15.7)

export type FrameState = {
  // Fractional-month cursor for the map, the trend playhead, and the counters.
  cursorIdx: number;
  // Full-frame black veil (kept for safety; unused by the title-card intro).
  veilOpacity: number;
  // Title-card opacity (1 = card fully covers the composite, 0 = composite only).
  titleOpacity: number;
};

export type Scene =
  | "intro"
  | "title-in"
  | "title-hold"
  | "title-out"
  | "start-hold"
  | "run"
  | "outro";

const clamp01 = (p: number) => (p < 0 ? 0 : p > 1 ? 1 : p);

export function sceneAt(t: number): Scene {
  if (t < T_INTRO_END) return "intro";
  if (t < T_TITLEIN_END) return "title-in";
  if (t < T_TITLEHOLD_END) return "title-hold";
  if (t < T_TITLEOUT_END) return "title-out";
  if (t < T_STARTHOLD_END) return "start-hold";
  if (t < T_RUN_END) return "run";
  return "outro";
}

export function sceneLabel(t: number): string {
  switch (sceneAt(t)) {
    case "intro":
      return "Intro (today)";
    case "title-in":
      return "Title card in";
    case "title-hold":
      return "Title card hold";
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

  // Intro — composite at today (loop seam).
  if (time < T_INTRO_END) {
    return { cursorIdx: maxIdx, veilOpacity: 0, titleOpacity: 0 };
  }

  // Title in — dissolve the card up over the composite-at-today.
  if (time < T_TITLEIN_END) {
    const p = (time - T_INTRO_END) / BEATS.titleIn;
    return { cursorIdx: maxIdx, veilOpacity: 0, titleOpacity: clamp01(p) };
  }

  // Title hold — card fully opaque. Snap cursor maxIdx → minIdx past the 60%
  // mark, hidden under the card, so the composite is already at the start when
  // the card lifts.
  if (time < T_TITLEHOLD_END) {
    const p = (time - T_TITLEIN_END) / BEATS.titleHold;
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

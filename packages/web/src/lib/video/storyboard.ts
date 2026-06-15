// ── Map+trend social video storyboard (#167) ───────────────────────────────
// The single source of timing for the /video/national composite. The route
// imports `frameState`/`sceneLabel` to render (and to preview), and the bake
// script (scripts/bake-map-trend-video.mjs) imports `TOTAL_SECONDS` to size its
// frame sweep — so the page (preview) and the encode can never disagree.
//
// Storyboard:
//   intro hold — today, big counter
//   fade-in    — dip to black; under cover, snap the cursor back to the start
//   start hold — hold on the Dec 2024 starting state before the sweep
//   run        — sweep start → today; map dots fade in, trend playhead tracks
//   outro hold — settle on today, big counter
//
// The run ENDS on today, so there's no fade-out — the clip just holds on the
// latest date (a trailing fade dipped to black and back to the same frame,
// which read as an odd flash). On loop, outro(today) → intro(today) is seamless.
//
// One counter (always reads the count at the cursor); the single fade dips the
// whole frame to a *full-black plateau* and the cursor snap happens inside that
// plateau, so the number never visibly jumps. All beats are wall-clock seconds;
// `t` is seconds from the start of the clip.

export const BEATS = {
  introHold: 1.5,
  fadeIn: 0.7,
  startHold: 1.5,
  run: 8.0,
  outroHold: 2.0,
} as const;

// Fraction of a fade beat held at full black in the middle (the cursor snap
// hides here). 0.34 → ~0.24s of solid black on a 0.7s fade.
const VEIL_HOLD = 0.34;

export const TOTAL_SECONDS =
  BEATS.introHold + BEATS.fadeIn + BEATS.startHold + BEATS.run + BEATS.outroHold; // 13.7

// Beat boundaries (cumulative end times), so phase tests read top-to-bottom.
const T_INTRO_END = BEATS.introHold; // 1.5
const T_FADEIN_END = T_INTRO_END + BEATS.fadeIn; // 2.2
const T_STARTHOLD_END = T_FADEIN_END + BEATS.startHold; // 3.7
const T_RUN_END = T_STARTHOLD_END + BEATS.run; // 11.7
// outro ends at TOTAL_SECONDS (13.7)

export type FrameState = {
  // Fractional-month cursor for the map, the trend playhead, and the counter.
  cursorIdx: number;
  // Full-frame black veil for the fade transitions (0 = clear, 1 = black).
  veilOpacity: number;
};

export type Scene = "intro" | "fade-in" | "start-hold" | "run" | "outro";

const clamp01 = (p: number) => (p < 0 ? 0 : p > 1 ? 1 : p);

// Trapezoid: ramp 0→1, hold at 1 across the middle `hold` fraction, ramp 1→0.
// The flat top guarantees the cursor snap is hidden under solid black.
function veilTrapezoid(p: number, hold = VEIL_HOLD): number {
  const q = clamp01(p);
  const ramp = (1 - hold) / 2;
  if (q < ramp) return q / ramp;
  if (q > 1 - ramp) return (1 - q) / ramp;
  return 1;
}

export function sceneAt(t: number): Scene {
  if (t < T_INTRO_END) return "intro";
  if (t < T_FADEIN_END) return "fade-in";
  if (t < T_STARTHOLD_END) return "start-hold";
  if (t < T_RUN_END) return "run";
  return "outro";
}

export function sceneLabel(t: number): string {
  switch (sceneAt(t)) {
    case "intro":
      return "Intro hold (today)";
    case "fade-in":
      return "Fade to start";
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

  // Intro hold — today.
  if (time < T_INTRO_END) {
    return { cursorIdx: maxIdx, veilOpacity: 0 };
  }

  // Fade-in — dip to black; snap cursor maxIdx → minIdx at the veil's midpoint
  // (inside the full-black plateau, so the count doesn't visibly jump).
  if (time < T_FADEIN_END) {
    const p = (time - T_INTRO_END) / BEATS.fadeIn;
    return { cursorIdx: p < 0.5 ? maxIdx : minIdx, veilOpacity: veilTrapezoid(p) };
  }

  // Start hold — settle on the Dec 2024 starting state before the sweep.
  if (time < T_STARTHOLD_END) {
    return { cursorIdx: minIdx, veilOpacity: 0 };
  }

  // Run — sweep start → today.
  if (time < T_RUN_END) {
    const p = (time - T_STARTHOLD_END) / BEATS.run;
    return { cursorIdx: minIdx + (maxIdx - minIdx) * p, veilOpacity: 0 };
  }

  // Outro hold — today. The run already ended here, so just hold (no fade).
  return { cursorIdx: maxIdx, veilOpacity: 0 };
}

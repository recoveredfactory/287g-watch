// Authoritative source for the three model colors — also mirrored as
// --color-model-jail/taskforce/wso in packages/web/src/app.css's @theme block
// (Tailwind/CSS can't read this .ts file directly, and Satori bake scripts /
// MapLibre paint expressions consume these hex values directly). Keep the two
// in sync by hand if these ever change.
// Lightened ~15% toward white from the original #BE6079/#3C97E2/#5E9148 (a
// deliberate, requested lightening). Jail and wso then got a small further
// hue nudge (jail 344°→335°, wso 102°→108°, lightness/saturation unchanged)
// after simulating deuteranopia/protanopia on the lightened colors: rose vs.
// green was the one genuinely weak pair (dropped to ~38/56 of its normal-
// vision separation under those conditions, vs. ~92-130 for every other
// pair). The nudge isn't a full fix — that would need shifting the hues far
// enough to look like different colors, or a non-color channel on the map —
// but it recovers real separation (~51/65) while staying recognizably "the
// same" rose and green. Task Force (blue) was already well-separated from
// both, untouched. Original: jail #BE6079, taskforce #3C97E2, wso #5E9148.
export const MODEL_COLORS: Record<string, string> = {
  "Jail Enforcement Model": "#C87899",
  "Task Force Model": "#59A7E6",
  "Warrant Service Officer": "#70A263",
};

// White text on these three backgrounds used to fail WCAG AA for small badge
// text. Near-black text clears AA against the current MODEL_COLORS with room
// to spare: 6.04:1 (jail), 7.41:1 (taskforce), 6.44:1 (wso).
export const MODEL_TEXT_COLORS: Record<string, string> = {
  "Jail Enforcement Model": "#120e09",
  "Task Force Model": "#120e09",
  "Warrant Service Officer": "#120e09",
};

// Dark tints of each model color — for text on light/tinted backgrounds
export const MODEL_DARK_COLORS: Record<string, string> = {
  "Jail Enforcement Model": "#6B1F33",
  "Task Force Model": "#1A4A7A",
  "Warrant Service Officer": "#2F4A22",
};

export const MODEL_ORDER: string[] = [
  "Warrant Service Officer",
  "Jail Enforcement Model",
  "Task Force Model",
];

export const MODEL_SLUG: Record<string, string> = {
  "Jail Enforcement Model": "jail",
  "Task Force Model": "taskforce",
  "Warrant Service Officer": "wso",
};

export const MODEL_SHORT: Record<string, string> = {
  "Jail Enforcement Model": "Jail Enforcement",
  "Task Force Model": "Task Force",
  "Warrant Service Officer": "Warrant Service",
};

export const MODEL_MINI: Record<string, string> = {
  "Jail Enforcement Model": "JEM",
  "Task Force Model": "TFM",
  "Warrant Service Officer": "WSO",
};

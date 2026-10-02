// Stacked-bar segment colors for the ICE detainer/arrest sections (agency
// and state pages). Reuses MODEL_COLORS' three hues rather than inventing a
// new palette, plus a muted grey for the "we don't really know" buckets
// (pending/other) so the eye reads them as background noise, not signal.
export const DETAINER_OUTCOME_ORDER = ["booked", "released", "declined_by_agency", "pending", "other"] as const;
export const DETAINER_OUTCOME_COLORS: Record<(typeof DETAINER_OUTCOME_ORDER)[number], string> = {
  booked: "#59A7E6", // Task Force Model blue
  released: "#70A263", // Warrant Service Officer green
  declined_by_agency: "#C87899", // Jail Enforcement Model pink
  pending: "#B8B0A4", // muted neutral — outcome not yet known
  other: "#D8D2C8",
};

export const ARREST_CRIMINALITY_ORDER = ["convicted", "pending_charges", "other"] as const;
export const ARREST_CRIMINALITY_COLORS: Record<(typeof ARREST_CRIMINALITY_ORDER)[number], string> = {
  convicted: "#70A263", // Warrant Service Officer green
  pending_charges: "#59A7E6", // Task Force Model blue
  other: "#B8B0A4",
};

// Feature flags for surfaces that are built but intentionally held back.

// The per-state 287(g) legislative-stance badge is plumbed end-to-end (pipeline
// → server load → LegislationBadge), but the upstream PromptQL program's stance
// calls aren't trustworthy yet — e.g. it mislabeled Iowa's anti-sanctuary law
// (which compels cooperation) as `anti`, its own description contradicting the
// label. Hidden from the UI until the program is fixed; flip this to re-enable
// in both the state page and the /states index. The data still flows and gets
// written, so re-enabling needs no re-run.
export const SHOW_LEGISLATION_STANCE = false;

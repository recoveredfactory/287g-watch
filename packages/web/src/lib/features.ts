// Feature flags for surfaces that are built but intentionally held back.

// The per-state 287(g) legislative-stance badge is plumbed end-to-end (pipeline
// → server load → LegislationBadge), but the upstream PromptQL program's stance
// calls aren't trustworthy yet — e.g. it mislabeled Iowa's anti-sanctuary law
// (which compels cooperation) as `anti`, its own description contradicting the
// label. Hidden from the UI until the program is fixed; flip this to re-enable
// in both the state page and the /states index. The data still flows and gets
// written, so re-enabling needs no re-run.
export const SHOW_LEGISLATION_STANCE = false;

// "287(g) Encounter Reports" — narrative paragraphs extracted from ICE's own
// public Monthly/FY 287(g) Encounter Report PDFs, matched to the specific
// agency each story names. Pipeline: packages/pipeline/extract-success-
// stories.ts → match-success-stories.ts → build-success-stories.ts, writing
// packages/pipeline/data/success_stories.json.
//
// Held back for two separate reasons, both real:
//   1. Data-quality risk — the agency match comes from automated fuzzy
//      matching. Only exact/high-confidence matches (or a human-corrected
//      entry in success_stories_overrides.yaml) ever reach the published
//      file, but misattributing a real person's conviction/sentence to the
//      wrong law enforcement agency is a more serious error than a
//      mislabeled state law (see SHOW_LEGISLATION_STANCE above) — this
//      should stay off until someone has spot-checked a real sample of
//      matched stories against their source PDFs.
//   2. Editorial judgment, not just data quality — these are ICE's own
//      self-selected, self-narrated accounts of an arrest/conviction, from
//      the perspective of the agency that made the arrest, about people who
//      cannot respond and whose cases may not have reached final
//      adjudication. Whether to publish this content at all, and how strong
//      the reader-facing disclaimer needs to be, is a call David should
//      make explicitly — flag it to him as an editorial question, not just
//      "does the matching look right."
export const SHOW_SUCCESS_STORIES = false;

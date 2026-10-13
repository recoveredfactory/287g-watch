// Feature flags for surfaces that are built but intentionally held back.

// The per-state 287(g) legislative-stance badge is plumbed end-to-end (pipeline
// → server load → LegislationBadge). The classification source used to be an
// AI program's guess, which got at least one state backwards (Iowa's law
// compels ICE cooperation but was labeled `anti`) — see PR #275 review §4.4.
// It's now packages/pipeline/data/legislation_stance.yaml, a hand-researched,
// hand-maintained file with a real citation per state (build with
// `pnpm tsx build-legislation-stance.ts` in packages/pipeline).
// Still held back: the initial research pass (2026-09-22) flagged 11 states
// with open review_notes — genuine uncertainties (e.g. whether MA/MN/RI's
// case-law/AG-opinion basis should read as "anti" or "none") that need a
// second human pass before this ships. Flip once those are resolved.
export const SHOW_LEGISLATION_STANCE = false;

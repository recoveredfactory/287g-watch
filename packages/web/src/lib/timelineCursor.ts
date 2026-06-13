// ── Timeline cursor math (shared) ──────────────────────────────────────────
// The continuous fractional-month index (relative to a Jan 2025 epoch) that
// drives the map's fade-in/out and the headline counters, plus the ORI-deduped
// derivations behind the "agencies / population covered" numbers. Extracted
// from routes/+page.svelte so the homepage and the /video/national route
// compute identical numbers from one source — the video's headline can't drift
// from the site's. NationalMap.svelte keeps its own copy of TIMELINE_START_IDX
// (it must equal the value here; see the note there).
import type { HomeAgency } from "$lib/homeData.types";

export const TIMELINE_EPOCH_YEAR = 2025;
// Dec 18 2024, relative to the Jan 2025 epoch — the most recent pre-2025
// archived snapshot (#169), a clean pre-Trump baseline. Every signing on or
// before then is pinned as the baseline (always shown at frame 0).
export const TIMELINE_START_IDX = -1 + 17 / 31;
export const BASELINE_IDX = -10000;

export const signedIdx = (d: string | null | undefined): number => {
  if (!d || d.length < 10) return BASELINE_IDX;
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  const idx = (y - TIMELINE_EPOCH_YEAR) * 12 + (m - 1) + (day - 1) / 31;
  return idx < TIMELINE_START_IDX ? BASELINE_IDX : idx;
};

export type TimelineModel = {
  todayIdx: number;
  minIdx: number;
  maxIdx: number;
  // ORI-deduped active signing indices (state-level agencies still count).
  uniqueSignedIndices: number[];
  // ORI-deduped terminated agencies, with signing + termination indices, so
  // the headline shows *net active at the cursor*.
  uniqueTerminatedData: { signed: number; ended: number }[];
  // ORI-deduped local-only (County + Municipality) signing indices + pops, for
  // the population-covered sum (state-level rows would double-count). See #99.
  uniqueLocalSignedIndices: number[];
  uniqueLocalPops: number[];
  // State police / corrections etc. — not plotted, surfaced as a note instead.
  statewideCount: number;
};

// Build every cursor-independent derivation once from the page data. Counts at
// a given cursor are then cheap (see activeCountAt / coveredPopAt). `now` is
// injectable for testing/baking; defaults to the current date (UTC).
export function buildTimelineModel(
  agencies: HomeAgency[],
  terminatedAgencies: HomeAgency[] = [],
  now: Date = new Date(),
): TimelineModel {
  const todayIdx =
    (now.getUTCFullYear() - TIMELINE_EPOCH_YEAR) * 12 +
    now.getUTCMonth() +
    (now.getUTCDate() - 1) / 31;

  const allSignedIndices = agencies.map((a) => signedIdx(a.signed_date));
  const maxIdx =
    Math.max(todayIdx, ...allSignedIndices.filter((i) => i > BASELINE_IDX)) + 0.5;

  // Active, ORI-deduped (shared-ORI rows collapse to the earliest signing;
  // null-ORI rows pass through as singletons). See #92.
  const agencyByOri = new Map<string, { idx: number }>();
  const agencyNullOri: { idx: number }[] = [];
  for (const a of agencies) {
    const idx = signedIdx(a.signed_date);
    if (a.ori) {
      const prev = agencyByOri.get(a.ori);
      if (!prev) agencyByOri.set(a.ori, { idx });
      else if (idx < prev.idx) agencyByOri.set(a.ori, { idx });
    } else {
      agencyNullOri.push({ idx });
    }
  }
  const uniqueSignedIndices = [...agencyByOri.values(), ...agencyNullOri].map((d) => d.idx);

  // Terminated, ORI-deduped (first row wins). See #118.
  const termByOri = new Map<string, { signed: number; ended: number }>();
  const termNullOri: { signed: number; ended: number }[] = [];
  for (const a of terminatedAgencies) {
    const entry = { signed: signedIdx(a.signed_date), ended: signedIdx(a.terminated_date) };
    if (a.ori) {
      if (!termByOri.has(a.ori)) termByOri.set(a.ori, entry);
    } else {
      termNullOri.push(entry);
    }
  }
  const uniqueTerminatedData = [...termByOri.values(), ...termNullOri];

  // Local-only pops, ORI-deduped (earliest signing, first-seen pop). See #99.
  const localByOri = new Map<string, { idx: number; pop: number }>();
  const localNullOri: { idx: number; pop: number }[] = [];
  for (const a of agencies) {
    if (a.agency_type !== "County" && a.agency_type !== "Municipality") continue;
    const idx = signedIdx(a.signed_date);
    const pop = a.population ?? 0;
    if (a.ori) {
      const prev = localByOri.get(a.ori);
      if (!prev) localByOri.set(a.ori, { idx, pop });
      else if (idx < prev.idx) localByOri.set(a.ori, { idx, pop: prev.pop });
    } else {
      localNullOri.push({ idx, pop });
    }
  }
  const localData = [...localByOri.values(), ...localNullOri];
  const uniqueLocalSignedIndices = localData.map((d) => d.idx);
  const uniqueLocalPops = localData.map((d) => d.pop);

  const statewideCount = agencies.filter((a) => a.agency_type === "State Agency").length;

  return {
    todayIdx,
    minIdx: TIMELINE_START_IDX,
    maxIdx,
    uniqueSignedIndices,
    uniqueTerminatedData,
    uniqueLocalSignedIndices,
    uniqueLocalPops,
    statewideCount,
  };
}

// Net active agencies at the cursor: signed by now, minus those that have left.
export function activeCountAt(model: TimelineModel, cursor: number): number {
  return (
    model.uniqueSignedIndices.filter((i) => i <= cursor).length +
    model.uniqueTerminatedData.filter((d) => d.signed <= cursor && d.ended > cursor).length
  );
}

// Local population covered at the cursor.
export function coveredPopAt(model: TimelineModel, cursor: number): number {
  return model.uniqueLocalSignedIndices.reduce(
    (sum, idx, i) => (idx <= cursor ? sum + model.uniqueLocalPops[i] : sum),
    0,
  );
}

// Short month label for the cursor's date ticker. Clamped to today so the
// label doesn't read into the small headroom past maxIdx.
export function overlayMonthLabel(idx: number, todayIdx: number, localeTag: string): string {
  const clamped = Math.min(Math.max(TIMELINE_START_IDX, idx), todayIdx);
  const month = Math.floor(clamped);
  // Floored-division year + non-negative modulo month, so a pre-2025 (negative)
  // index maps back correctly (e.g. month -1 → Dec 2024, not Dec 2023).
  const y = TIMELINE_EPOCH_YEAR + Math.floor(month / 12);
  const mm = (((month % 12) + 12) % 12) + 1;
  return new Intl.DateTimeFormat(localeTag, { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, mm - 1, 1)));
}

// The cursor's date to day precision (signedIdx packs the day as (day-1)/31, so
// this inverts that). Clamped to [start, today]. Used by the video title
// eyebrow as an exact-date ticker.
export function cursorToDate(idx: number, todayIdx: number): Date {
  const clamped = Math.min(Math.max(TIMELINE_START_IDX, idx), todayIdx);
  const month = Math.floor(clamped);
  const dayFrac = clamped - month;
  const y = TIMELINE_EPOCH_YEAR + Math.floor(month / 12);
  const m0 = (((month % 12) + 12) % 12); // 0-based month
  const daysInMonth = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  const day = Math.min(daysInMonth, Math.max(1, Math.round(dayFrac * 31) + 1));
  return new Date(Date.UTC(y, m0, day));
}

export function overlayExactDate(idx: number, todayIdx: number, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(cursorToDate(idx, todayIdx));
}

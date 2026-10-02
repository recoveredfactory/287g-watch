import { buildTimeline } from "$lib/timeline";
import type { Agency } from "$lib/homeData.types";

export type StateChange = { abbr: string; net: number; stateAgencyNet: number };

export type TimelineMonth = {
  ym: string; // "YYYY-MM"
  total: number;
  delta: number; // net change vs. the previous month
  jail: number;
  taskforce: number;
  wso: number;
  // States that gained or lost agreements this month, largest |net| first —
  // "where they are happening", not just the national total.
  states: StateChange[];
};

export type TimelineData = {
  months: TimelineMonth[]; // newest first
  snapshotDate: string | null;
  // Headline growth stat: total right before the baseline vs. the latest
  // month's total.
  baselineTotal: number;
  currentTotal: number;
};

const STATE_BREAKDOWN_CAP = 4;

// Same event log buildTimeline() replays (per-agency history: date + which
// models were added/removed), but tracking each agency's *total-roster*
// membership (active in >=1 model, matching buildTimeline's own `total`
// definition) so a join/leave can be attributed to a state and a month —
// buildTimeline itself discards agency identity once it's folded into the
// national total, so this is a parallel pass, not a change to that shared
// primitive (also used by the homepage scrubber and the video bake).
function buildMonthlyStateChanges(agencies: Agency[]): Map<string, Map<string, StateChange>> {
  type Transition = { date: string; state: string; agencyType: string; delta: 1 | -1 };
  const transitions: Transition[] = [];

  for (const a of agencies) {
    if (!a.history?.length) continue;
    let active = false;
    const models = new Set<string>();
    for (const h of [...a.history].sort((x, y) => x.date.localeCompare(y.date))) {
      for (const m of h.added) models.add(m);
      for (const m of h.removed) models.delete(m);
      const isActive = models.size > 0;
      if (isActive !== active) {
        transitions.push({ date: h.date, state: a.state, agencyType: a.agency_type, delta: isActive ? 1 : -1 });
        active = isActive;
      }
    }
  }

  const result = new Map<string, Map<string, StateChange>>(); // ym -> abbr -> change
  for (const t of transitions) {
    const ym = t.date.slice(0, 7);
    const byState = result.get(ym) ?? new Map<string, StateChange>();
    const cur = byState.get(t.state) ?? { abbr: t.state, net: 0, stateAgencyNet: 0 };
    cur.net += t.delta;
    if (t.agencyType === "State Agency") cur.stateAgencyNet += t.delta;
    byState.set(t.state, cur);
    result.set(ym, byState);
  }
  return result;
}

export const load = async ({ fetch }): Promise<TimelineData> => {
  const [agenciesRes, terminatedRes, pendingRes] = await Promise.all([
    fetch("/data/dist/agency_index.json"),
    fetch("/data/dist/terminated_agencies.json"),
    fetch("/data/dist/pending_agencies.json"),
  ]);
  const agencies: Agency[] = agenciesRes.ok ? await agenciesRes.json() : [];
  const terminated: Agency[] = terminatedRes.ok ? await terminatedRes.json() : [];
  const pending: Agency[] = pendingRes.ok ? await pendingRes.json() : [];

  const snapshotDate =
    agencies
      .map((a) => a.snapshot_date)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null;

  const allForTrend = [...agencies, ...terminated, ...pending];

  // Every dated event (adds/removes), replayed into a running total — same
  // primitive the homepage's timeline scrubber and trend chart are built on.
  const points = buildTimeline(allForTrend);
  const stateChangesByYm = buildMonthlyStateChanges(allForTrend);

  // Same Dec-2024 baseline the homepage map/scrubber use (TIMELINE_START_IDX
  // in NationalMap.svelte/+page.svelte — "the last report before Trump took
  // office"). Earlier history is sparse/pre-tracking-era noise (it shows a
  // slowly *declining* count into 2021, an artifact of incomplete early
  // data, not a real trend) — fold it all into one flat starting point
  // instead of presenting it as meaningful month-over-month change.
  const BASELINE_YM = "2024-12";
  const baselineTotal =
    [...points].reverse().find((p) => p.date.slice(0, 7) <= BASELINE_YM)?.total ?? 0;

  // Collapse to one snapshot per month: the last event-date's totals within
  // that month (an "end of month" reading), so a month with several signing
  // events on different days still yields exactly one row.
  const byMonth = new Map<string, (typeof points)[number]>();
  for (const p of points) {
    const ym = p.date.slice(0, 7);
    byMonth.set(ym, p); // later dates in the sorted array overwrite earlier ones
  }

  const yms = [...byMonth.keys()].sort().filter((ym) => ym > BASELINE_YM);
  const baselinePoint = byMonth.get(BASELINE_YM);

  const topStates = (ym: string): StateChange[] =>
    [...(stateChangesByYm.get(ym) ?? new Map()).values()]
      .filter((s) => s.net !== 0)
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      .slice(0, STATE_BREAKDOWN_CAP);

  const monthsAscending: TimelineMonth[] = [
    {
      ym: BASELINE_YM,
      total: baselineTotal,
      delta: 0,
      jail: baselinePoint?.jail ?? 0,
      taskforce: baselinePoint?.taskforce ?? 0,
      wso: baselinePoint?.wso ?? 0,
      states: [],
    },
    ...yms.map((ym, i) => {
      const cur = byMonth.get(ym)!;
      const prevTotal = i > 0 ? byMonth.get(yms[i - 1])!.total : baselineTotal;
      return {
        ym,
        total: cur.total,
        delta: cur.total - prevTotal,
        jail: cur.jail,
        taskforce: cur.taskforce,
        wso: cur.wso,
        states: topStates(ym),
      };
    }),
  ];

  const currentTotal = monthsAscending.at(-1)?.total ?? baselineTotal;

  // Newest first — "Timeline needs to be reversed" per feedback.
  const months = [...monthsAscending].reverse();

  return { months, snapshotDate, baselineTotal, currentTotal };
};

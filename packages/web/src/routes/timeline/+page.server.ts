import { buildTimeline } from "$lib/timeline";
import type { Agency } from "$lib/homeData.types";

export type TimelineMonth = {
  ym: string; // "YYYY-MM"
  total: number;
  delta: number; // net change vs. the previous month
  jail: number;
  taskforce: number;
  wso: number;
};

export type TimelineData = {
  months: TimelineMonth[];
  // The N months with the largest absolute net change — called out as
  // "chapters" in the page, everything else lists more quietly.
  highlightYms: Set<string>;
  snapshotDate: string | null;
};

const HIGHLIGHT_COUNT = 5;

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

  // Every dated event (adds/removes), replayed into a running total — same
  // primitive the homepage's timeline scrubber and trend chart are built on.
  const points = buildTimeline([...agencies, ...terminated, ...pending]);

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
  const months: TimelineMonth[] = [
    {
      ym: BASELINE_YM,
      total: baselineTotal,
      delta: 0,
      jail: baselinePoint?.jail ?? 0,
      taskforce: baselinePoint?.taskforce ?? 0,
      wso: baselinePoint?.wso ?? 0,
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
      };
    }),
  ];

  const highlightYms = new Set(
    [...months]
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, HIGHLIGHT_COUNT)
      .map((m) => m.ym),
  );

  return { months, highlightYms, snapshotDate };
};

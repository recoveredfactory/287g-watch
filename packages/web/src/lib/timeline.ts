export type TimelinePoint = {
  date: string;
  total: number;
  jail: number;
  taskforce: number;
  wso: number;
};

interface AgencyWithHistory {
  slug: string;
  history?: { date: string; added: string[]; removed: string[] }[];
}

// Last pre-2025 archived snapshot (#169) — a clean pre-Trump baseline. The
// archive reaches back to 2021, but the chart opens here: every event on or
// before this date folds into the Dec 18 2024 starting point so the curve
// begins with the baseline count rather than the 2021 archive floor. Matches
// the map's TIMELINE_START (Dec 18 2024) in +page.svelte / NationalMap.svelte.
export const TIMELINE_START = "2024-12-18";

export function buildTimeline(
  agencies: AgencyWithHistory[],
  startDate: string = TIMELINE_START,
): TimelinePoint[] {
  const byDate = new Map<string, { slug: string; added: string[]; removed: string[] }[]>();

  for (const a of agencies) {
    for (const h of a.history ?? []) {
      let evts = byDate.get(h.date);
      if (!evts) { evts = []; byDate.set(h.date, evts); }
      evts.push({ slug: a.slug, added: h.added, removed: h.removed });
    }
  }

  const dates = [...byDate.keys()].sort();

  const active: Record<string, Set<string>> = {
    "Jail Enforcement Model": new Set(),
    "Task Force Model": new Set(),
    "Warrant Service Officer": new Set(),
  };

  const points: TimelinePoint[] = [];
  for (const date of dates) {
    for (const { slug, added, removed } of byDate.get(date) ?? []) {
      for (const m of added) active[m]?.add(slug);
      for (const m of removed) active[m]?.delete(slug);
    }
    // Accumulate pre-baseline events into the active sets, but don't plot them —
    // the first emitted point (startDate) carries the folded-in baseline count.
    if (date < startDate) continue;
    const all = new Set([
      ...active["Jail Enforcement Model"],
      ...active["Task Force Model"],
      ...active["Warrant Service Officer"],
    ]);
    points.push({
      date,
      total: all.size,
      jail: active["Jail Enforcement Model"].size,
      taskforce: active["Task Force Model"].size,
      wso: active["Warrant Service Officer"].size,
    });
  }

  return points.length < 2 ? [] : points;
}

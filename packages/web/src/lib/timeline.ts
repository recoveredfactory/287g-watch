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

export function buildTimeline(agencies: AgencyWithHistory[]): TimelinePoint[] {
  const byDate = new Map<string, { slug: string; added: string[]; removed: string[] }[]>();

  for (const a of agencies) {
    for (const h of a.history ?? []) {
      let evts = byDate.get(h.date);
      if (!evts) { evts = []; byDate.set(h.date, evts); }
      evts.push({ slug: a.slug, added: h.added, removed: h.removed });
    }
  }

  const dates = [...byDate.keys()].sort();
  if (dates.length < 2) return [];

  const active: Record<string, Set<string>> = {
    "Jail Enforcement Model": new Set(),
    "Task Force Model": new Set(),
    "Warrant Service Officer": new Set(),
  };

  return dates.map(date => {
    for (const { slug, added, removed } of byDate.get(date) ?? []) {
      for (const m of added) active[m]?.add(slug);
      for (const m of removed) active[m]?.delete(slug);
    }
    const all = new Set([
      ...active["Jail Enforcement Model"],
      ...active["Task Force Model"],
      ...active["Warrant Service Officer"],
    ]);
    return {
      date,
      total: all.size,
      jail: active["Jail Enforcement Model"].size,
      taskforce: active["Task Force Model"].size,
      wso: active["Warrant Service Officer"].size,
    };
  });
}

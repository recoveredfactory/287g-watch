import { buildHomeData } from "$lib/server/homeData";
import { buildTimelineModel, type TimelineModel } from "$lib/timelineCursor";
import type { HomeAgency, PageData } from "$lib/homeData.types";

export type TopState = { abbr: string; agencyCount: number; modelCounts: Record<string, number> };

// The homepage gets what it renders, not every agency (#308): the timeline
// model behind the map's count overlay, per-state counts and the leaderboard.
// The map loads its dots from /data/map-points.json and
// /data/terminated-points.json. /video/national shares buildHomeData and keeps
// the full lists.
export type HomePageData = Omit<PageData, "agencies" | "terminatedAgencies"> & {
  timeline: TimelineModel;
  stateCounts: Record<string, number>;
  topStates: TopState[];
};

// Top states by NEW agreements in the trailing 30 days — a rolling momentum
// leaderboard, not the all-time cumulative count (that full ranking lives on
// /states).
const topStatesBySigningsInLast30Days = (agencies: HomeAgency[]): TopState[] => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const agencyCountByState = new Map<string, number>();
  const modelCountsByState = new Map<string, Record<string, number>>();
  for (const a of agencies) {
    if (!a.signed_date || a.signed_date < cutoffStr) continue;
    agencyCountByState.set(a.state, (agencyCountByState.get(a.state) ?? 0) + 1);
    const mc = modelCountsByState.get(a.state) ?? {};
    for (const m of a.models) mc[m] = (mc[m] ?? 0) + 1;
    modelCountsByState.set(a.state, mc);
  }
  return [...agencyCountByState.entries()]
    .map(([abbr, agencyCount]) => ({ abbr, agencyCount, modelCounts: modelCountsByState.get(abbr) ?? {} }))
    .sort((a, b) => b.agencyCount - a.agencyCount)
    .slice(0, 5);
};

export const load = async (): Promise<HomePageData> => {
  const { agencies, terminatedAgencies, ...home } = await buildHomeData();
  const stateCounts: Record<string, number> = {};
  for (const a of agencies) if (a.state) stateCounts[a.state] = (stateCounts[a.state] ?? 0) + 1;
  return {
    ...home,
    timeline: buildTimelineModel(agencies, terminatedAgencies),
    stateCounts,
    topStates: topStatesBySigningsInLast30Days(agencies),
  };
};

// Re-export the shapes for back-compat: several other route modules still
// import these types from here rather than $lib/homeData.types directly.
// New code should import from $lib/homeData.types directly.
export type {
  HistoryEvent,
  LeeData,
  AgreementMetadata,
  Agreement,
  AgreementCoverage,
  AgencyNote,
  Agency,
  StateMeta,
  HomeAgency,
  TrendSeries,
  PageData,
} from "$lib/homeData.types";

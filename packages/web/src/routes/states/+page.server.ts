import { NAVIGABLE_STATES } from "$lib/states";
import type { Agency, StateMeta } from "$lib/homeData.types";
import { buildTimeline } from "$lib/timeline";
import { MODEL_SLUG } from "$lib/colors";

export type StateRow = {
  abbr: string;
  stateName: string;
  agencyCount: number;
  modelCounts: Record<string, number>;
  populationServed: number | null;
  localLeAgencies: number | null;
  localParticipating: number | null;
};

export type AgencyRow = {
  slug: string;
  name: string;
  state: string;
  primary_model: string;
  officerCt: number;
  population: number | null;
  agencyType: string;
};

// Model-split cumulative agency counts per state, sampled onto a shared
// month grid — a compact growth sparkline for the compare cards, comparable
// across states on one x-axis.
export type StateSpark = { jail: number[]; taskforce: number[]; wso: number[] };

export type StatesPageData = {
  snapshotDate: string | null;
  states: StateRow[];
  agencies: AgencyRow[];
  trendMonths: string[];
  stateSparkByAbbr: Record<string, StateSpark>;
};

export const load = async ({ fetch }): Promise<StatesPageData> => {
  const [agenciesRes, metaRes, terminatedRes, pendingRes] = await Promise.all([
    fetch("/data/dist/agency_index.json"),
    fetch("/data/dist/state_meta.json"),
    fetch("/data/dist/terminated_agencies.json"),
    fetch("/data/dist/pending_agencies.json"),
  ]);
  const allAgencies: Agency[] = agenciesRes.ok ? await agenciesRes.json() : [];
  const stateMetaArr: StateMeta[] = metaRes.ok ? await metaRes.json() : [];
  const terminated: Agency[] = terminatedRes.ok ? await terminatedRes.json() : [];
  const pending: Agency[] = pendingRes.ok ? await pendingRes.json() : [];
  const metaByState = new Map(stateMetaArr.map((s) => [s.state, s]));

  const snapshotDate =
    allAgencies
      .map((a) => a.snapshot_date)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null;

  const abbrs = Object.keys(NAVIGABLE_STATES);
  const agencyCountByState = new Map<string, number>();
  const modelCountsByState = new Map<string, Record<string, number>>();
  for (const a of allAgencies) {
    agencyCountByState.set(a.state, (agencyCountByState.get(a.state) ?? 0) + 1);
    const mc = modelCountsByState.get(a.state) ?? {};
    for (const m of a.models) mc[m] = (mc[m] ?? 0) + 1;
    modelCountsByState.set(a.state, mc);
  }

  const states: StateRow[] = abbrs
    .map((abbr) => ({
      abbr,
      stateName: NAVIGABLE_STATES[abbr],
      agencyCount: agencyCountByState.get(abbr) ?? 0,
      modelCounts: modelCountsByState.get(abbr) ?? {},
      populationServed: metaByState.get(abbr)?.population_served ?? null,
      localLeAgencies: metaByState.get(abbr)?.local_le_agencies ?? null,
      localParticipating: metaByState.get(abbr)?.participating ?? null,
    }))
    .sort((a, b) => b.agencyCount - a.agencyCount || a.stateName.localeCompare(b.stateName));

  // ORI-deduped, sorted largest-department-first — same list backs both the
  // default "largest first" view and the search filter.
  const oriSeen = new Set<string>();
  const agencies: AgencyRow[] = allAgencies
    .filter((a) => {
      if (!a.ori) return true;
      if (oriSeen.has(a.ori)) return false;
      oriSeen.add(a.ori);
      return true;
    })
    .map((a) => ({
      slug: a.slug,
      name: a.name,
      state: a.state,
      primary_model: a.primary_model,
      officerCt: a.lee?.officer_ct ?? 0,
      population: a.population ?? null,
      agencyType: a.agency_type,
    }))
    .sort((a, b) => b.officerCt - a.officerCt || a.name.localeCompare(b.name));

  // ── Growth sparkline data ──────────────────────────────────────────────────
  // Same Dec-2024 baseline as /timeline (see its BASELINE_YM comment) and the
  // same buildTimeline() primitive, just grouped per state and sampled onto
  // one shared month grid so states are comparable on a common x-axis. Only
  // the small sampled arrays are returned to the client — never raw history.
  const TREND_START = "2024-12";
  const nextYm = (ym: string) => {
    const y = Number(ym.slice(0, 4));
    const mo = Number(ym.slice(5, 7));
    return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  };
  const allForTrend = [...allAgencies, ...terminated, ...pending];
  let lastMonth = TREND_START;
  for (const a of allForTrend) {
    for (const h of a.history ?? []) {
      if (h.date.slice(0, 7) > lastMonth) lastMonth = h.date.slice(0, 7);
    }
  }
  const trendMonths: string[] = [];
  for (let ym = TREND_START; ym <= lastMonth; ym = nextYm(ym)) trendMonths.push(ym);

  const stateForTrend = new Map<string, Agency[]>();
  for (const a of allForTrend) {
    const arr = stateForTrend.get(a.state) ?? [];
    arr.push(a);
    stateForTrend.set(a.state, arr);
  }

  const buildSpark = (abbr: string): StateSpark | null => {
    const group = stateForTrend.get(abbr) ?? [];
    if (!group.length) return null;
    const out: StateSpark = { jail: [], taskforce: [], wso: [] };
    const pts = buildTimeline(group);
    if (pts.length) {
      let i = -1;
      for (const ym of trendMonths) {
        while (i + 1 < pts.length && pts[i + 1].date.slice(0, 7) <= ym) i++;
        out.jail.push(i >= 0 ? pts[i].jail : 0);
        out.taskforce.push(i >= 0 ? pts[i].taskforce : 0);
        out.wso.push(i >= 0 ? pts[i].wso : 0);
      }
      return out;
    }
    // No multi-date timeline (every agency in the group shares one history
    // date) — hold the current model counts flat from the first history
    // month onward instead of reporting a misleading all-zero line.
    const firstYm = group.flatMap((a) => (a.history ?? []).map((h) => h.date.slice(0, 7))).sort()[0];
    if (!firstYm) return null;
    const startYm = firstYm > TREND_START ? firstYm : TREND_START;
    const now = { jail: 0, taskforce: 0, wso: 0 };
    for (const a of group) {
      if (a.terminated_date) continue;
      for (const m of a.models) {
        const k = MODEL_SLUG[m] as keyof typeof now | undefined;
        if (k && k in now) now[k]++;
      }
    }
    for (const ym of trendMonths) {
      const hit = ym >= startYm;
      out.jail.push(hit ? now.jail : 0);
      out.taskforce.push(hit ? now.taskforce : 0);
      out.wso.push(hit ? now.wso : 0);
    }
    return out;
  };

  const stateSparkByAbbr: Record<string, StateSpark> = {};
  for (const abbr of abbrs) {
    const spark = buildSpark(abbr);
    if (spark) stateSparkByAbbr[abbr] = spark;
  }

  return { snapshotDate, states, agencies, trendMonths, stateSparkByAbbr };
};

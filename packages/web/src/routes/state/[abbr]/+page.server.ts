import { error } from "@sveltejs/kit";
import { STATE_NAMES } from "$lib/states";
import type { Agency, StateMeta } from "../../+page.server";
import { buildTimeline, type TimelinePoint } from "$lib/timeline";
import { MODEL_SLUG } from "$lib/colors";

export type TrendSeries = { jail: number[]; taskforce: number[]; wso: number[] };

export type StatePageData = {
  abbr: string;
  stateName: string;
  agencies: Agency[];
  stateMeta: StateMeta | null;
  snapshotDate: string | null;
  modelCounts: Record<string, number>;
  agencyTypeCounts: Record<string, number>;
  timeline: TimelinePoint[];
  nationalTimeline: TimelinePoint[];
  trendMonths: string[];
  trend: Record<string, TrendSeries>;
};

export const load = async ({ fetch, params }): Promise<StatePageData> => {
  const abbr = params.abbr.toUpperCase();
  const stateName = STATE_NAMES[abbr];
  if (!stateName) throw error(404, `Unknown state: ${abbr}`);

  const [agenciesRes, metaRes, terminatedRes] = await Promise.all([
    fetch("/data/dist/agency_index.json"),
    fetch("/data/dist/state_meta.json"),
    fetch("/data/dist/terminated_agencies.json"),
  ]);
  if (!agenciesRes.ok) throw error(503, "Data unavailable");

  const allAgencies: Agency[] = await agenciesRes.json();
  const terminatedRaw: Agency[] = terminatedRes.ok ? await terminatedRes.json() : [];
  const agencies = allAgencies.filter((a) => a.state === abbr);
  if (agencies.length === 0) throw error(404, `No 287(g) agencies found for ${abbr}`);

  const stateMetaArr: StateMeta[] = metaRes.ok ? await metaRes.json() : [];
  const stateMeta = stateMetaArr.find((s) => s.state === abbr) ?? null;

  const snapshotDate = allAgencies
    .map((a) => (a as any).snapshot_date as string | undefined)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  const modelCounts: Record<string, number> = {};
  for (const a of agencies) {
    for (const m of a.models) {
      modelCounts[m] = (modelCounts[m] ?? 0) + 1;
    }
  }

  const agencyTypeCounts: Record<string, number> = {};
  for (const a of agencies) {
    if (a.agency_type) {
      agencyTypeCounts[a.agency_type] = (agencyTypeCounts[a.agency_type] ?? 0) + 1;
    }
  }

  // ── Trend computation ────────────────────────────────────────────────────────
  const TREND_START = "2024-12";
  const stateForTrend = [...agencies, ...terminatedRaw.filter((a) => a.state === abbr)];
  let lastMonth = TREND_START;
  for (const a of stateForTrend)
    for (const h of a.history ?? [])
      if (h.date.slice(0, 7) > lastMonth) lastMonth = h.date.slice(0, 7);
  const trendMonths: string[] = [];
  for (let ym = TREND_START; ym <= lastMonth; ) {
    trendMonths.push(ym);
    const y = Number(ym.slice(0, 4));
    const mo = Number(ym.slice(5, 7));
    ym = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }

  const sampleMonthly = (group: Agency[]): TrendSeries => {
    const out: TrendSeries = { jail: [], taskforce: [], wso: [] };
    const seen = new Set<string>();
    const carriers = group.filter((a) => {
      const k = `${a.state}\x00${a.name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const pts = buildTimeline(carriers);
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
    const firstYm = group
      .flatMap((a) => (a.history ?? []).map((h) => h.date.slice(0, 7)))
      .sort()[0];
    const startYm = firstYm && firstYm > TREND_START ? firstYm : TREND_START;
    const counts = { jail: 0, taskforce: 0, wso: 0 };
    for (const a of group) {
      if (a.terminated_date) continue;
      for (const m of a.models) {
        const k = MODEL_SLUG[m] as keyof TrendSeries | undefined;
        if (k) counts[k]++;
      }
    }
    for (const ym of trendMonths) {
      const on = firstYm !== undefined && ym >= startYm;
      out.jail.push(on ? counts.jail : 0);
      out.taskforce.push(on ? counts.taskforce : 0);
      out.wso.push(on ? counts.wso : 0);
    }
    return out;
  };

  return {
    abbr, stateName, agencies, stateMeta, snapshotDate, modelCounts, agencyTypeCounts,
    timeline: buildTimeline([...agencies, ...terminatedRaw.filter((a) => a.state === abbr)]),
    nationalTimeline: buildTimeline([...allAgencies, ...terminatedRaw]),
    trendMonths,
    trend: { "": sampleMonthly(stateForTrend) },
  };
};

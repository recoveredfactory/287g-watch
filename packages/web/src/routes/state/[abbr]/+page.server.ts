import { error } from "@sveltejs/kit";
import { STATE_NAMES } from "$lib/states";
import type { Agency, StateMeta } from "../../+page.server";

export type StatePageData = {
  abbr: string;
  stateName: string;
  agencies: Agency[];
  stateMeta: StateMeta | null;
  snapshotDate: string | null;
  modelCounts: Record<string, number>;
  agencyTypeCounts: Record<string, number>;
};

export const load = async ({ fetch, params }): Promise<StatePageData> => {
  const abbr = params.abbr.toUpperCase();
  const stateName = STATE_NAMES[abbr];
  if (!stateName) throw error(404, `Unknown state: ${abbr}`);

  const [agenciesRes, metaRes] = await Promise.all([
    fetch("/data/dist/agency_index.json"),
    fetch("/data/dist/state_meta.json"),
  ]);
  if (!agenciesRes.ok) throw error(503, "Data unavailable");

  const allAgencies: Agency[] = await agenciesRes.json();
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

  return { abbr, stateName, agencies, stateMeta, snapshotDate, modelCounts, agencyTypeCounts };
};

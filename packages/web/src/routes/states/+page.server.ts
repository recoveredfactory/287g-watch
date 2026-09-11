import { NAVIGABLE_STATES } from "$lib/states";
import type { Agency, StateMeta } from "$lib/homeData.types";

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
};

export type StatesPageData = {
  snapshotDate: string | null;
  states: StateRow[];
  agencies: AgencyRow[];
};

export const load = async ({ fetch }): Promise<StatesPageData> => {
  const [agenciesRes, metaRes] = await Promise.all([
    fetch("/data/dist/agency_index.json"),
    fetch("/data/dist/state_meta.json"),
  ]);
  const allAgencies: Agency[] = agenciesRes.ok ? await agenciesRes.json() : [];
  const stateMetaArr: StateMeta[] = metaRes.ok ? await metaRes.json() : [];
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
    }))
    .sort((a, b) => b.officerCt - a.officerCt || a.name.localeCompare(b.name));

  return { snapshotDate, states, agencies };
};

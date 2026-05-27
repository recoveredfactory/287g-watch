export type HistoryEvent = {
  date: string;
  added: string[];
  removed: string[];
};

export type LeeData = {
  pub_agency_name: string;
  agency_type_name: string;
  population: number | null;
  officer_ct: number | null;
  civilian_ct: number | null;
  total_pe_ct: number | null;
  pe_ct_per_1000: number | null;
  data_year: number;
};

export type AgreementMetadata = {
  population_policed: number | null;
  operating_budget: number | null;
  agency_type: string | null;
};

export type AgencyNote = {
  kind: string;
  related_slug?: string;
  text: string;
};

export type Agency = {
  slug: string;
  name: string;
  state: string;
  county?: string;
  city?: string;
  agency_type: string;
  models: string[];
  primary_model: string;
  signed_date?: string;
  population?: number;
  lat?: number;
  lng?: number;
  moa_url?: string;
  ori?: string | null;
  snapshot_date?: string | null;
  contact_address?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  contact_website?: string | null;
  history?: HistoryEvent[];
  lee?: LeeData | null;
  agreement?: AgreementMetadata | null;
  notes?: AgencyNote[] | null;
};

export type StateMeta = {
  state: string;
  local_le_agencies: number;
  participating: number;
  pct: number;
  population_served: number;
  state_local_population: number;
  has_state_patrol: boolean;
};

export type PageData = {
  agencies: Agency[];
  agencyCount: number;
  stateCount: number;
  populationCovered: number;
  snapshotDate: string | null;
  modelCounts: Record<string, number>;
  stateMeta: Record<string, StateMeta>;
};

export const load = async ({ fetch }): Promise<PageData> => {
  try {
    const url = "/data/dist/agency_index.json";
    const [res, metaRes] = await Promise.all([
      fetch(url),
      fetch("/data/dist/state_meta.json"),
    ]);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const agencies: Agency[] = await res.json();
    const stateMetaArr: StateMeta[] = metaRes.ok ? await metaRes.json() : [];
    const stateMeta: Record<string, StateMeta> = Object.fromEntries(
      stateMetaArr.map((s) => [s.state, s]),
    );

    const states = new Set(agencies.map((a) => a.state));
    const populationCovered = agencies.reduce((sum, a) => sum + (a.population ?? 0), 0);
    const snapshotDate = agencies
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

    return {
      agencies,
      agencyCount: agencies.length,
      stateCount: states.size,
      populationCovered,
      snapshotDate,
      modelCounts,
      stateMeta,
    };
  } catch {
    return {
      agencies: [],
      agencyCount: 0,
      stateCount: 0,
      populationCovered: 0,
      snapshotDate: null,
      modelCounts: {},
      stateMeta: {},
    };
  }
};

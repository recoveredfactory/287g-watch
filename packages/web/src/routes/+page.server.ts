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
};

export type PageData = {
  agencies: Agency[];
  agencyCount: number;
  stateCount: number;
  populationCovered: number;
  snapshotDate: string | null;
};

export const load = async ({ fetch }): Promise<PageData> => {
  try {
    const url = "/data/dist/agency_index.json";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const agencies: Agency[] = await res.json();

    const states = new Set(agencies.map((a) => a.state));
    const populationCovered = agencies.reduce((sum, a) => sum + (a.population ?? 0), 0);

    return {
      agencies,
      agencyCount: agencies.length,
      stateCount: states.size,
      populationCovered,
      snapshotDate: null,
    };
  } catch {
    return {
      agencies: [],
      agencyCount: 0,
      stateCount: 0,
      populationCovered: 0,
      snapshotDate: null,
    };
  }
};

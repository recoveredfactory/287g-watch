import { buildTimeline } from "$lib/timeline";
import { MODEL_SLUG } from "$lib/colors";

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
  first_seen_date?: string | null;
  terminated_date?: string | null;
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

// What the homepage actually ships to the client: one slim entry per agency,
// used by the map, the timeline animation, and the client-side searchable
// list. It omits the heavy agency-page-only fields (history, the full lee
// record, agreement, notes, contacts) — keeping them roughly doubled the
// payload (~1.65 MB → 727 KB minified). Only lee.officer_ct survives, for the
// map's "officers per agency" tooltip. See #135.
export type HomeAgency = {
  slug: string;
  name: string;
  state: string;
  county?: string;
  city?: string;
  agency_type: string;
  models: string[];
  primary_model: string;
  signed_date?: string;
  // Set only on terminated agencies (the separate terminatedAgencies payload),
  // so the map can fade their dots out as the cursor crosses this date.
  terminated_date?: string | null;
  population?: number;
  lat?: number;
  lng?: number;
  moa_url?: string;
  ori?: string | null;
  lee?: { officer_ct: number | null } | null;
};

export type PageData = {
  agencies: HomeAgency[];
  // Once-active agencies that have since left 287(g). Kept OUT of `agencies`
  // (and every topline count) so the headline stays active-only; the map
  // renders them as dots that fade out at their terminated_date. See #118.
  terminatedAgencies: HomeAgency[];
  agencyCount: number;
  // Headline count deduplicated by FBI ORI. Several "agencies" in the upstream
  // sheet share an ORI (a sheriff's office and the same county's corrections
  // department, etc.) — we count distinct ORIs and treat each null-ORI row as
  // its own singleton. See #92.
  agencyCountUnique: number;
  stateCount: number;
  populationCovered: number;
  // Same dedupe applied to population, plus we restrict to local agencies
  // (County + Municipality). State-level rows like state police match LEE
  // rows that report the whole-state population, which would compound with
  // the local pops we're already summing. See #92 and #99.
  populationCoveredUnique: number;
  snapshotDate: string | null;
  modelCounts: Record<string, number>;
  stateMeta: Record<string, StateMeta>;
  // Active-agreement trend (#162): monthly active agency–model counts since
  // Dec 2024, replayed from history events. Keyed "" for national, else state
  // abbreviation; arrays align with trendMonths ("YYYY-MM"). Computed here so
  // the client never ships per-agency history (#135).
  trendMonths: string[];
  trend: Record<string, TrendSeries>;
};

export type TrendSeries = { jail: number[]; taskforce: number[]; wso: number[] };

export const load = async ({ fetch }): Promise<PageData> => {
  try {
    const url = "/data/dist/agency_index.json";
    const [res, metaRes, terminatedRes] = await Promise.all([
      fetch(url),
      fetch("/data/dist/state_meta.json"),
      fetch("/data/dist/terminated_agencies.json"),
    ]);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const agencies: Agency[] = await res.json();
    const stateMetaArr: StateMeta[] = metaRes.ok ? await metaRes.json() : [];
    const stateMeta: Record<string, StateMeta> = Object.fromEntries(
      stateMetaArr.map((s) => [s.state, s]),
    );

    const states = new Set(agencies.map((a) => a.state));
    const populationCovered = agencies.reduce((sum, a) => sum + (a.population ?? 0), 0);

    // Dedupe by ORI for the headline count. Every participating agency
    // counts — including state-level ones — so don't filter by agency_type
    // here. See #92.
    const oriSeen = new Set<string>();
    let nullOriCount = 0;
    for (const a of agencies) {
      if (a.ori) oriSeen.add(a.ori);
      else nullOriCount++;
    }
    const agencyCountUnique = oriSeen.size + nullOriCount;

    // Population sum is *local* only — state-level agencies report their
    // whole-state population via LEE (Idaho State Police = ~95% of Idaho,
    // etc.) which would compound with the county/city pops below. Same ORI
    // dedupe as above for the county sheriff + corrections double-counts.
    // See #99.
    const localPopByOri = new Map<string, number>();
    let nullOriLocalPop = 0;
    for (const a of agencies) {
      if (a.agency_type !== "County" && a.agency_type !== "Municipality") continue;
      const pop = a.population ?? 0;
      if (a.ori) {
        if (!localPopByOri.has(a.ori)) localPopByOri.set(a.ori, pop);
      } else {
        nullOriLocalPop += pop;
      }
    }
    const populationCoveredUnique =
      [...localPopByOri.values()].reduce((s, p) => s + p, 0) + nullOriLocalPop;
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

    // Project to the slim client shape *after* the aggregates above, which
    // still read the full records (snapshot_date, lee, etc.). See #135.
    const homeAgencies: HomeAgency[] = agencies.map((a) => ({
      slug: a.slug,
      name: a.name,
      state: a.state,
      county: a.county,
      city: a.city,
      agency_type: a.agency_type,
      models: a.models,
      primary_model: a.primary_model,
      signed_date: a.signed_date,
      population: a.population,
      lat: a.lat,
      lng: a.lng,
      moa_url: a.moa_url,
      ori: a.ori,
      lee: a.lee ? { officer_ct: a.lee.officer_ct } : null,
    }));

    // Terminated agencies — separate slim payload, map-only. Optional file so
    // older deploys (pre-#118 pipeline) still render (just without fade-outs).
    const terminatedRaw: Agency[] = terminatedRes.ok ? await terminatedRes.json() : [];
    const terminatedAgencies: HomeAgency[] = terminatedRaw.map((a) => ({
      slug: a.slug,
      name: a.name,
      state: a.state,
      county: a.county,
      city: a.city,
      agency_type: a.agency_type,
      models: a.models,
      primary_model: a.primary_model,
      signed_date: a.signed_date,
      terminated_date: a.terminated_date,
      population: a.population,
      lat: a.lat,
      lng: a.lng,
      moa_url: a.moa_url,
      ori: a.ori,
      lee: a.lee ? { officer_ct: a.lee.officer_ct } : null,
    }));

    // ── Active-agreement trend (#162) ────────────────────────────────────
    // Replay history events (live + terminated) into monthly active counts,
    // nationally and per state. Dec 2024 is the pre-2025 archive baseline
    // (#169); earlier events fold into that first sample.
    const TREND_START = "2024-12";
    const allForTrend = [...agencies, ...terminatedRaw];
    let lastMonth = TREND_START;
    for (const a of allForTrend)
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
      // The ingest unions history across upstream rows that share a
      // historyKey — duplicate rows of one real-world agency (separate
      // per-model agreements) carry identical event lists, so replaying every
      // row would double-count each of its models. Replay one carrier per
      // key, normalized the same way ingest's historyKey is (the duplicate
      // rows can differ by punctuation glyph, e.g. curly vs straight
      // apostrophe).
      const seen = new Set<string>();
      const carriers = group.filter((a) => {
        const k = `${a.state}\x00${a.name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim()}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const pts = buildTimeline(carriers);
      if (pts.length) {
        // Month value = the last replayed point in or before that month.
        let i = -1;
        for (const ym of trendMonths) {
          while (i + 1 < pts.length && pts[i + 1].date.slice(0, 7) <= ym) i++;
          out.jail.push(i >= 0 ? pts[i].jail : 0);
          out.taskforce.push(i >= 0 ? pts[i].taskforce : 0);
          out.wso.push(i >= 0 ? pts[i].wso : 0);
        }
        return out;
      }
      // buildTimeline yields nothing below 2 distinct event dates. A scope
      // with a single one (AK, CO, GU, MP) can't have terminations, so it's
      // just the current models, flat from that date.
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

    const trendByState = new Map<string, Agency[]>();
    for (const a of allForTrend) {
      if (!a.state) continue;
      const g = trendByState.get(a.state);
      if (g) g.push(a);
      else trendByState.set(a.state, [a]);
    }
    const trend: Record<string, TrendSeries> = { "": sampleMonthly(allForTrend) };
    for (const [st, group] of trendByState) trend[st] = sampleMonthly(group);

    return {
      agencies: homeAgencies,
      terminatedAgencies,
      agencyCount: agencies.length,
      agencyCountUnique,
      stateCount: states.size,
      populationCovered,
      populationCoveredUnique,
      snapshotDate,
      modelCounts,
      stateMeta,
      trendMonths,
      trend,
    };
  } catch {
    return {
      agencies: [],
      terminatedAgencies: [],
      agencyCount: 0,
      agencyCountUnique: 0,
      stateCount: 0,
      populationCovered: 0,
      populationCoveredUnique: 0,
      snapshotDate: null,
      modelCounts: {},
      stateMeta: {},
      trendMonths: [],
      trend: {},
    };
  }
};

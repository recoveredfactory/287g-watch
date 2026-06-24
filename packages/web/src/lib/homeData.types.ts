// Shared homepage/data types. Extracted from routes/+page.server.ts so both the
// homepage load and the /video/national load can build the same `PageData`
// without either importing server-only code for its *types*. The data *builder*
// lives in $lib/server/homeData.ts (server-only); these are the pure shapes.

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
  moa_date_signed?: string | null;
  ice_field_office?: string | null;
  ice_signer_name?: string | null;
  ice_signer_title?: string | null;
  lea_signer_name?: string | null;
  moa_poc_name?: string | null;
  moa_poc_email?: string | null;
  moa_poc_phone?: string | null;
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

export type TrendSeries = { jail: number[]; taskforce: number[]; wso: number[] };

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

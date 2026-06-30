import { buildHomeData } from "$lib/server/homeData";

// The homepage and /video/national share one data builder. See
// $lib/server/homeData.ts (builder) and $lib/homeData.types.ts (shapes).
export const load = ({ fetch }) => buildHomeData(fetch);

// Re-export the shapes for back-compat: other modules import these types from
// here (e.g. AgencySearch imported `Agency`). New code should import from
// $lib/homeData.types directly.
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

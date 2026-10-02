import { error, redirect } from "@sveltejs/kit";
import { AGENCY_SLUG_REDIRECTS } from "$lib/agencyRedirects";
import { SHOW_SUCCESS_STORIES } from "$lib/features";
import { MIN_ARREST_STATS_TOTAL } from "$lib/arrestStats";
import type { Agency } from "../../+page.server";

export type SuccessStory = {
  id: string;
  agency_slug: string;
  date_encountered: string | null;
  model_type: string | null;
  raw_text: string;
  source_pdf: string;
  source_period: string;
  page_number: number | null;
};

export type MuckrockRequest = {
  foia_id: number;
  absolute_url: string;
  agency_label: string;
  jurisdiction: string;
  agency_slug: string | null;
  title: string;
  status: string;
  datetime_submitted: string | null;
  datetime_done: string | null;
  datetime_updated: string | null;
};

export type MuckrockSnapshot = {
  multirequest: { id: number; title: string; absolute_url: string; filer: string };
  reporter_guide: { title: string; absolute_url: string; publisher: string };
  snapshot_date: string;
  requests: MuckrockRequest[];
};

export type AgencyPageData = {
  agency: Agency;
  agencies: Agency[];
  muckrock: {
    requests: MuckrockRequest[];
    multirequest: MuckrockSnapshot["multirequest"];
    reporter_guide: MuckrockSnapshot["reporter_guide"];
  };
  successStories: SuccessStory[];
  detainerStats: DetainerStats | null;
  arrestStats: ArrestStats | null;
};

// Real per-agency ICE detainer counts from the Deportation Data Project
// (UC Berkeley Law + UCLA) — FOIA-obtained, CC-0. See
// packages/pipeline/build-detainer-stats.ts for how this is built/matched.
export type DetainerOutcome = "booked" | "released" | "declined_by_agency" | "pending" | "other";
export type DetainerStats = {
  total: number;
  by_year: Record<string, number>;
  by_outcome: Record<DetainerOutcome, number>;
  by_year_outcome: Record<string, Record<DetainerOutcome, number>>;
  by_country: Record<string, number>;
};

// Real per-agency ICE arrest counts, same source as DetainerStats. See
// packages/pipeline/build-arrest-stats.ts. Coverage here is much patchier
// than detainers (event_landmark is noisier than detainers' facility
// field) — the web side requires a minimum matched count before rendering
// the section at all, so a page never shows a stray "1 arrest" that reads
// as noise rather than signal.
export type ArrestCriminality = "convicted" | "pending_charges" | "other";
export type ArrestStats = {
  total: number;
  by_year: Record<string, number>;
  by_criminality: Record<ArrestCriminality, number>;
  by_year_criminality: Record<string, Record<ArrestCriminality, number>>;
  by_country: Record<string, number>;
};

export const load = async ({ fetch, params, url }): Promise<AgencyPageData> => {
  // A slug the dedup retired (#240): one agency that upstream spelled two ways
  // used to be two records, and the twin held a `…-1` URL that the sitemap
  // published. Point it at the record that absorbed it. Only the last path
  // segment is swapped, so the locale prefix (/es/agency/…) rides along.
  const mergedInto = AGENCY_SLUG_REDIRECTS[params.slug];
  if (mergedInto) redirect(301, url.pathname.replace(/[^/]+$/, mergedInto) + url.search);

  const [agenciesRes, terminatedRes, pendingRes, muckrockRes, storiesRes, detainerStatsRes, arrestStatsRes] = await Promise.all([
    fetch("/data/dist/agency_index.json"),
    fetch("/data/dist/terminated_agencies.json"),
    fetch("/data/dist/pending_agencies.json"),
    fetch("/data/dist/muckrock_requests.json"),
    // Skip the fetch entirely while the feature is flagged off — no reason
    // to ship the request on every agency page load for a section nobody
    // can see yet.
    SHOW_SUCCESS_STORIES ? fetch("/data/dist/success_stories.json") : Promise.resolve(null),
    fetch("/data/dist/detainer_stats.json"),
    fetch("/data/dist/arrest_stats.json"),
  ]);
  if (!agenciesRes.ok) throw error(503, "Data unavailable");

  const agencies: Agency[] = await agenciesRes.json();
  // Terminated agencies live in a separate payload (kept out of the active
  // index). Resolve those slugs too, so a dot that faded off the map still
  // links to a real page — flagged as ended via its terminated_date. See #118.
  const terminated: Agency[] = terminatedRes.ok ? await terminatedRes.json() : [];
  // Pending agencies (absent 1–2 snapshots, terminated_date null) resolve here too
  // so their page renders instead of 404'ing while they're briefly off-roster. #245
  const pending: Agency[] = pendingRes.ok ? await pendingRes.json() : [];
  const agency = agencies.find((a) => a.slug === params.slug)
    ?? terminated.find((a) => a.slug === params.slug)
    ?? pending.find((a) => a.slug === params.slug);
  if (!agency) throw error(404, `Agency not found: ${params.slug}`);

  // muckrock_requests.json is optional — fall back gracefully so older deploys
  // without the snapshot still render the page (just without the dive-deeper match).
  //
  // `.ok` alone is not enough of a guard. When the file is absent from the build
  // it also drops out of `manifest.assets`, and SvelteKit's server fetch then
  // stops treating it as a static asset and recurses back into the app — which
  // answers 200 with an already-consumed body, so `.json()` throws "Body is
  // unusable" and 500s the whole page. See #267 and scripts/copy-static-data.mjs.
  let muckrock: MuckrockSnapshot | null = null;
  try {
    if (muckrockRes.ok) muckrock = (await muckrockRes.json()) as MuckrockSnapshot;
  } catch (e) {
    console.warn(`muckrock snapshot unreadable, rendering without it: ${e}`);
  }

  // Same defensive shape as the muckrock fetch above — storiesRes is null
  // outright when the flag is off (no fetch was made).
  let allStories: SuccessStory[] = [];
  try {
    if (storiesRes?.ok) allStories = (await storiesRes.json()) as SuccessStory[];
  } catch (e) {
    console.warn(`success stories unreadable, rendering without them: ${e}`);
  }

  let allDetainerStats: Record<string, DetainerStats> = {};
  try {
    if (detainerStatsRes.ok) allDetainerStats = (await detainerStatsRes.json()) as Record<string, DetainerStats>;
  } catch (e) {
    console.warn(`detainer stats unreadable, rendering without them: ${e}`);
  }

  let allArrestStats: Record<string, ArrestStats> = {};
  try {
    if (arrestStatsRes.ok) allArrestStats = (await arrestStatsRes.json()) as Record<string, ArrestStats>;
  } catch (e) {
    console.warn(`arrest stats unreadable, rendering without them: ${e}`);
  }

  return {
    agency,
    agencies,
    muckrock: {
      requests: muckrock?.requests?.filter((r) => r.agency_slug === agency.slug) ?? [],
      multirequest: muckrock?.multirequest ?? {
        id: 175020,
        title: "ICE Detainers and 287(g) Policies",
        absolute_url: "https://www.muckrock.com/foi/multirequest/ice-detainers-and-287g-policies-175020/",
        filer: "Jasmine Lewin",
      },
      reporter_guide: muckrock?.reporter_guide ?? {
        title: "How to follow the paper trail of ICE's local immigration enforcement",
        absolute_url: "https://www.muckrock.com/news/archives/2026/may/20/how-to-follow-the-paper-trail-of-ices-local-immigration-enforcement/",
        publisher: "MuckRock",
      },
    },
    successStories: allStories.filter((s) => s.agency_slug === agency.slug),
    detainerStats: allDetainerStats[agency.slug] ?? null,
    arrestStats:
      (allArrestStats[agency.slug]?.total ?? 0) >= MIN_ARREST_STATS_TOTAL ? allArrestStats[agency.slug] : null,
  };
};

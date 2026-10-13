import { error, redirect } from "@sveltejs/kit";
import { AGENCY_SLUG_REDIRECTS } from "$lib/agencyRedirects";
import { resolveMoaUrl } from "$lib/moaDocuments";
import { readStaticData } from "$lib/server/staticData";
import type { Agency } from "../../+page.server";

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
  // The active agencies this one's notes point at, keyed by slug.
  relatedAgencies: Record<string, { slug: string; name: string }>;
  officerCtRank: number;
  officerCtRankTotal: number;
  muckrock: {
    requests: MuckrockRequest[];
    multirequest: MuckrockSnapshot["multirequest"];
    reporter_guide: MuckrockSnapshot["reporter_guide"];
  };
};

export const load = async ({ params, url }): Promise<AgencyPageData> => {
  // A slug the dedup retired (#240): one agency that upstream spelled two ways
  // used to be two records, and the twin held a `…-1` URL that the sitemap
  // published. Point it at the record that absorbed it. Only the last path
  // segment is swapped, so the locale prefix (/es/agency/…) rides along.
  const mergedInto = AGENCY_SLUG_REDIRECTS[params.slug];
  if (mergedInto) redirect(301, url.pathname.replace(/[^/]+$/, mergedInto) + url.search);

  const [agencies, terminated, pending, muckrock] = await Promise.all([
    readStaticData<Agency[]>("agency_index.json"),
    // Terminated agencies live in a separate payload (kept out of the active
    // index). Resolve those slugs too, so a dot that faded off the map still
    // links to a real page — flagged as ended via its terminated_date. See #118.
    readStaticData<Agency[]>("terminated_agencies.json").then((v) => v ?? []),
    // Pending agencies (absent 1–2 snapshots, terminated_date null) resolve here too
    // so their page renders instead of 404'ing while they're briefly off-roster. #245
    readStaticData<Agency[]>("pending_agencies.json").then((v) => v ?? []),
    // muckrock_requests.json is optional — older deploys without the snapshot
    // still render the page (just without the dive-deeper match).
    readStaticData<MuckrockSnapshot>("muckrock_requests.json"),
  ]);
  if (!agencies) throw error(503, "Data unavailable");

  const agency = agencies.find((a) => a.slug === params.slug)
    ?? terminated.find((a) => a.slug === params.slug)
    ?? pending.find((a) => a.slug === params.slug);
  if (!agency) throw error(404, `Agency not found: ${params.slug}`);

  // Rank by officer count among active agencies — same sort /states uses for
  // its own rank numbers (officerCt desc, then name), so the figure matches
  // what /states shows. 0 (not found) for terminated/pending agencies, which
  // aren't in the active `agencies` list being ranked.
  const officerCtRanked = [...agencies].sort(
    (a, b) => (b.lee?.officer_ct ?? 0) - (a.lee?.officer_ct ?? 0) || a.name.localeCompare(b.name),
  );
  const officerCtRank = officerCtRanked.findIndex((a) => a.slug === agency.slug) + 1;
  const officerCtRankTotal = officerCtRanked.length;

  const relatedAgencies: AgencyPageData["relatedAgencies"] = {};
  for (const note of agency.notes ?? []) {
    const related = note.related_slug ? agencies.find((a) => a.slug === note.related_slug) : undefined;
    if (related) relatedAgencies[related.slug] = { slug: related.slug, name: related.name };
  }

  // ~10% of agencies have no structured `agreements[]`, so their only MOA
  // link is this flat field — which upstream is a GitHub directory listing,
  // not a document. Resolved server-side (the lookup is ~540KB, no reason
  // to ship it to the client) so the template can keep reading
  // agency.moa_url exactly as before. Agencies WITH structured agreements
  // already carry correct per-model /blob/ links from the pipeline — this
  // is a no-op passthrough for those (a /blob/ URL is never a key in the
  // /tree/-keyed lookup).
  const agencyResolved: Agency = { ...agency, moa_url: resolveMoaUrl(agency.moa_url, agency.primary_model) };

  return {
    agency: agencyResolved,
    relatedAgencies,
    officerCtRank,
    officerCtRankTotal,
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
  };
};

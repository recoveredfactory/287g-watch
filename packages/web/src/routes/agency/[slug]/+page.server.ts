import { error } from "@sveltejs/kit";
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
  agencies: Agency[];
  muckrock: {
    requests: MuckrockRequest[];
    multirequest: MuckrockSnapshot["multirequest"];
    reporter_guide: MuckrockSnapshot["reporter_guide"];
  };
};

export const load = async ({ fetch, params }): Promise<AgencyPageData> => {
  const [agenciesRes, terminatedRes, muckrockRes] = await Promise.all([
    fetch("/data/dist/agency_index.json"),
    fetch("/data/dist/terminated_agencies.json"),
    fetch("/data/dist/muckrock_requests.json"),
  ]);
  if (!agenciesRes.ok) throw error(503, "Data unavailable");

  const agencies: Agency[] = await agenciesRes.json();
  // Terminated agencies live in a separate payload (kept out of the active
  // index). Resolve those slugs too, so a dot that faded off the map still
  // links to a real page — flagged as ended via its terminated_date. See #118.
  const terminated: Agency[] = terminatedRes.ok ? await terminatedRes.json() : [];
  const agency = agencies.find((a) => a.slug === params.slug)
    ?? terminated.find((a) => a.slug === params.slug);
  if (!agency) throw error(404, `Agency not found: ${params.slug}`);

  // muckrock_requests.json is optional — fall back gracefully so older deploys
  // without the snapshot still render the page (just without the dive-deeper match).
  const muckrock = muckrockRes.ok
    ? (await muckrockRes.json() as MuckrockSnapshot)
    : null;

  return {
    agency,
    agencies,
    muckrock: {
      requests: muckrock?.requests.filter((r) => r.agency_slug === agency.slug) ?? [],
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

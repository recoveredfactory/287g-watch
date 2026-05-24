import { error } from "@sveltejs/kit";
import type { Agency } from "../../+page.server";

export type AgencyPageData = {
  agency: Agency;
};

export const load = async ({ fetch, params }): Promise<AgencyPageData> => {
  const res = await fetch("/data/dist/agency_index.json");
  if (!res.ok) throw error(503, "Data unavailable");

  const agencies: Agency[] = await res.json();
  const agency = agencies.find((a) => a.slug === params.slug);
  if (!agency) throw error(404, `Agency not found: ${params.slug}`);

  return { agency };
};

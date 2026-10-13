import { json } from "@sveltejs/kit";
import type { Agency, TerminatedPoint } from "$lib/homeData.types";
import { readStaticData } from "$lib/server/staticData";

// Built once at build time and served from S3/CloudFront like the rest of /data.
export const prerender = true;

// Agencies that have left 287(g), as map dots: the homepage map fades them out
// at their terminated_date (#308).
export const GET = async () => {
  const terminated = await readStaticData<Agency[]>("terminated_agencies.json");
  if (!terminated) throw new Error("terminated_agencies.json unavailable");
  const points: TerminatedPoint[] = terminated.map((a) => ({
    slug: a.slug,
    name: a.name,
    state: a.state,
    city: a.city,
    models: a.models,
    primary_model: a.primary_model,
    signed_date: a.signed_date,
    terminated_date: a.terminated_date,
    population: a.population,
    lat: a.lat,
    lng: a.lng,
    lee: a.lee ? { officer_ct: a.lee.officer_ct } : null,
  }));
  return json(points);
};

import { json } from "@sveltejs/kit";
import type { Agency, MapPoint } from "$lib/homeData.types";
import { readStaticData } from "$lib/server/staticData";

// Built once at build time and served from S3/CloudFront like the rest of /data.
export const prerender = true;

// Every active agency as a map dot: the national layer the state and agency maps
// draw. One cached file instead of a copy inside every page's data (#292). Kept
// in index order, which is the dots' draw order.
export const GET = async () => {
  const agencies = await readStaticData<Agency[]>("agency_index.json");
  if (!agencies) throw new Error("agency_index.json unavailable");
  const points: MapPoint[] = agencies.map((a) => ({
    slug: a.slug,
    name: a.name,
    state: a.state,
    city: a.city,
    models: a.models,
    primary_model: a.primary_model,
    signed_date: a.signed_date,
    population: a.population,
    lat: a.lat,
    lng: a.lng,
    lee: a.lee ? { officer_ct: a.lee.officer_ct } : null,
  }));
  return json(points);
};

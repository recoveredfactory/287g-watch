import { json } from "@sveltejs/kit";
import type { Agency, SearchIndexEntry } from "$lib/homeData.types";
import { readStaticData } from "$lib/server/staticData";

// Built once at build time and served from S3/CloudFront like the rest of /data.
export const prerender = true;

// The header search's agency list: only the fields it matches and shows, instead
// of the 4.4 MB agency index (#292). Sorted biggest-first by population, so the
// search can take its first matches in order.
export const GET = async () => {
  const agencies = await readStaticData<Agency[]>("agency_index.json");
  if (!agencies) throw new Error("agency_index.json unavailable");
  const index: SearchIndexEntry[] = [...agencies]
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
    .map(({ slug, name, state, city, county, primary_model }) => ({ slug, name, state, city, county, primary_model }));
  return json(index);
};

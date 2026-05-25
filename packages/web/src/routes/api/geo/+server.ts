import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ request, setHeaders, fetch }) => {
  setHeaders({ "cache-control": "no-store" });

  // Locally there's no CloudFront, so headers are absent. Proxy to staging
  // so dev can exercise the real geo-default flow instead of seeing nulls.
  if (import.meta.env.DEV) {
    try {
      const res = await fetch("https://staging.287g.recoveredfactory.net/api/geo");
      if (res.ok) return json(await res.json());
    } catch {}
    return json({ country: null, state: null });
  }

  const country = request.headers.get("cloudfront-viewer-country");
  const region = request.headers.get("cloudfront-viewer-country-region");
  return json({
    country: country || null,
    state: country === "US" && region ? region : null,
  });
};

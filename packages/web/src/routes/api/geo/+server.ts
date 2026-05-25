import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ request, setHeaders }) => {
  const country = request.headers.get("cloudfront-viewer-country");
  const region = request.headers.get("cloudfront-viewer-country-region");

  setHeaders({ "cache-control": "no-store" });

  return json({
    country: country || null,
    state: country === "US" && region ? region : null,
  });
};

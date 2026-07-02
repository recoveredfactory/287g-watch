// Client-side geo lookup shared by the homepage hero callout and the /states
// index "jump to your state" banner. Talks to /api/geo, which reads CloudFront's
// viewer-country/region headers in prod (and proxies to staging in dev).

export type Geo = { country: string | null; state: string | null };

// Per-session geo cache — dedupes /api/geo across a browsing session but
// re-checks on the next visit, so a wrong/stale geo lookup self-heals instead of
// being pinned for days. sessionStorage clears when the tab closes (also makes
// VPN/location testing trivial: new tab = fresh lookup).
const GEO_KEY = "rf-geo-v1";

export async function getCachedGeo(): Promise<Geo> {
  try {
    const raw = sessionStorage.getItem(GEO_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      return { country: cached.c ?? null, state: cached.s ?? null };
    }
  } catch {}
  try {
    const res = await fetch("/api/geo", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      // Only cache a definitive answer; don't pin a transient null for the whole
      // session.
      if (data.country) {
        try {
          sessionStorage.setItem(GEO_KEY, JSON.stringify({ c: data.country, s: data.state }));
        } catch {}
      }
      return data;
    }
  } catch {}
  return { country: null, state: null };
}

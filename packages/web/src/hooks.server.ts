import type { Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import { paraglideMiddleware } from "$lib/paraglide/server";
import {
  getTextDirection,
  locales,
  baseLocale,
  cookieName,
  type Locale,
} from "$lib/paraglide/runtime";

const STATIC_PREFIXES = ["/_app/", "/data/", "/api/"];
const STATIC_FILES = ["/favicon.svg", "/favicon-staging.svg", "/robots.txt", "/sitemap.xml"];

function pickLocaleFromAcceptLanguage(header: string | null): Locale {
  if (!header) return baseLocale;
  const ranges = header
    .toLowerCase()
    .split(",")
    .map((part) => part.trim().split(";")[0].split("-")[0]);
  for (const tag of ranges) {
    if ((locales as readonly string[]).includes(tag)) return tag as Locale;
  }
  return baseLocale;
}

function pickLocaleFromCookie(header: string | null): Locale | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === cookieName && v) {
      const value = decodeURIComponent(v);
      if ((locales as readonly string[]).includes(value)) return value as Locale;
    }
  }
  return null;
}

// Bare-path routes that should NOT honor the saved-language cookie. The
// social-video routes (#167) are baked/shared per-locale and aren't advertised,
// so a stale toggle cookie shouldn't bounce /video/national to /es — fall back
// to the browser's Accept-Language (then baseLocale) instead.
const COOKIE_EXEMPT_PREFIXES = ["/video/"];

const redirectBarePathToLocale: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;

  if (STATIC_FILES.includes(path) || STATIC_PREFIXES.some((p) => path.startsWith(p))) {
    return resolve(event);
  }
  const hasLocalePrefix = (locales as readonly string[]).some(
    (l) => path === `/${l}` || path.startsWith(`/${l}/`)
  );
  if (hasLocalePrefix) return resolve(event);

  const cookieExempt = COOKIE_EXEMPT_PREFIXES.some((p) => path.startsWith(p));
  const target =
    (cookieExempt ? null : pickLocaleFromCookie(event.request.headers.get("cookie"))) ??
    pickLocaleFromAcceptLanguage(event.request.headers.get("accept-language"));
  const location = `/${target}${path === "/" ? "" : path}${event.url.search}`;
  // 302 + no-store on purpose: the target varies by cookie/Accept-Language, so
  // a cacheable 301 would pin every later visitor to the first locale seen.
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": "no-store",
    },
  });
};

const paraglideHandle: Handle = ({ event, resolve }) => {
  const path = event.url.pathname;
  // Paraglide redirects browser document requests for unrecognized URLs to the
  // locale-prefixed form. That breaks /sitemap.xml and /robots.txt, which must
  // resolve at the root. Same goes for the static asset and API prefixes —
  // they never need locale handling.
  if (STATIC_FILES.includes(path) || STATIC_PREFIXES.some((p) => path.startsWith(p))) {
    return resolve(event);
  }
  return paraglideMiddleware(event.request, ({ request, locale }) => {
    event.request = request;
    return resolve(event, {
      transformPageChunk: ({ html }) =>
        html.replace("%paraglide.lang%", locale).replace("%paraglide.dir%", getTextDirection(locale)),
    });
  });
};

// Pages render the same for every viewer: the locale comes from the URL, and
// cookies, Accept-Language and geo are read only by the bare-path redirect and
// /api/geo, which both send no-store. So CloudFront can hold them, revalidated
// by browsers and cleared by the /* invalidation every deploy runs (#292). An
// hour rather than the day SST gives the /data JSON, because the homepage's
// "last 30 days" leaderboard is cut at render time. Client-side navigation's
// __data.json gets the same in place of SvelteKit's blanket private/no-store,
// unless a load failed: that still answers 200, with an error node, and a
// transient 503 shouldn't stick.
const EDGE_CACHE_CONTROL = "public, max-age=0, s-maxage=3600, stale-while-revalidate=3600";

const cacheAtEdge: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (event.request.method !== "GET" || response.status !== 200) return response;
  const cacheControl = response.headers.get("cache-control");
  if (event.isDataRequest) {
    if (cacheControl !== "private, no-store") return response;
    if (!response.headers.get("content-type")?.startsWith("application/json")) return response;
    const payload = await response.clone().json();
    if (payload.type !== "data" || payload.nodes.some((node: { type?: string } | null) => node?.type === "error")) {
      return response;
    }
  } else if (cacheControl !== null) {
    return response;
  }
  response.headers.set("cache-control", EDGE_CACHE_CONTROL);
  return response;
};

export const handle: Handle = sequence(cacheAtEdge, redirectBarePathToLocale, paraglideHandle);

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

const redirectBarePathToLocale: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;

  if (STATIC_FILES.includes(path) || STATIC_PREFIXES.some((p) => path.startsWith(p))) {
    return resolve(event);
  }
  const hasLocalePrefix = (locales as readonly string[]).some(
    (l) => path === `/${l}` || path.startsWith(`/${l}/`)
  );
  if (hasLocalePrefix) return resolve(event);

  const target =
    pickLocaleFromCookie(event.request.headers.get("cookie")) ??
    pickLocaleFromAcceptLanguage(event.request.headers.get("accept-language"));
  const location = `/${target}${path === "/" ? "" : path}${event.url.search}`;
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": "no-store",
    },
  });
};

const paraglideHandle: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ request, locale }) => {
    event.request = request;
    return resolve(event, {
      transformPageChunk: ({ html }) =>
        html.replace("%paraglide.lang%", locale).replace("%paraglide.dir%", getTextDirection(locale)),
    });
  });

export const handle: Handle = sequence(redirectBarePathToLocale, paraglideHandle);

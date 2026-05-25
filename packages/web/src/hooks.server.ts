import type { Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import { paraglideMiddleware } from "$lib/paraglide/server";
import { getTextDirection, locales, baseLocale, type Locale } from "$lib/paraglide/runtime";

const STATIC_PREFIXES = ["/_app/", "/data/"];
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

const redirectBarePathToLocale: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;

  if (STATIC_FILES.includes(path) || STATIC_PREFIXES.some((p) => path.startsWith(p))) {
    return resolve(event);
  }
  const hasLocalePrefix = (locales as readonly string[]).some(
    (l) => path === `/${l}` || path.startsWith(`/${l}/`)
  );
  if (hasLocalePrefix) return resolve(event);

  const target = pickLocaleFromAcceptLanguage(event.request.headers.get("accept-language"));
  const location = `/${target}${path === "/" ? "" : path}${event.url.search}`;
  return new Response(null, {
    status: 302,
    headers: {
      location,
      vary: "Accept-Language",
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

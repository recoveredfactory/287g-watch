// Paraglide matches every href against urlPatterns through the URLPattern
// polyfill (Node 20 and 22 have no native one): roughly 0.5 ms a call, and a
// big state page makes hundreds, about 300 ms of /state/tx's render (#292).
// With our same-origin /en/… and /es/… patterns, a root-relative href's result
// depends only on (locale, href), so it's computed once.
import {
  getLocale,
  localizeHref as paraglideLocalizeHref,
  type Locale,
} from "$lib/paraglide/runtime";

const cache = new Map<string, string>();

export function localizeHref(href: string, options?: { locale?: Locale }): string {
  if (!href.startsWith("/")) return paraglideLocalizeHref(href, options);
  const locale = options?.locale ?? getLocale();
  const key = `${locale} ${href}`;
  let localized = cache.get(key);
  if (localized === undefined) {
    localized = paraglideLocalizeHref(href, { locale });
    cache.set(key, localized);
  }
  return localized;
}

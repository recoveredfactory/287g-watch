import type { RequestHandler } from "./$types";
import type { Agency } from "../+page.server";
import { locales, baseLocale } from "$lib/paraglide/runtime";

export const prerender = true;

const STATIC_PATHS = ["/", "/about", "/glossary", "/methodology", "/model/jail", "/model/taskforce", "/model/wso"];

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const localized = (path: string, locale: string): string => {
  if (path === "/") return `/${locale}`;
  return `/${locale}${path}`;
};

const urlEntry = (siteUrl: string, path: string, lastmod: string | null): string => {
  const alternates = (locales as readonly string[])
    .map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${xmlEscape(siteUrl + localized(path, l))}"/>`)
    .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(siteUrl + localized(path, baseLocale))}"/>`)
    .join("\n");

  return (locales as readonly string[])
    .map((l) => {
      const loc = xmlEscape(siteUrl + localized(path, l));
      const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : "";
      return `  <url>\n    <loc>${loc}</loc>${lastmodTag}\n${alternates}\n  </url>`;
    })
    .join("\n");
};

export const GET: RequestHandler = async ({ fetch, url }) => {
  const siteUrl = (import.meta.env.PUBLIC_SITE_URL ?? "https://287g.recoveredfactory.net").replace(/\/$/, "");

  let agencies: Agency[] = [];
  let snapshotDate: string | null = null;
  try {
    const res = await fetch("/data/dist/agency_index.json");
    if (res.ok) {
      agencies = await res.json();
      snapshotDate =
        agencies
          .map((a) => (a as any).snapshot_date as string | undefined)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null;
    }
  } catch {}

  const entries: string[] = [];
  for (const path of STATIC_PATHS) {
    entries.push(urlEntry(siteUrl, path, snapshotDate));
  }
  for (const a of agencies) {
    entries.push(urlEntry(siteUrl, `/agency/${a.slug}`, snapshotDate));
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>
`;

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};

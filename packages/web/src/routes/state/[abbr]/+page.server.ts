import { error } from "@sveltejs/kit";
import { NAVIGABLE_STATES } from "$lib/states";
import type { Agency, StateMeta } from "../../+page.server";
import type { HomeAgency } from "$lib/homeData.types";
import { buildTimeline, type TimelinePoint } from "$lib/timeline";
import { MODEL_SLUG } from "$lib/colors";
import { getLocale } from "$lib/paraglide/runtime";

export type TrendSeries = { jail: number[]; taskforce: number[]; wso: number[] };

export type StatePageData = {
  abbr: string;
  stateName: string;
  agencies: Agency[];
  // Slim, national, map-only list (every active agency). The map shows the
  // whole footprint and dims dots outside the selected state; `agencies` above
  // stays state-only for the table/counts/filters. See focusSelected in
  // NationalMap.
  mapAgencies: HomeAgency[];
  stateMeta: StateMeta | null;
  snapshotDate: string | null;
  modelCounts: Record<string, number>;
  agencyTypeCounts: Record<string, number>;
  timeline: TimelinePoint[];
  nationalTimeline: TimelinePoint[];
  trendMonths: string[];
  trend: Record<string, TrendSeries>;
  news: StateNews | null;
};

// The news program emits a short TL;DR plus the full statewide narrative, in
// both EN and ES. The page shows the TL;DR and expands the body behind a "read
// more" toggle. We resolve the active locale here so only that language's HTML
// ships to the client.
//
// `articles` is the program's discovered-article table (language-independent,
// stored raw under `internal`). We shape it for display here: keep only relevant
// rows, project to the columns the table shows, strip Google News' " - Publisher"
// suffix off the headline (publisher is its own column), and move the link onto
// the title. The full raw table stays in the JSON's `internal` for debugging.
export type NewsArticle = {
  title: string;
  url: string;
  publication: string;
  date: string;
  agencies: string;
  counties: string;
};
export type StateNews = {
  tldr_html: string;
  body_html: string;
  generated_at: string;
  articles: NewsArticle[];
};

type RawArticle = Record<string, unknown>;
type NewsLangBlock = { tldr_html?: string; summary_html?: string };
type NewsFile = {
  generated_at?: string;
  en?: NewsLangBlock;
  es?: NewsLangBlock;
  internal?: { relevant_articles?: RawArticle[] };
};

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

// "Headline - Idaho Capital Sun" → "Headline", but only when the trailing segment
// is exactly the publication, so headlines that legitimately contain " - " survive.
const cleanTitle = (title: string, publication: string): string => {
  const suffix = ` - ${publication}`;
  return publication && title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
};

// Parse the program's date (RSS "Thu, 02 Apr 2026 …" or ISO "2025-10-15") to a
// sortable number; unparseable dates sort to the bottom.
const dateValue = (d: string): number => {
  const t = new Date(d).getTime();
  return isNaN(t) ? -Infinity : t;
};

const shapeArticles = (rows: RawArticle[]): NewsArticle[] =>
  rows
    .filter((r) => str(r.Relevant).toLowerCase() === "yes")
    .map((r) => {
      const publication = str(r.Publication);
      return {
        title: cleanTitle(str(r.Title), publication),
        url: str(r.Link),
        publication,
        date: str(r.Date),
        agencies: str(r.Agencies),
        counties: str(r.Counties),
      };
    })
    .sort((a, b) => dateValue(b.date) - dateValue(a.date)); // newest first

const pickNews = (raw: NewsFile | null): StateNews | null => {
  if (!raw) return null;
  const block = raw[getLocale() as "en" | "es"] ?? raw.en;
  if (!block?.tldr_html && !block?.summary_html) return null;
  return {
    tldr_html: block.tldr_html ?? "",
    body_html: block.summary_html ?? "",
    generated_at: raw.generated_at ?? "",
    articles: shapeArticles(raw.internal?.relevant_articles ?? []),
  };
};

export const load = async ({ fetch, params }): Promise<StatePageData> => {
  const abbr = params.abbr.toUpperCase();
  const stateName = NAVIGABLE_STATES[abbr];
  if (!stateName) throw error(404, `No state page for: ${abbr}`);

  const [agenciesRes, metaRes, terminatedRes, newsRes] = await Promise.all([
    fetch("/data/dist/agency_index.json"),
    fetch("/data/dist/state_meta.json"),
    fetch("/data/dist/terminated_agencies.json"),
    fetch(`/data/dist/news/${abbr}.json`),
  ]);
  if (!agenciesRes.ok) throw error(503, "Data unavailable");

  const allAgencies: Agency[] = await agenciesRes.json();
  const terminatedRaw: Agency[] = terminatedRes.ok ? await terminatedRes.json() : [];
  // No agency-count gate: non-participating states get a page too (an empty-state
  // plus their news summary). Only abbrs outside NAVIGABLE_STATES 404 (above).
  const agencies = allAgencies.filter((a) => a.state === abbr);

  // National, slim, map-only projection — the same shape the homepage ships to
  // NationalMap (#135). Lets the state map render every dot while keeping the
  // selected state's dots in focus and the rest dimmed.
  const mapAgencies: HomeAgency[] = allAgencies.map((a) => ({
    slug: a.slug,
    name: a.name,
    state: a.state,
    county: a.county,
    city: a.city,
    agency_type: a.agency_type,
    models: a.models,
    primary_model: a.primary_model,
    signed_date: a.signed_date,
    population: a.population,
    lat: a.lat,
    lng: a.lng,
    moa_url: a.moa_url,
    ori: a.ori,
    lee: a.lee ? { officer_ct: a.lee.officer_ct } : null,
  }));

  const stateMetaArr: StateMeta[] = metaRes.ok ? await metaRes.json() : [];
  const stateMeta = stateMetaArr.find((s) => s.state === abbr) ?? null;

  const snapshotDate = allAgencies
    .map((a) => (a as any).snapshot_date as string | undefined)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  const modelCounts: Record<string, number> = {};
  for (const a of agencies) {
    for (const m of a.models) {
      modelCounts[m] = (modelCounts[m] ?? 0) + 1;
    }
  }

  const agencyTypeCounts: Record<string, number> = {};
  for (const a of agencies) {
    if (a.agency_type) {
      agencyTypeCounts[a.agency_type] = (agencyTypeCounts[a.agency_type] ?? 0) + 1;
    }
  }

  // ── Trend computation ────────────────────────────────────────────────────────
  const TREND_START = "2024-12";
  const stateForTrend = [...agencies, ...terminatedRaw.filter((a) => a.state === abbr)];
  let lastMonth = TREND_START;
  for (const a of stateForTrend)
    for (const h of a.history ?? [])
      if (h.date.slice(0, 7) > lastMonth) lastMonth = h.date.slice(0, 7);
  const trendMonths: string[] = [];
  for (let ym = TREND_START; ym <= lastMonth; ) {
    trendMonths.push(ym);
    const y = Number(ym.slice(0, 4));
    const mo = Number(ym.slice(5, 7));
    ym = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }

  const sampleMonthly = (group: Agency[]): TrendSeries => {
    const out: TrendSeries = { jail: [], taskforce: [], wso: [] };
    const seen = new Set<string>();
    const carriers = group.filter((a) => {
      const k = `${a.state}\x00${a.name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const pts = buildTimeline(carriers);
    if (pts.length) {
      let i = -1;
      for (const ym of trendMonths) {
        while (i + 1 < pts.length && pts[i + 1].date.slice(0, 7) <= ym) i++;
        out.jail.push(i >= 0 ? pts[i].jail : 0);
        out.taskforce.push(i >= 0 ? pts[i].taskforce : 0);
        out.wso.push(i >= 0 ? pts[i].wso : 0);
      }
      return out;
    }
    const firstYm = group
      .flatMap((a) => (a.history ?? []).map((h) => h.date.slice(0, 7)))
      .sort()[0];
    const startYm = firstYm && firstYm > TREND_START ? firstYm : TREND_START;
    const counts = { jail: 0, taskforce: 0, wso: 0 };
    for (const a of group) {
      if (a.terminated_date) continue;
      for (const m of a.models) {
        const k = MODEL_SLUG[m] as keyof TrendSeries | undefined;
        if (k) counts[k]++;
      }
    }
    for (const ym of trendMonths) {
      const on = firstYm !== undefined && ym >= startYm;
      out.jail.push(on ? counts.jail : 0);
      out.taskforce.push(on ? counts.taskforce : 0);
      out.wso.push(on ? counts.wso : 0);
    }
    return out;
  };

  const newsRaw = newsRes.ok ? await newsRes.json() : null;
  const news = pickNews(newsRaw);

  return {
    abbr, stateName, agencies, mapAgencies, stateMeta, snapshotDate, modelCounts, agencyTypeCounts,
    timeline: buildTimeline([...agencies, ...terminatedRaw.filter((a) => a.state === abbr)]),
    nationalTimeline: buildTimeline([...allAgencies, ...terminatedRaw]),
    trendMonths,
    trend: { "": sampleMonthly(stateForTrend) },
    news,
  };
};

import { NAVIGABLE_STATES } from "$lib/states";
import type { Agency, StateMeta } from "$lib/homeData.types";
import { getLocale } from "$lib/paraglide/runtime";
import { MODEL_COLORS, MODEL_SLUG } from "$lib/colors";
import { getStateGeometry, projectDot } from "$lib/server/stateMaps";
import { buildTimeline } from "$lib/timeline";

// ── Prototype state index ────────────────────────────────────────────────────
// A throwaway preview surface (to be replaced/merged by the IA-redesign ticket):
// every state on one page with dead-simple topline figures plus its news summary
// (TL;DR always shown, full body behind a per-row expand). Lets us eyeball all
// the generated summaries in one place before the real index lands.

// Statewide 287(g) legislative posture (see the per-state page's NewsLegislation).
export type StateIndexLegislation = {
  stance: "pro" | "anti" | "none";
  active: boolean;
  description: string;
};
export type StateIndexNews = {
  tldr_html: string;
  body_html: string;
  // Program's own last-built time (real "generated" signal); local write stamp is
  // the fallback. Rendered per-card so each state carries its own freshness.
  built_at: string;
  legislation: StateIndexLegislation | null;
};

// Compact SVG mini-map: state outline + a hint of highways, both pre-projected
// into `w`×`h` viewBox units, plus agency dots (x/y in the same space, c = model
// color, o = sworn-officer count for sqrt radius scaling à la the homepage map).
// WebGL-free so it scales to 53 small-multiples. Null if no geometry.
export type StateMapDot = { x: number; y: number; c: string; o: number };
export type StateMapMini = {
  w: number;
  h: number;
  outline: string;
  highways: string[];
  dots: StateMapDot[];
};

// Model-split cumulative agency counts sampled onto the shared month grid — a
// tiny growth sparkline per state, comparable across states on one x-axis.
export type StateSpark = { jail: number[]; taskforce: number[]; wso: number[] };

// Largest agencies in the state by sworn-officer count — shown beside the chart
// in the expanded card.
export type StateTopAgency = { slug: string; name: string; model: string; officers: number };

export type StateIndexRow = {
  abbr: string;
  stateName: string;
  agencyCount: number;
  // Full-name keyed (e.g. "Jail Enforcement Model") → count; the page maps these
  // through MODEL_ORDER/MODEL_COLORS/MODEL_SHORT for the inline dots.
  modelCounts: Record<string, number>;
  populationServed: number | null;
  news: StateIndexNews | null;
  map: StateMapMini | null;
  spark: StateSpark | null;
  topAgencies: StateTopAgency[];
};

export type StatesIndexData = {
  rows: StateIndexRow[];
  generatedAt: string | null;
  trendMonths: string[];
};

type NewsLangBlock = { tldr_html?: string; summary_html?: string };
type NewsFile = {
  generated_at?: string;
  built_at?: string;
  legislation?: StateIndexLegislation | null;
  en?: NewsLangBlock;
  es?: NewsLangBlock;
};

// Resolve the active locale's block (falling back to EN) and keep only the
// fields this page renders. Mirrors the per-state page's pickNews, minus the
// article-table shaping the index doesn't show.
const pickNews = (raw: NewsFile | null): StateIndexNews | null => {
  if (!raw) return null;
  const block = raw[getLocale() as "en" | "es"] ?? raw.en;
  if (!block?.tldr_html && !block?.summary_html) return null;
  return {
    tldr_html: block.tldr_html ?? "",
    body_html: block.summary_html ?? "",
    built_at: raw.built_at ?? raw.generated_at ?? "",
    legislation: raw.legislation ?? null,
  };
};

export const load = async ({ fetch }): Promise<StatesIndexData> => {
  const abbrs = Object.keys(NAVIGABLE_STATES);

  const [agenciesRes, metaRes, terminatedRes] = await Promise.all([
    fetch("/data/dist/agency_index.json"),
    fetch("/data/dist/state_meta.json"),
    fetch("/data/dist/terminated_agencies.json"),
  ]);
  const allAgencies: Agency[] = agenciesRes.ok ? await agenciesRes.json() : [];
  const terminated: Agency[] = terminatedRes.ok ? await terminatedRes.json() : [];
  const stateMetaArr: StateMeta[] = metaRes.ok ? await metaRes.json() : [];
  const metaByState = new Map(stateMetaArr.map((s) => [s.state, s]));

  // Per-state agency + model tallies (and the located agencies for map dots) in
  // one pass.
  const agencyCount = new Map<string, number>();
  const modelCountsByState = new Map<string, Record<string, number>>();
  const locatedByState = new Map<string, Agency[]>();
  const agenciesByState = new Map<string, Agency[]>();
  for (const a of allAgencies) {
    agencyCount.set(a.state, (agencyCount.get(a.state) ?? 0) + 1);
    const mc = modelCountsByState.get(a.state) ?? {};
    for (const m of a.models) mc[m] = (mc[m] ?? 0) + 1;
    modelCountsByState.set(a.state, mc);
    const arr = agenciesByState.get(a.state) ?? [];
    arr.push(a);
    agenciesByState.set(a.state, arr);
    if (a.lat != null && a.lng != null) {
      const loc = locatedByState.get(a.state) ?? [];
      loc.push(a);
      locatedByState.set(a.state, loc);
    }
  }

  // Ten biggest departments per state (by sworn officers) — for the nerds — in
  // the expanded card's right rail.
  const buildTopAgencies = (abbr: string): StateTopAgency[] =>
    [...(agenciesByState.get(abbr) ?? [])]
      .filter((a) => a.name)
      .sort((a, b) => (b.lee?.officer_ct ?? 0) - (a.lee?.officer_ct ?? 0) || a.name.localeCompare(b.name))
      .slice(0, 10)
      .map((a) => ({
        slug: a.slug,
        name: a.name,
        model: a.primary_model,
        officers: a.lee?.officer_ct ?? 0,
      }));

  // ── Growth sparkline data ──────────────────────────────────────────────────
  // A shared month grid (Dec 2024 → latest event) so every state's sparkline
  // shares one x-axis, then per-state model-split cumulative counts sampled onto
  // it. Mirrors the state page's trend sampling, incl. the flat-line fallback for
  // states whose agencies all appear on a single date.
  const TREND_START = "2024-12";
  const nextYm = (ym: string) => {
    const y = Number(ym.slice(0, 4)), mo = Number(ym.slice(5, 7));
    return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  };
  const allForTrend = [...allAgencies, ...terminated];
  let lastMonth = TREND_START;
  for (const a of allForTrend)
    for (const h of a.history ?? [])
      if (h.date.slice(0, 7) > lastMonth) lastMonth = h.date.slice(0, 7);
  const trendMonths: string[] = [];
  for (let ym = TREND_START; ym <= lastMonth; ym = nextYm(ym)) trendMonths.push(ym);

  const stateForTrend = new Map<string, Agency[]>();
  for (const a of allForTrend) {
    const arr = stateForTrend.get(a.state) ?? [];
    arr.push(a);
    stateForTrend.set(a.state, arr);
  }

  const buildSpark = (abbr: string): StateSpark | null => {
    const group = stateForTrend.get(abbr) ?? [];
    if (!group.length) return null;
    const out: StateSpark = { jail: [], taskforce: [], wso: [] };
    const pts = buildTimeline(group);
    if (pts.length) {
      let i = -1;
      for (const ym of trendMonths) {
        while (i + 1 < pts.length && pts[i + 1].date.slice(0, 7) <= ym) i++;
        out.jail.push(i >= 0 ? pts[i].jail : 0);
        out.taskforce.push(i >= 0 ? pts[i].taskforce : 0);
        out.wso.push(i >= 0 ? pts[i].wso : 0);
      }
    } else {
      // No multi-date timeline: hold the current model counts flat from the first
      // history month onward (0 before it).
      const firstYm = group.flatMap((a) => (a.history ?? []).map((h) => h.date.slice(0, 7))).sort()[0];
      if (!firstYm) return null;
      const startYm = firstYm > TREND_START ? firstYm : TREND_START;
      const now = { jail: 0, taskforce: 0, wso: 0 };
      for (const a of group) {
        if (a.terminated_date) continue;
        for (const m of a.models) {
          const k = MODEL_SLUG[m] as keyof typeof now | undefined;
          if (k && k in now) now[k]++;
        }
      }
      for (const ym of trendMonths) {
        const on = ym >= startYm;
        out.jail.push(on ? now.jail : 0);
        out.taskforce.push(on ? now.taskforce : 0);
        out.wso.push(on ? now.wso : 0);
      }
    }
    const some = [...out.jail, ...out.taskforce, ...out.wso].some((v) => v > 0);
    return some ? out : null;
  };

  // Per-state SVG geometry (outline + highways), built once and cached. Dots are
  // projected here so the client just draws prepared paths.
  const geometry = await getStateGeometry(fetch);
  const buildMap = (abbr: string): StateMapMini | null => {
    const g = geometry[abbr];
    if (!g) return null;
    const dots: StateMapDot[] = (locatedByState.get(abbr) ?? []).map((a) => {
      const [x, y] = projectDot(g, abbr, a.lng!, a.lat!);
      return { x, y, c: MODEL_COLORS[a.primary_model] ?? "#64748b", o: a.lee?.officer_ct ?? 0 };
    });
    return { w: g.w, h: g.h, outline: g.outline, highways: g.highways, dots };
  };

  // One small JSON per state, fetched in parallel. Prototype-scale fan-out
  // (~50 files); a failure degrades to a null summary for just that state.
  const newsByState = new Map<string, StateIndexNews | null>();
  await Promise.all(
    abbrs.map(async (abbr) => {
      try {
        const res = await fetch(`/data/dist/news/${abbr}.json`);
        newsByState.set(abbr, res.ok ? pickNews(await res.json()) : null);
      } catch {
        newsByState.set(abbr, null);
      }
    }),
  );

  const rows: StateIndexRow[] = abbrs.map((abbr) => ({
    abbr,
    stateName: NAVIGABLE_STATES[abbr],
    agencyCount: agencyCount.get(abbr) ?? 0,
    modelCounts: modelCountsByState.get(abbr) ?? {},
    populationServed: metaByState.get(abbr)?.population_served ?? null,
    news: newsByState.get(abbr) ?? null,
    map: buildMap(abbr),
    spark: buildSpark(abbr),
    topAgencies: buildTopAgencies(abbr),
  }));

  // Most-participating first (a quick leaderboard). Ties — notably the whole
  // block of non-participating states at 0 — fall to population (biggest first),
  // then name, so scanning the 0s reads largest-state-down rather than A–Z.
  const statePop = (abbr: string) => metaByState.get(abbr)?.state_local_population ?? 0;
  rows.sort(
    (a, b) =>
      b.agencyCount - a.agencyCount ||
      statePop(b.abbr) - statePop(a.abbr) ||
      a.stateName.localeCompare(b.stateName),
  );

  // Newest last-built timestamp across the set (kept for reference; per-card
  // freshness now rides with each state rather than a single header line).
  const generatedAt =
    rows
      .map((r) => r.news?.built_at)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null;

  return { rows, generatedAt, trendMonths };
};

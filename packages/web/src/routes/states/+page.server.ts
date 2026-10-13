import { NAVIGABLE_STATES } from "$lib/states";
import type { Agency, StateMeta } from "$lib/homeData.types";
import { getLocale } from "$lib/paraglide/runtime";
import { MODEL_SLUG } from "$lib/colors";
import { buildTimeline } from "$lib/timeline";
import { readStaticData } from "$lib/server/staticData";

// Statewide 287(g) legislative posture — hand-maintained (not from the news
// program; see packages/pipeline/data/legislation_stance.yaml).
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
  // FBI LEE local (County+City) agency count + how many participate — for the
  // "% of local LE agencies" figure. Null when the state isn't in state_meta.
  localLeAgencies: number | null;
  localParticipating: number | null;
  news: StateIndexNews | null;
  spark: StateSpark | null;
  topAgencies: StateTopAgency[];
  legislation: StateIndexLegislation | null;
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
  };
};

export const load = async (): Promise<StatesIndexData> => {
  const abbrs = Object.keys(NAVIGABLE_STATES);

  const [allAgencies, stateMetaArr, terminated, pending, legislationByState] = await Promise.all([
    readStaticData<Agency[]>("agency_index.json").then((v) => v ?? []),
    readStaticData<StateMeta[]>("state_meta.json").then((v) => v ?? []),
    readStaticData<Agency[]>("terminated_agencies.json").then((v) => v ?? []),
    readStaticData<Agency[]>("pending_agencies.json").then((v) => v ?? []),
    readStaticData<Record<string, StateIndexLegislation>>("legislation_stance.json"),
  ]);
  if (!legislationByState) throw new Error("legislation_stance.json unavailable");
  const metaByState = new Map(stateMetaArr.map((s) => [s.state, s]));

  // Per-state agency + model tallies in one pass.
  const agencyCount = new Map<string, number>();
  const modelCountsByState = new Map<string, Record<string, number>>();
  const agenciesByState = new Map<string, Agency[]>();
  for (const a of allAgencies) {
    agencyCount.set(a.state, (agencyCount.get(a.state) ?? 0) + 1);
    const mc = modelCountsByState.get(a.state) ?? {};
    for (const m of a.models) mc[m] = (mc[m] ?? 0) + 1;
    modelCountsByState.set(a.state, mc);
    const arr = agenciesByState.get(a.state) ?? [];
    arr.push(a);
    agenciesByState.set(a.state, arr);
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
  const allForTrend = [...allAgencies, ...terminated, ...pending];
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

  // One small JSON per state; a failure degrades to a null summary for just
  // that state.
  const newsByState = new Map<string, StateIndexNews | null>();
  await Promise.all(
    abbrs.map(async (abbr) => {
      try {
        newsByState.set(abbr, pickNews(await readStaticData<NewsFile>(`news/${abbr}.json`)));
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
    localLeAgencies: metaByState.get(abbr)?.local_le_agencies ?? null,
    localParticipating: metaByState.get(abbr)?.participating ?? null,
    news: newsByState.get(abbr) ?? null,
    spark: buildSpark(abbr),
    topAgencies: buildTopAgencies(abbr),
    legislation: legislationByState[abbr] ?? null,
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

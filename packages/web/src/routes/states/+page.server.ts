import { NAVIGABLE_STATES } from "$lib/states";
import type { Agency, StateMeta } from "$lib/homeData.types";
import { getLocale } from "$lib/paraglide/runtime";

// ── State index ─────────────────────────────────────────────────────────────
// A compact, scannable list of every state: topline figures always visible,
// a short TL;DR preview behind a click, and a fast link to the full state
// page for anything more (news body, growth chart, top agencies — all
// already live there, not duplicated here). Previously rendered all 53
// states as fully-expanded cards regardless of whether anyone asked for the
// detail; this loader only fetches what the compact view + preview need.

// Statewide 287(g) legislative posture — hand-maintained (not from the news
// program; see packages/pipeline/data/legislation_stance.yaml), so it's its
// own fetch, independent of whether a state has a news summary at all.
export type StateIndexLegislation = {
  stance: "pro" | "anti" | "none";
  active: boolean;
  description: string;
};
export type StateIndexNews = {
  tldr_html: string;
  // Program's own last-built time (real "generated" signal); local write stamp is
  // the fallback. Rendered per-row so each state carries its own freshness.
  built_at: string;
};

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
  legislation: StateIndexLegislation | null;
};

export type StatesIndexData = {
  rows: StateIndexRow[];
  generatedAt: string | null;
};

type NewsLangBlock = { tldr_html?: string };
type NewsFile = {
  generated_at?: string;
  built_at?: string;
  en?: NewsLangBlock;
  es?: NewsLangBlock;
};

// Resolve the active locale's block (falling back to EN) and keep only the
// TL;DR — the full body lives on the per-state page, not this index.
const pickNews = (raw: NewsFile | null): StateIndexNews | null => {
  if (!raw) return null;
  const block = raw[getLocale() as "en" | "es"] ?? raw.en;
  if (!block?.tldr_html) return null;
  return {
    tldr_html: block.tldr_html,
    built_at: raw.built_at ?? raw.generated_at ?? "",
  };
};

export const load = async ({ fetch }): Promise<StatesIndexData> => {
  const abbrs = Object.keys(NAVIGABLE_STATES);

  const [agenciesRes, metaRes, legislationRes] = await Promise.all([
    fetch("/data/dist/agency_index.json"),
    fetch("/data/dist/state_meta.json"),
    fetch("/data/dist/legislation_stance.json"),
  ]);
  const allAgencies: Agency[] = agenciesRes.ok ? await agenciesRes.json() : [];
  const stateMetaArr: StateMeta[] = metaRes.ok ? await metaRes.json() : [];
  const legislationByState: Record<string, StateIndexLegislation> = legislationRes.ok
    ? await legislationRes.json()
    : {};
  const metaByState = new Map(stateMetaArr.map((s) => [s.state, s]));

  const agencyCount = new Map<string, number>();
  const modelCountsByState = new Map<string, Record<string, number>>();
  for (const a of allAgencies) {
    agencyCount.set(a.state, (agencyCount.get(a.state) ?? 0) + 1);
    const mc = modelCountsByState.get(a.state) ?? {};
    for (const m of a.models) mc[m] = (mc[m] ?? 0) + 1;
    modelCountsByState.set(a.state, mc);
  }

  // One small JSON per state, fetched in parallel; a failure degrades to a
  // null summary for just that state.
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
    localLeAgencies: metaByState.get(abbr)?.local_le_agencies ?? null,
    localParticipating: metaByState.get(abbr)?.participating ?? null,
    news: newsByState.get(abbr) ?? null,
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

  const generatedAt =
    rows
      .map((r) => r.news?.built_at)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null;

  return { rows, generatedAt };
};

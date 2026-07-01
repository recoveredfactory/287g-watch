import { NAVIGABLE_STATES } from "$lib/states";
import type { Agency, StateMeta } from "$lib/homeData.types";
import { getLocale } from "$lib/paraglide/runtime";

// ── Prototype state index ────────────────────────────────────────────────────
// A throwaway preview surface (to be replaced/merged by the IA-redesign ticket):
// every state on one page with dead-simple topline figures plus its news summary
// (TL;DR always shown, full body behind a per-row expand). Lets us eyeball all
// the generated summaries in one place before the real index lands.

export type StateIndexNews = {
  tldr_html: string;
  body_html: string;
  generated_at: string;
};

export type StateIndexRow = {
  abbr: string;
  stateName: string;
  agencyCount: number;
  // Full-name keyed (e.g. "Jail Enforcement Model") → count; the page maps these
  // through MODEL_ORDER/MODEL_COLORS/MODEL_SHORT for the inline dots.
  modelCounts: Record<string, number>;
  populationServed: number | null;
  news: StateIndexNews | null;
};

export type StatesIndexData = {
  rows: StateIndexRow[];
  generatedAt: string | null;
};

type NewsLangBlock = { tldr_html?: string; summary_html?: string };
type NewsFile = { generated_at?: string; en?: NewsLangBlock; es?: NewsLangBlock };

// Resolve the active locale's block (falling back to EN) and keep only the two
// fields this page renders. Mirrors the per-state page's pickNews, minus the
// article-table shaping the index doesn't show.
const pickNews = (raw: NewsFile | null): StateIndexNews | null => {
  if (!raw) return null;
  const block = raw[getLocale() as "en" | "es"] ?? raw.en;
  if (!block?.tldr_html && !block?.summary_html) return null;
  return {
    tldr_html: block.tldr_html ?? "",
    body_html: block.summary_html ?? "",
    generated_at: raw.generated_at ?? "",
  };
};

export const load = async ({ fetch }): Promise<StatesIndexData> => {
  const abbrs = Object.keys(NAVIGABLE_STATES);

  const [agenciesRes, metaRes] = await Promise.all([
    fetch("/data/dist/agency_index.json"),
    fetch("/data/dist/state_meta.json"),
  ]);
  const allAgencies: Agency[] = agenciesRes.ok ? await agenciesRes.json() : [];
  const stateMetaArr: StateMeta[] = metaRes.ok ? await metaRes.json() : [];
  const metaByState = new Map(stateMetaArr.map((s) => [s.state, s]));

  // Per-state agency + model tallies in one pass.
  const agencyCount = new Map<string, number>();
  const modelCountsByState = new Map<string, Record<string, number>>();
  for (const a of allAgencies) {
    agencyCount.set(a.state, (agencyCount.get(a.state) ?? 0) + 1);
    const mc = modelCountsByState.get(a.state) ?? {};
    for (const m of a.models) mc[m] = (mc[m] ?? 0) + 1;
    modelCountsByState.set(a.state, mc);
  }

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
  }));

  // Most-participating first (a quick leaderboard), then alphabetical.
  rows.sort(
    (a, b) => b.agencyCount - a.agencyCount || a.stateName.localeCompare(b.stateName),
  );

  // Newest summary timestamp across the set, for the page's "updated" line.
  const generatedAt =
    rows
      .map((r) => r.news?.generated_at)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null;

  return { rows, generatedAt };
};

import { error } from "@sveltejs/kit";
import type { Agency } from "../../+page.server";
import { GLOSSARY_TERMS } from "$lib/glossary/terms";
import { readStaticData } from "$lib/server/staticData";

const SLUG_TO_MODEL: Record<string, string> = {
  jail: "Jail Enforcement Model",
  taskforce: "Task Force Model",
  wso: "Warrant Service Officer",
};

export type ModelPageData = {
  modelName: string;
  slug: string;
  definition: string;
  seeAlso: string[];
  agencyCount: number;
  snapshotDate: string | null;
  stateCount: number;
  allModelCounts: Record<string, number>;
};

export const load = async ({ params }): Promise<ModelPageData> => {
  const modelName = SLUG_TO_MODEL[params.slug];
  if (!modelName) throw error(404, `Unknown model: ${params.slug}`);

  const all = await readStaticData<Agency[]>("agency_index.json");
  if (!all) throw error(503, "Data unavailable");

  const agencies = all.filter((a) => a.models.includes(modelName));

  const snapshotDate =
    all
      .map((a) => (a as any).snapshot_date as string | undefined)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

  const stateCount = new Set(agencies.map((a) => a.state)).size;

  const allModelCounts: Record<string, number> = {};
  for (const a of all) {
    for (const m of a.models) {
      allModelCounts[m] = (allModelCounts[m] ?? 0) + 1;
    }
  }

  const term = GLOSSARY_TERMS.find((t) => t.term === modelName);

  return {
    modelName,
    slug: params.slug,
    definition: term?.definition ?? "",
    seeAlso: term?.seeAlso ?? [],
    agencyCount: agencies.length,
    snapshotDate,
    stateCount,
    allModelCounts,
  };
};

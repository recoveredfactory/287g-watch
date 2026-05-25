import { error } from "@sveltejs/kit";
import type { Agency } from "../../+page.server";
import { GLOSSARY_TERMS } from "$lib/glossary/terms";

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
  agencies: Agency[];
  snapshotDate: string | null;
};

export const load = async ({ fetch, params }): Promise<ModelPageData> => {
  const modelName = SLUG_TO_MODEL[params.slug];
  if (!modelName) throw error(404, `Unknown model: ${params.slug}`);

  const res = await fetch("/data/dist/agency_index.json");
  if (!res.ok) throw error(503, "Data unavailable");
  const all: Agency[] = await res.json();

  const agencies = all.filter((a) => a.models.includes(modelName));

  const snapshotDate =
    all
      .map((a) => (a as any).snapshot_date as string | undefined)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

  const term = GLOSSARY_TERMS.find((t) => t.term === modelName);

  return {
    modelName,
    slug: params.slug,
    definition: term?.definition ?? "",
    seeAlso: term?.seeAlso ?? [],
    agencies,
    snapshotDate,
  };
};

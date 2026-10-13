// The licensing/download page only needs the data as-of date so the page can
// show how current the downloadable map is. Derived the same way as the
// homepage (max snapshot_date across the agency index) so the two never
// disagree. See +page.server.ts at the root.
import { readStaticData } from "$lib/server/staticData";

type IndexAgency = { snapshot_date?: string };

export const load = async (): Promise<{ snapshotDate: string | null }> => {
  try {
    const agencies = await readStaticData<IndexAgency[]>("agency_index.json");
    if (!agencies) throw new Error("agency_index.json unavailable");
    const snapshotDate =
      agencies
        .map((a) => a.snapshot_date)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;
    return { snapshotDate };
  } catch {
    return { snapshotDate: null };
  }
};

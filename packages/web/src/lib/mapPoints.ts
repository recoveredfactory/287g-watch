import type { MapPoint, TerminatedPoint } from "$lib/homeData.types";

// Each file is fetched once per tab, so moving between pages reuses it.
const files = new Map<string, Promise<unknown>>();

function loadOnce<T>(path: string): Promise<T> {
  let pending = files.get(path) as Promise<T> | undefined;
  if (!pending) {
    pending = fetch(path).then((res) => {
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      return res.json() as Promise<T>;
    });
    files.set(path, pending);
    pending.catch(() => files.delete(path));
  }
  return pending;
}

export const loadMapPoints = () => loadOnce<MapPoint[]>("/data/map-points.json");
export const loadTerminatedPoints = () => loadOnce<TerminatedPoint[]>("/data/terminated-points.json");

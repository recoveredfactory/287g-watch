// Shared map palette selection — persists across pages and reloads.
// Homepage selector writes here; every map (homepage NationalMap + every
// agency-page AgencyMap) reads from here so toggling Dark on the homepage
// also flips agency-page maps.

import { writable } from "svelte/store";
import { browser } from "$app/environment";

export type PaletteKey = "slate" | "dark";

const STORAGE_KEY = "rf-map-palette";

function readInitial(): PaletteKey {
  if (!browser) return "slate";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "slate" || v === "dark") return v;
    // Migrate the earlier short-lived "cream" key to "slate"
    if (v === "cream") return "slate";
  } catch {}
  return "slate";
}

export const mapPalette = writable<PaletteKey>(readInitial());

if (browser) {
  mapPalette.subscribe((v) => {
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {}
  });
}

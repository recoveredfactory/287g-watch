// Shared map palette selection — persists across pages and reloads.
// Homepage selector writes here; every map (homepage NationalMap + every
// agency-page AgencyMap) reads from here so toggling Dark on the homepage
// also flips agency-page maps.

import { writable } from "svelte/store";
import { browser } from "$app/environment";

export type PaletteKey = "cream" | "dark";

const STORAGE_KEY = "rf-map-palette";

function readInitial(): PaletteKey {
  if (!browser) return "cream";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "cream" || v === "dark") return v;
  } catch {}
  return "cream";
}

export const mapPalette = writable<PaletteKey>(readInitial());

if (browser) {
  mapPalette.subscribe((v) => {
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {}
  });
}

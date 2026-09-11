import { readable, type Readable } from "svelte/store";
import { browser } from "$app/environment";

/**
 * A reactive `matchMedia` boolean store. Unlike a one-time
 * `matchMedia(query).matches` check at mount, this updates on resize,
 * orientation change, and (on supporting browsers) foldable-device state
 * changes, since it subscribes to the query's `change` event for as long as
 * it has a subscriber.
 */
export function mediaQuery(query: string): Readable<boolean> {
  if (!browser) {
    // SSR: no window to match against. Default false — callers should treat
    // this as "assume desktop layout until hydration" rather than guessing.
    return readable(false);
  }

  const mql = window.matchMedia(query);

  return readable(mql.matches, (set) => {
    const onChange = (e: MediaQueryListEvent) => set(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  });
}

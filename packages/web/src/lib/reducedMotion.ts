import { mediaQuery } from "$lib/reactiveMedia";

/** True when the user has requested reduced motion at the OS/browser level. */
export const prefersReducedMotion = mediaQuery("(prefers-reduced-motion: reduce)");

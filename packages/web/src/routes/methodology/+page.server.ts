import { redirect } from "@sveltejs/kit";

// Methodology merged into /about (nav simplification) — redirect rather than
// leave a dead page, preserving the locale prefix and any query string. A
// same-page anchor like #ai/#agreements in the original URL is carried over
// by the browser automatically since the Location header here doesn't
// specify one.
export const load = async ({ url }) => {
  redirect(301, url.pathname.replace(/\/methodology(\/|$)/, "/about$1") + url.search);
};

import { redirect } from "@sveltejs/kit";

// /use-the-map was renamed to /downloads — the label ("Downloads") and the
// URL slug had drifted apart after the nav link's text was renamed from
// "Share" without updating its destination path. Redirect rather than leave
// a dead page, preserving the locale prefix and any query string for anyone
// who bookmarked or shared a /use-the-map link before the rename.
export const load = async ({ url }) => {
  redirect(301, url.pathname.replace(/\/use-the-map(\/|$)/, "/downloads$1") + url.search);
};

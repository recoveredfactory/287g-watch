import { redirect } from "@sveltejs/kit";

// /states renamed to /explore ("it should allow you to search everything,
// not just states"). Redirect rather than leave a dead page, preserving
// the locale prefix and any query string (including a shared ?sel=...
// compare link).
export const load = async ({ url }) => {
  redirect(301, url.pathname.replace(/\/states(\/|$)/, "/explore$1") + url.search);
};

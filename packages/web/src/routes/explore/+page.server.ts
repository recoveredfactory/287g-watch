import { redirect } from "@sveltejs/kit";

// /explore was a temporary rename of /states during this branch's work;
// per review, /states is restored as the real route. Redirect rather than
// leave a dead page, preserving the locale prefix and any query string for
// anyone who bookmarked or shared an /explore link during that window.
export const load = async ({ url }) => {
  redirect(301, url.pathname.replace(/\/explore(\/|$)/, "/states$1") + url.search);
};

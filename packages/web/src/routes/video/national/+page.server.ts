import { buildHomeData } from "$lib/server/homeData";

// Same data as the homepage — the social-video composite (#167) reuses the
// real NationalMap + TrendCharts, so its numbers come from the same builder.
export const load = ({ fetch }) => buildHomeData(fetch);

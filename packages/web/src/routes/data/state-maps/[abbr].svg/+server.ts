import { error } from "@sveltejs/kit";
import { render } from "svelte/server";
import StateMiniMap from "$lib/components/StateMiniMap.svelte";
import { NAVIGABLE_STATES } from "$lib/states";
import { getStateMiniMap } from "$lib/server/stateMaps";

// Built once at build time and served from S3/CloudFront like the rest of /data.
export const prerender = true;
export const entries = () => Object.keys(NAVIGABLE_STATES).map((abbr) => ({ abbr: abbr.toLowerCase() }));

// Each /states card's map as its own cached file instead of SVG inlined in the
// page and again in its hydration data (#307). Drawn by the same component the
// cards used to inline, so the picture is unchanged; as an <img> it needs the
// SVG namespace and no Svelte hydration comments.
export const GET = async ({ fetch, params }) => {
  const abbr = params.abbr.toUpperCase();
  const map = NAVIGABLE_STATES[abbr] ? await getStateMiniMap(fetch, abbr) : null;
  if (!map) error(404, `No state map for ${params.abbr}`);
  const { body } = render(StateMiniMap, { props: { ...map, id: params.abbr } });
  const svg = body.replace(/<!--[\s\S]*?-->/g, "").replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
  return new Response(svg, { headers: { "content-type": "image/svg+xml" } });
};
